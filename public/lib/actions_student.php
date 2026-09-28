<?php
defined('APP') || exit;

/** Students take quizzes; the teacher may take her own quizzes in preview mode. */
function attempt_user(): array
{
    $u = require_user();
    return $u['role'] === 'teacher' ? require_teacher() : require_student();
}

function act_student_dashboard(array $in): array
{
    $user = require_student(true);
    if ($user['status'] !== 'active') {
        return ['pending' => true, 'quizzes' => [], 'history' => []];
    }
    $uid = (int) $user['id'];
    $quizzes = [];
    foreach (rows("SELECT * FROM quizzes WHERE status = 'open' ORDER BY updated_at DESC") as $r) {
        $quiz = cast_quiz($r);
        if (!student_can_see_quiz($quiz, $user)) {
            continue;
        }
        $count = (int) val('SELECT COUNT(*) FROM questions WHERE quiz_id = ?', [$quiz['id']]);
        if ($count === 0) {
            continue;
        }
        $attempts = rows('SELECT id, status, score, max_score, zeroed FROM attempts WHERE quiz_id = ? AND user_id = ? AND is_preview = 0 ORDER BY id DESC', [$quiz['id'], $uid]);
        $running = null;
        $finished = 0;
        $last = null;
        foreach ($attempts as $a) {
            if ($a['status'] === 'finished') {
                $finished++;
                $last = $last ?? $a;
            } elseif ($running === null) {
                $running = $a;
            }
        }
        $visible = results_visible($quiz);
        $quizzes[] = [
            'id' => $quiz['id'],
            'title' => $quiz['title'],
            'description' => $quiz['description'],
            'level' => $quiz['level'],
            'chapter' => $quiz['chapter'],
            'question_count' => $quiz['pool_size'] > 0 ? min($quiz['pool_size'], $count) : $count,
            'time_limit' => $quiz['time_limit'],
            'needs_code' => $quiz['access_code'] !== null,
            'window' => quiz_window($quiz),
            'opens_at' => $quiz['opens_at'],
            'closes_at' => $quiz['closes_at'],
            'max_attempts' => $quiz['max_attempts'],
            'attempts_used' => $finished,
            'running' => $running ? ['attempt_id' => (int) $running['id'], 'status' => $running['status']] : null,
            'last' => $last ? [
                'attempt_id' => (int) $last['id'],
                'visible' => $visible,
                'note20' => $visible ? note20((float) $last['score'], (float) $last['max_score']) : null,
            ] : null,
            'require_fullscreen' => $quiz['require_fullscreen'],
            'feedback_mode' => $quiz['feedback_mode'],
            'max_exits' => $quiz['max_exits'],
            'exit_action' => $quiz['exit_action'],
        ];
    }
    $history = [];
    $rows = rows(
        "SELECT a.id, a.score, a.max_score, a.finished_ms, a.finish_reason, a.zeroed, q.id AS quiz_id, q.title, q.level, q.feedback_mode, q.results_released, q.show_leaderboard
         FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
         WHERE a.user_id = ? AND a.is_preview = 0 AND a.status = 'finished' AND q.status <> 'draft'
         ORDER BY a.finished_ms DESC LIMIT 100",
        [$uid]
    );
    foreach ($rows as $r) {
        $visible = $r['feedback_mode'] !== 'release' || (int) $r['results_released'] === 1;
        $history[] = [
            'attempt_id' => (int) $r['id'],
            'quiz_id' => (int) $r['quiz_id'],
            'title' => $r['title'],
            'level' => $r['level'],
            'finished_ms' => (int) $r['finished_ms'],
            'visible' => $visible,
            'note20' => $visible ? note20((float) $r['score'], (float) $r['max_score']) : null,
            'zeroed' => (bool) $r['zeroed'],
        ];
    }
    return ['pending' => false, 'quizzes' => $quizzes, 'history' => $history];
}

function act_quiz_start(array $in): array
{
    $user = attempt_user();
    $preview = $user['role'] === 'teacher';
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $uid = (int) $user['id'];

    if (!$preview) {
        if (!student_can_see_quiz($quiz, $user)) {
            fail('Ce quiz n’est pas disponible.', 403, 'unavailable');
        }
        $window = quiz_window($quiz);
        if ($window === 'not_yet') {
            fail('Ce quiz n’est pas encore ouvert.', 403, 'not_yet');
        }
        if ($window === 'ended') {
            fail('Ce quiz est terminé.', 403, 'ended');
        }
        if (!ip_allowed($quiz)) {
            fail('Ce quiz ne peut être passé que depuis le réseau du lycée, en classe.', 403, 'ip');
        }
        if (bool_in($in, 'webdriver')) {
            fail('Navigateur automatisé détecté. Utilise Safari, Chrome, Firefox ou Edge normalement.', 403, 'automation');
        }
        $running = val("SELECT id FROM attempts WHERE quiz_id = ? AND user_id = ? AND is_preview = 0 AND status IN ('in_progress','locked') LIMIT 1", [$quiz['id'], $uid]);
        if (!$running) {
            $used = (int) val("SELECT COUNT(*) FROM attempts WHERE quiz_id = ? AND user_id = ? AND is_preview = 0", [$quiz['id'], $uid]);
            if ($used >= $quiz['max_attempts']) {
                fail($quiz['max_attempts'] > 1 ? 'Tu as utilisé toutes tes tentatives pour ce quiz.' : 'Tu as déjà passé ce quiz.', 409, 'no_attempts_left');
            }
            if ($quiz['access_code'] !== null) {
                $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', str_in($in, 'code', 20)));
                if ($code === '') {
                    fail('Entre le code d’accès donné par ta professeure.', 400, 'code_required');
                }
                throttle_guard('code:' . $uid);
                if (!hash_equals($quiz['access_code'], $code)) {
                    throttle_fail('code:' . $uid);
                    fail('Code d’accès incorrect.', 403, 'bad_code');
                }
                throttle_clear('code:' . $uid);
            }
        }
    }

    return tx(function () use ($quiz, $user, $uid, $preview, $in) {
        q('SELECT id FROM users WHERE id = ? FOR UPDATE', [$uid]);
        if ($preview) {
            q('DELETE FROM attempts WHERE quiz_id = ? AND user_id = ? AND is_preview = 1', [$quiz['id'], $uid]);
            $a = create_attempt($quiz, $user, true);
        } else {
            $runningId = val("SELECT id FROM attempts WHERE quiz_id = ? AND user_id = ? AND is_preview = 0 AND status IN ('in_progress','locked') ORDER BY id DESC LIMIT 1", [$quiz['id'], $uid]);
            if ($runningId) {
                $a = attempt_for_update((int) $runningId);
                check_device($a, $quiz);
                sync_attempt($a, $quiz);
            } else {
                $used = (int) val('SELECT COUNT(*) FROM attempts WHERE quiz_id = ? AND user_id = ? AND is_preview = 0', [$quiz['id'], $uid]);
                if ($used >= $quiz['max_attempts']) {
                    fail('Tu as déjà passé ce quiz.', 409, 'no_attempts_left');
                }
                $a = create_attempt($quiz, $user, false);
                if (bool_in($in, 'multiscreen')) {
                    log_incident($a, 'multiscreen', 'Détecté au démarrage', null, false);
                }
            }
        }
        $a['last_seen_ms'] = now_ms();
        save_attempt($a);
        return attempt_payload($a, $quiz, $user);
    });
}

function act_attempt_state(array $in): array
{
    $user = attempt_user();
    return tx(function () use ($in, $user) {
        $a = own_attempt_for_update(int_in($in, 'attempt_id'), $user);
        $quiz = quiz_row($a['quiz_id']);
        check_device($a, $quiz);
        sync_attempt($a, $quiz);
        if (bool_in($in, 'fresh') && $a['status'] === 'in_progress' && $a['q_started_ms'] !== null) {
            register_exit($a, $quiz, 'reload', null, null, 'reload-' . $a['current_index'] . '-' . $a['q_started_ms']);
        }
        if (bool_in($in, 'serve')) {
            serve_question($a);
        }
        if ($a['status'] !== 'finished') {
            $a['last_seen_ms'] = now_ms();
        }
        save_attempt($a);
        return attempt_payload($a, $quiz, $user);
    });
}

function act_attempt_answer(array $in): array
{
    $user = attempt_user();
    return tx(function () use ($in, $user) {
        $a = own_attempt_for_update(int_in($in, 'attempt_id'), $user);
        $quiz = quiz_row($a['quiz_id']);
        check_device($a, $quiz);
        sync_attempt($a, $quiz);
        $index = int_in($in, 'index', -1);
        if ($a['status'] !== 'in_progress' || $a['q_started_ms'] === null || $index !== $a['current_index']) {
            save_attempt($a);
            return ['accepted' => false, 'feedback' => null, 'state' => attempt_payload($a, $quiz, $user)];
        }
        $q = current_question($a);
        $now = now_ms();
        $elapsed = $now - $a['q_started_ms'];
        $late = $q['time_limit'] > 0 && $elapsed > $q['time_limit'] * 1000 + ANSWER_GRACE_MS;
        $raw = $in['response'] ?? null;
        $response = $raw === null ? null : clean_response($q, $raw);
        $timeout = $response === null || $late;
        if ($timeout) {
            $grade = ['fraction' => 0, 'score' => 0, 'points' => 0];
            store_answer($a, $q, $response, 'timeout', $grade, $q['time_limit'] > 0 ? min($elapsed, $q['time_limit'] * 1000) : $elapsed);
        } else {
            $timeMs = $q['time_limit'] > 0 ? min($elapsed, $q['time_limit'] * 1000) : $elapsed;
            $grade = grade_question($q, $response, $timeMs, $quiz['speed_bonus']);
            store_answer($a, $q, $response, 'answered', $grade, $timeMs);
        }
        $a['last_seen_ms'] = $now;
        advance_attempt($a);
        save_attempt($a);

        $feedback = ['recorded' => true, 'timeout' => $timeout];
        if ($quiz['feedback_mode'] === 'immediate' || $a['is_preview']) {
            $feedback += [
                'fraction' => (float) $grade['fraction'],
                'correct' => (float) $grade['fraction'] >= 1,
                'score' => (float) $grade['score'],
                'max' => $q['points'],
                'points_gained' => (int) $grade['points'],
                'streak' => answer_streak($a['id']),
                'type' => $q['type'],
                'response' => $response,
                'correction' => correction_of($q),
                'explanation' => $q['explanation'],
                'question' => public_question($q, json_dec($a['choice_orders'])),
            ];
        }
        return ['accepted' => true, 'feedback' => $feedback, 'state' => attempt_payload($a, $quiz, $user)];
    });
}

function act_attempt_event(array $in): array
{
    $user = attempt_user();
    $type = str_in($in, 'type', 30);
    if (!in_array($type, CLIENT_INCIDENTS, true)) {
        fail('Évènement inconnu.');
    }
    return tx(function () use ($in, $user, $type) {
        $a = own_attempt_for_update(int_in($in, 'attempt_id'), $user);
        $quiz = quiz_row($a['quiz_id']);
        check_device($a, $quiz);
        sync_attempt($a, $quiz);
        $detail = str_in($in, 'detail', 200);
        $duration = isset($in['duration_ms']) && is_numeric($in['duration_ms']) ? max(0, min((int) $in['duration_ms'], 86400000)) : null;
        $key = str_in($in, 'exit_key', 40);
        $key = preg_match('/^[A-Za-z0-9\-]{4,40}$/', $key) ? 'c-' . $key : null;
        $result = ['action' => null];
        if (in_array($type, EXIT_TYPES, true)) {
            $result = register_exit($a, $quiz, $type, $detail !== '' ? $detail : null, $duration, $key);
        } elseif ($a['status'] !== 'finished') {
            log_incident($a, $type, $detail !== '' ? $detail : null, null, false);
        }
        if ($a['status'] !== 'finished') {
            $a['last_seen_ms'] = now_ms();
        }
        save_attempt($a);
        return ['action' => $result['action'], 'cancelled' => $result['cancelled'] ?? false, 'state' => attempt_payload($a, $quiz, $user)];
    });
}

function act_attempt_heartbeat(array $in): array
{
    $user = attempt_user();
    return tx(function () use ($in, $user) {
        $a = own_attempt_for_update(int_in($in, 'attempt_id'), $user);
        $quiz = quiz_row($a['quiz_id']);
        check_device($a, $quiz);
        sync_attempt($a, $quiz);
        $key = str_in($in, 'away_key', 40);
        $awayMs = max(0, int_in($in, 'away_ms', 0));
        if ($a['status'] === 'in_progress' && preg_match('/^[A-Za-z0-9\-]{4,40}$/', $key)) {
            if (str_in($in, 'vis', 10) === 'hidden') {
                register_exit($a, $quiz, 'hb_hidden', null, $awayMs ?: null, 'c-' . $key);
            } elseif (!bool_in($in, 'focus') && $awayMs >= 1500) {
                register_exit($a, $quiz, 'hb_blur', null, $awayMs, 'c-' . $key);
            }
        }
        if ($a['status'] !== 'finished') {
            $a['last_seen_ms'] = now_ms();
        }
        save_attempt($a);
        return attempt_payload($a, $quiz, $user);
    });
}

function act_attempt_ack_warning(array $in): array
{
    $user = attempt_user();
    return tx(function () use ($in, $user) {
        $a = own_attempt_for_update(int_in($in, 'attempt_id'), $user);
        $quiz = quiz_row($a['quiz_id']);
        if ($a['warning_text'] !== null) {
            log_incident($a, 'warning_ack', mb_substr($a['warning_text'], 0, 120), null, false);
            $a['warning_text'] = null;
        }
        save_attempt($a);
        return attempt_payload($a, $quiz, $user);
    });
}

function act_attempt_preview_unlock(array $in): array
{
    $user = require_teacher();
    return tx(function () use ($in, $user) {
        $a = own_attempt_for_update(int_in($in, 'attempt_id'), $user);
        $quiz = quiz_row($a['quiz_id']);
        if ($a['is_preview'] && $a['status'] === 'locked') {
            $a['status'] = 'in_progress';
            $a['lock_reason'] = null;
            $a['last_seen_ms'] = now_ms();
        }
        save_attempt($a);
        return attempt_payload($a, $quiz, $user);
    });
}

function act_attempt_result(array $in): array
{
    $user = attempt_user();
    $r = row('SELECT * FROM attempts WHERE id = ?', [int_in($in, 'attempt_id')]);
    if (!$r || (int) $r['user_id'] !== (int) $user['id']) {
        fail('Copie introuvable.', 404, 'not_found');
    }
    $a = cast_attempt($r);
    $quiz = quiz_row($a['quiz_id']);
    if ($a['status'] !== 'finished') {
        fail('Ce quiz n’est pas terminé.', 409, 'not_finished');
    }
    if (!$a['is_preview'] && !results_visible($quiz)) {
        fail('Les résultats n’ont pas encore été publiés par ta professeure.', 403, 'not_released');
    }
    $rank = null;
    if (!$a['is_preview'] && $quiz['show_leaderboard']) {
        $rank = leaderboard_data($quiz, (int) $user['id'])['my_rank'];
    }
    return [
        'quiz' => ['id' => $quiz['id'], 'title' => $quiz['title'], 'level' => $quiz['level'], 'show_leaderboard' => $quiz['show_leaderboard']],
        'attempt' => [
            'id' => $a['id'],
            'score' => $a['score'],
            'max_score' => $a['max_score'],
            'note20' => note20($a['score'], $a['max_score']),
            'points' => $a['points'],
            'zeroed' => $a['zeroed'],
            'finish_reason' => $a['finish_reason'],
            'started_ms' => $a['started_ms'],
            'finished_ms' => $a['finished_ms'],
            'exits' => $a['exits'],
            'is_preview' => $a['is_preview'],
        ],
        'rank' => $rank,
        'items' => attempt_corrections($a),
    ];
}

function leaderboard_data(array $quiz, ?int $userId): array
{
    $rows = rows(
        "SELECT a.user_id, MAX(a.points) AS points, MAX(a.score / NULLIF(a.max_score, 0)) AS ratio, u.first_name, u.last_name
         FROM attempts a JOIN users u ON u.id = a.user_id
         WHERE a.quiz_id = ? AND a.is_preview = 0 AND a.status = 'finished' AND a.zeroed = 0
         GROUP BY a.user_id, u.first_name, u.last_name
         ORDER BY points DESC, ratio DESC",
        [$quiz['id']]
    );
    $list = [];
    $myRank = null;
    foreach ($rows as $i => $r) {
        if ($userId !== null && (int) $r['user_id'] === $userId) {
            $myRank = $i + 1;
        }
        if ($i < 10) {
            $list[] = [
                'rank' => $i + 1,
                'name' => $r['first_name'] . ' ' . mb_strtoupper(mb_substr($r['last_name'], 0, 1)) . '.',
                'points' => (int) $r['points'],
                'me' => $userId !== null && (int) $r['user_id'] === $userId,
            ];
        }
    }
    return ['top' => $list, 'my_rank' => $myRank, 'participants' => count($rows)];
}

function act_leaderboard(array $in): array
{
    $user = require_student();
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    if (!$quiz['show_leaderboard'] || !results_visible($quiz) || $quiz['status'] === 'draft') {
        fail('Le classement n’est pas disponible pour ce quiz.', 403, 'unavailable');
    }
    $played = val("SELECT id FROM attempts WHERE quiz_id = ? AND user_id = ? AND is_preview = 0 AND status = 'finished' LIMIT 1", [$quiz['id'], (int) $user['id']]);
    if (!$played) {
        fail('Termine le quiz pour voir le classement.', 403, 'not_played');
    }
    return ['quiz' => ['id' => $quiz['id'], 'title' => $quiz['title']]] + leaderboard_data($quiz, (int) $user['id']);
}
