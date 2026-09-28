<?php
defined('APP') || exit;

// Every act_t_* action is reachable only by the teacher (enforced in api/index.php).

function student_display(array $r): string
{
    return trim($r['first_name'] . ' ' . mb_strtoupper($r['last_name']));
}

function incident_row(array $i): array
{
    return [
        'id' => (int) $i['id'],
        'type' => $i['type'],
        'label' => INCIDENT_LABELS[$i['type']] ?? $i['type'],
        'detail' => $i['detail'],
        'question_index' => $i['question_index'] !== null ? (int) $i['question_index'] : null,
        'duration_ms' => $i['duration_ms'] !== null ? (int) $i['duration_ms'] : null,
        'counted' => (bool) $i['counted'],
        'created_ms' => (int) $i['created_ms'],
    ];
}

/** Applies the server clock to running attempts so that silent students are detected even if they never come back. */
function sweep_attempts(?int $quizId = null): void
{
    $now = now_ms();
    $sql = "SELECT id FROM attempts WHERE is_preview = 0 AND status IN ('in_progress','locked')
            AND ((q_started_ms IS NOT NULL AND last_seen_ms < ?) OR (deadline_ms IS NOT NULL AND deadline_ms < ?) OR (q_started_ms IS NOT NULL AND q_started_ms < ?))";
    $params = [$now - 3000, $now, $now - 5000];
    if ($quizId) {
        $sql .= ' AND quiz_id = ?';
        $params[] = $quizId;
    }
    foreach (rows($sql . ' LIMIT 300', $params) as $r) {
        tx(function () use ($r) {
            $a = attempt_for_update((int) $r['id']);
            $quiz = quiz_row($a['quiz_id']);
            $before = [$a['status'], $a['current_index'], $a['q_started_ms'], $a['exits']];
            sync_attempt($a, $quiz);
            if ($before !== [$a['status'], $a['current_index'], $a['q_started_ms'], $a['exits']]) {
                save_attempt($a);
            }
        });
    }
}

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */

function act_t_overview(array $in): array
{
    sweep_attempts();
    $today = strtotime('today') * 1000;
    $recent = rows(
        "SELECT a.id, a.score, a.max_score, a.finished_ms, a.exits, a.zeroed, u.first_name, u.last_name, q.title
         FROM attempts a JOIN users u ON u.id = a.user_id JOIN quizzes q ON q.id = a.quiz_id
         WHERE a.is_preview = 0 AND a.status = 'finished' ORDER BY a.finished_ms DESC LIMIT 8"
    );
    $alerts = rows(
        "SELECT i.*, a.quiz_id, u.first_name, u.last_name, q.title
         FROM incidents i JOIN attempts a ON a.id = i.attempt_id JOIN users u ON u.id = a.user_id JOIN quizzes q ON q.id = a.quiz_id
         WHERE a.is_preview = 0 AND i.counted = 1 ORDER BY i.id DESC LIMIT 8"
    );
    return [
        'stats' => [
            'students' => (int) val("SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'active'"),
            'pending' => (int) val("SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'pending'"),
            'quizzes_open' => (int) val("SELECT COUNT(*) FROM quizzes WHERE status = 'open'"),
            'quizzes_total' => (int) val("SELECT COUNT(*) FROM quizzes WHERE status <> 'archived'"),
            'live' => (int) val("SELECT COUNT(*) FROM attempts WHERE is_preview = 0 AND status = 'in_progress'"),
            'locked' => (int) val("SELECT COUNT(*) FROM attempts WHERE is_preview = 0 AND status = 'locked'"),
            'finished_today' => (int) val("SELECT COUNT(*) FROM attempts WHERE is_preview = 0 AND status = 'finished' AND finished_ms >= ?", [$today]),
        ],
        'pending_students' => array_map(fn($r) => ['id' => (int) $r['id'], 'name' => student_display($r), 'created_at' => (int) $r['created_at']],
            rows("SELECT id, first_name, last_name, created_at FROM users WHERE role = 'student' AND status = 'pending' ORDER BY created_at DESC LIMIT 20")),
        'recent' => array_map(fn($r) => [
            'attempt_id' => (int) $r['id'],
            'name' => student_display($r),
            'quiz' => $r['title'],
            'note20' => note20((float) $r['score'], (float) $r['max_score']),
            'finished_ms' => (int) $r['finished_ms'],
            'exits' => (int) $r['exits'],
            'zeroed' => (bool) $r['zeroed'],
        ], $recent),
        'alerts' => array_map(fn($r) => incident_row($r) + ['name' => student_display($r), 'quiz' => $r['title'], 'quiz_id' => (int) $r['quiz_id'], 'attempt_id' => (int) $r['attempt_id']], $alerts),
    ];
}

/** Lightweight poll used on every teacher page to raise cheating alerts in real time. */
function act_t_alerts(array $in): array
{
    sweep_attempts();
    $since = int_in($in, 'since', -1);
    $last = (int) val('SELECT COALESCE(MAX(id), 0) FROM incidents');
    $alerts = [];
    if ($since >= 0) {
        $rows = rows(
            "SELECT i.*, a.quiz_id, a.status AS attempt_status, u.first_name, u.last_name, q.title
             FROM incidents i JOIN attempts a ON a.id = i.attempt_id JOIN users u ON u.id = a.user_id JOIN quizzes q ON q.id = a.quiz_id
             WHERE i.id > ? AND a.is_preview = 0 AND (i.counted = 1 OR i.type IN ('ai_extension','devtools','tamper','automation','device'))
             ORDER BY i.id ASC LIMIT 30",
            [$since]
        );
        foreach ($rows as $r) {
            $alerts[] = incident_row($r) + [
                'name' => student_display($r),
                'quiz' => $r['title'],
                'quiz_id' => (int) $r['quiz_id'],
                'attempt_id' => (int) $r['attempt_id'],
                'attempt_status' => $r['attempt_status'],
            ];
        }
    }
    return [
        'last_id' => $last,
        'alerts' => $alerts,
        'live' => (int) val("SELECT COUNT(*) FROM attempts WHERE is_preview = 0 AND status = 'in_progress'"),
        'locked' => (int) val("SELECT COUNT(*) FROM attempts WHERE is_preview = 0 AND status = 'locked'"),
        'pending' => (int) val("SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'pending'"),
    ];
}

/* ------------------------------------------------------------------ */
/*  Live monitoring                                                    */
/* ------------------------------------------------------------------ */

function act_t_live(array $in): array
{
    $quizzes = rows(
        "SELECT q.id, q.title, q.level, q.status, q.access_code,
           (SELECT COUNT(*) FROM attempts a WHERE a.quiz_id = q.id AND a.is_preview = 0 AND a.status IN ('in_progress','locked')) AS running
         FROM quizzes q WHERE q.status IN ('open','closed') ORDER BY q.status = 'open' DESC, running DESC, q.updated_at DESC LIMIT 60"
    );
    $quizId = int_in($in, 'quiz_id', 0);
    if (!$quizId && $quizzes) {
        $quizId = (int) $quizzes[0]['id'];
    }
    $out = [
        'quizzes' => array_map(fn($r) => ['id' => (int) $r['id'], 'title' => $r['title'], 'level' => $r['level'], 'status' => $r['status'], 'running' => (int) $r['running']], $quizzes),
        'quiz' => null,
        'server_ms' => now_ms(),
    ];
    if (!$quizId) {
        return $out;
    }
    sweep_attempts($quizId);
    $quiz = quiz_row($quizId);
    $classIds = quiz_class_ids($quizId);
    $questions = quiz_questions($quizId);
    $qInfo = [];
    foreach ($questions as $i => $q) {
        $qInfo[$q['id']] = ['n' => $i + 1, 'prompt' => mb_substr($q['prompt'], 0, 140), 'time_limit' => $q['time_limit']];
    }

    $attempts = rows(
        "SELECT a.*, u.first_name, u.last_name, c.name AS class_name
         FROM attempts a JOIN users u ON u.id = a.user_id LEFT JOIN classes c ON c.id = u.class_id
         WHERE a.quiz_id = ? AND a.is_preview = 0 ORDER BY u.last_name, u.first_name, a.attempt_no",
        [$quizId]
    );
    $ids = array_map(fn($r) => (int) $r['id'], $attempts);
    $answersBy = [];
    if ($ids) {
        foreach (rows('SELECT attempt_id, question_id, position, status, fraction, time_ms FROM answers WHERE attempt_id IN (' . implode(',', $ids) . ') ORDER BY position', []) as $r) {
            $answersBy[(int) $r['attempt_id']][] = [
                'pos' => (int) $r['position'],
                'qid' => (int) $r['question_id'],
                'status' => $r['status'],
                'fraction' => (float) $r['fraction'],
                'time_ms' => $r['time_ms'] !== null ? (int) $r['time_ms'] : null,
            ];
        }
    }
    $now = now_ms();
    $list = [];
    foreach ($attempts as $r) {
        $a = cast_attempt($r);
        $qids = attempt_qids($a);
        $currentQid = $qids[$a['current_index']] ?? null;
        $list[] = [
            'id' => $a['id'],
            'user_id' => $a['user_id'],
            'name' => student_display($r),
            'class_name' => $r['class_name'],
            'attempt_no' => $a['attempt_no'],
            'status' => $a['status'],
            'finish_reason' => $a['finish_reason'],
            'lock_reason' => $a['lock_reason'],
            'index' => $a['current_index'],
            'total' => count($qids),
            'current_q' => $a['status'] === 'in_progress' && $currentQid && $a['q_started_ms'] !== null ? ($qInfo[$currentQid]['n'] ?? null) : null,
            'q_elapsed_ms' => $a['q_started_ms'] !== null ? $now - $a['q_started_ms'] : null,
            'q_limit_ms' => $currentQid && isset($qInfo[$currentQid]) ? $qInfo[$currentQid]['time_limit'] * 1000 : null,
            'exits' => $a['exits'],
            'incidents' => $a['incidents'],
            'away_ms' => $a['away_ms'],
            'device' => $a['device'],
            'ip' => $a['ip'],
            'started_ms' => $a['started_ms'],
            'finished_ms' => $a['finished_ms'],
            'last_seen_ago_ms' => $now - $a['last_seen_ms'],
            'online' => $a['status'] !== 'finished' && $now - $a['last_seen_ms'] < 7000,
            'score' => $a['score'],
            'max_score' => $a['max_score'],
            'note20' => note20($a['score'], $a['max_score']),
            'points' => $a['points'],
            'zeroed' => $a['zeroed'],
            'warning_pending' => $a['warning_text'] !== null,
            'answers' => array_map(fn($x) => $x + ['n' => $qInfo[$x['qid']]['n'] ?? null], $answersBy[$a['id']] ?? []),
        ];
    }

    $params = [];
    $classSql = '';
    if ($classIds) {
        $classSql = ' AND u.class_id IN (' . implode(',', $classIds) . ')';
    }
    $notStarted = rows(
        "SELECT u.id, u.first_name, u.last_name, c.name AS class_name, u.last_login_at FROM users u LEFT JOIN classes c ON c.id = u.class_id
         WHERE u.role = 'student' AND u.status = 'active' $classSql
         AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = u.id AND a.quiz_id = ? AND a.is_preview = 0)
         ORDER BY c.name, u.last_name, u.first_name",
        [$quizId]
    );

    $since = int_in($in, 'since', 0);
    $incidents = rows(
        "SELECT i.*, u.first_name, u.last_name, a.status AS attempt_status FROM incidents i JOIN attempts a ON a.id = i.attempt_id JOIN users u ON u.id = a.user_id
         WHERE a.quiz_id = ? AND a.is_preview = 0 AND i.id > ? ORDER BY i.id DESC LIMIT 80",
        [$quizId, $since]
    );

    $out['quiz'] = [
        'id' => $quiz['id'],
        'title' => $quiz['title'],
        'level' => $quiz['level'],
        'status' => $quiz['status'],
        'access_code' => $quiz['access_code'],
        'results_released' => $quiz['results_released'],
        'feedback_mode' => $quiz['feedback_mode'],
        'question_count' => count($questions),
        'max_exits' => $quiz['max_exits'],
        'exit_action' => $quiz['exit_action'],
        'questions' => array_values(array_map(fn($id, $x) => ['id' => $id] + $x, array_keys($qInfo), $qInfo)),
    ];
    $out['attempts'] = $list;
    $out['not_started'] = array_map(fn($r) => ['id' => (int) $r['id'], 'name' => student_display($r), 'class_name' => $r['class_name'], 'last_login_at' => $r['last_login_at'] !== null ? (int) $r['last_login_at'] : null], $notStarted);
    $out['incidents'] = array_map(fn($r) => incident_row($r) + ['attempt_id' => (int) $r['attempt_id'], 'name' => student_display($r), 'attempt_status' => $r['attempt_status']], $incidents);
    $out['last_incident_id'] = (int) val('SELECT COALESCE(MAX(id), 0) FROM incidents');
    return $out;
}

function act_t_attempt_action(array $in): array
{
    $action = str_in($in, 'action', 20);
    if (!in_array($action, ['unlock', 'lock', 'warn', 'finish', 'exclude', 'unzero', 'reset'], true)) {
        fail('Action inconnue.');
    }
    return tx(function () use ($in, $action) {
        $a = attempt_for_update(int_in($in, 'attempt_id'));
        $quiz = quiz_row($a['quiz_id']);
        $student = row('SELECT first_name, last_name FROM users WHERE id = ?', [$a['user_id']]);
        $who = student_display($student) . ' — ' . $quiz['title'];
        switch ($action) {
            case 'unlock':
                if ($a['status'] === 'locked') {
                    $a['status'] = 'in_progress';
                    $a['lock_reason'] = null;
                    $a['last_seen_ms'] = now_ms();
                    log_incident($a, 'teacher', 'Quiz débloqué par la professeure', null, false);
                }
                break;
            case 'lock':
                if ($a['status'] === 'in_progress') {
                    cancel_current_question($a);
                    if ($a['status'] === 'in_progress') {
                        $a['status'] = 'locked';
                        $a['lock_reason'] = 'Mis en pause par la professeure';
                    }
                    log_incident($a, 'teacher', 'Quiz verrouillé par la professeure', null, false);
                }
                break;
            case 'warn':
                if ($a['status'] === 'finished') {
                    fail('Cette copie est déjà terminée.');
                }
                $msg = str_in($in, 'message', 300);
                if ($msg === '') {
                    $msg = 'Attention : ton comportement est surveillé. Reste sur le quiz, sinon ta copie sera annulée.';
                }
                $a['warning_text'] = $msg;
                $a['warning_ms'] = now_ms();
                log_incident($a, 'teacher', 'Avertissement envoyé : ' . $msg, null, false);
                break;
            case 'finish':
                finish_attempt($a, 'teacher');
                log_incident($a, 'teacher', 'Copie terminée par la professeure', null, false);
                break;
            case 'exclude':
                finish_attempt($a, 'excluded');
                $a['zeroed'] = true;
                log_incident($a, 'teacher', 'Élève exclu du quiz (note 0/20)', null, false);
                break;
            case 'unzero':
                $a['zeroed'] = false;
                log_incident($a, 'teacher', 'Note rétablie par la professeure', null, false);
                break;
            case 'reset':
                q('DELETE FROM attempts WHERE id = ?', [$a['id']]);
                audit('attempt_reset', $who);
                return ['deleted' => true];
        }
        save_attempt($a);
        audit('attempt_' . $action, $who);
        return ['deleted' => false, 'status' => $a['status'], 'zeroed' => $a['zeroed']];
    });
}

function act_t_live_broadcast(array $in): array
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $msg = str_in($in, 'message', 300);
    if ($msg === '') {
        fail('Écris un message.');
    }
    $n = 0;
    foreach (rows("SELECT id FROM attempts WHERE quiz_id = ? AND is_preview = 0 AND status IN ('in_progress','locked')", [$quiz['id']]) as $r) {
        tx(function () use ($r, $msg, &$n) {
            $a = attempt_for_update((int) $r['id']);
            $a['warning_text'] = $msg;
            $a['warning_ms'] = now_ms();
            log_incident($a, 'teacher', 'Message à toute la classe : ' . $msg, null, false);
            save_attempt($a);
            $n++;
        });
    }
    audit('broadcast', $quiz['title'] . ' : ' . $msg);
    return ['sent' => $n];
}

function act_t_quiz_end_all(array $in): array
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $n = 0;
    foreach (rows("SELECT id FROM attempts WHERE quiz_id = ? AND is_preview = 0 AND status IN ('in_progress','locked')", [$quiz['id']]) as $r) {
        tx(function () use ($r, &$n) {
            $a = attempt_for_update((int) $r['id']);
            finish_attempt($a, 'teacher');
            log_incident($a, 'teacher', 'Quiz terminé pour toute la classe', null, false);
            save_attempt($a);
            $n++;
        });
    }
    if (bool_in($in, 'close')) {
        q("UPDATE quizzes SET status = 'closed', updated_at = ? WHERE id = ?", [time(), $quiz['id']]);
    }
    audit('quiz_end_all', $quiz['title'] . " ($n copies)");
    return ['finished' => $n];
}

/* ------------------------------------------------------------------ */
/*  Quizzes & questions                                                */
/* ------------------------------------------------------------------ */

function act_t_quizzes(array $in): array
{
    $list = rows(
        "SELECT q.*,
          (SELECT COUNT(*) FROM questions x WHERE x.quiz_id = q.id) AS question_count,
          (SELECT COUNT(*) FROM attempts a WHERE a.quiz_id = q.id AND a.is_preview = 0 AND a.status = 'finished') AS finished_count,
          (SELECT COUNT(*) FROM attempts a WHERE a.quiz_id = q.id AND a.is_preview = 0 AND a.status IN ('in_progress','locked')) AS running_count,
          (SELECT AVG(a.score / NULLIF(a.max_score, 0)) * 20 FROM attempts a WHERE a.quiz_id = q.id AND a.is_preview = 0 AND a.status = 'finished') AS avg20
         FROM quizzes q ORDER BY FIELD(q.status, 'open', 'draft', 'closed', 'archived'), q.updated_at DESC"
    );
    $classNames = [];
    foreach (rows('SELECT qc.quiz_id, c.name FROM quiz_classes qc JOIN classes c ON c.id = qc.class_id ORDER BY c.name') as $r) {
        $classNames[(int) $r['quiz_id']][] = $r['name'];
    }
    return ['quizzes' => array_map(function ($r) use ($classNames) {
        $q = cast_quiz($r);
        return [
            'id' => $q['id'],
            'title' => $q['title'],
            'description' => $q['description'],
            'level' => $q['level'],
            'chapter' => $q['chapter'],
            'status' => $q['status'],
            'access_code' => $q['access_code'],
            'opens_at' => $q['opens_at'],
            'closes_at' => $q['closes_at'],
            'feedback_mode' => $q['feedback_mode'],
            'results_released' => $q['results_released'],
            'question_count' => (int) $r['question_count'],
            'finished_count' => (int) $r['finished_count'],
            'running_count' => (int) $r['running_count'],
            'avg20' => $r['avg20'] !== null ? round((float) $r['avg20'], 2) : null,
            'classes' => $classNames[$q['id']] ?? [],
            'updated_at' => (int) $r['updated_at'],
        ];
    }, $list)];
}

function quiz_for_editor(int $id): array
{
    $quiz = quiz_row($id);
    $quiz['class_ids'] = quiz_class_ids($id);
    $quiz['questions'] = quiz_questions($id);
    $quiz['attempt_count'] = (int) val('SELECT COUNT(*) FROM attempts WHERE quiz_id = ? AND is_preview = 0', [$id]);
    return $quiz;
}

function act_t_quiz_get(array $in): array
{
    return ['quiz' => quiz_for_editor(int_in($in, 'quiz_id')), 'classes' => classes_list()];
}

function save_quiz_classes(int $quizId, array $ids): void
{
    q('DELETE FROM quiz_classes WHERE quiz_id = ?', [$quizId]);
    $valid = array_map('intval', array_column(rows('SELECT id FROM classes'), 'id'));
    foreach (array_unique(array_map('intval', $ids)) as $cid) {
        if (in_array($cid, $valid, true)) {
            insert('quiz_classes', ['quiz_id' => $quizId, 'class_id' => $cid]);
        }
    }
}

function act_t_quiz_save(array $in): array
{
    $data = validate_quiz($in);
    $id = int_in($in, 'id', 0);
    $classIds = is_array($in['class_ids'] ?? null) ? $in['class_ids'] : [];
    return tx(function () use ($data, $id, $classIds) {
        $data['updated_at'] = time();
        if ($id) {
            $old = quiz_row($id);
            update('quizzes', $id, $data);
            if ((bool) $data['speed_bonus'] !== $old['speed_bonus']) {
                $quiz = quiz_row($id);
                foreach (quiz_questions($id) as $q) {
                    regrade_question($q, $quiz['speed_bonus']);
                }
            }
            audit('quiz_update', $data['title']);
        } else {
            $data['status'] = 'draft';
            $data['created_at'] = time();
            $id = insert('quizzes', $data);
            audit('quiz_create', $data['title']);
        }
        save_quiz_classes($id, $classIds);
        return ['quiz' => quiz_for_editor($id)];
    });
}

function act_t_quiz_status(array $in): array
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $status = str_in($in, 'status', 20);
    if (!in_array($status, ['draft', 'open', 'closed', 'archived'], true)) {
        fail('Statut invalide.');
    }
    if ($status === 'open' && !(int) val('SELECT COUNT(*) FROM questions WHERE quiz_id = ?', [$quiz['id']])) {
        fail('Ajoute au moins une question avant d’ouvrir le quiz.');
    }
    q('UPDATE quizzes SET status = ?, updated_at = ? WHERE id = ?', [$status, time(), $quiz['id']]);
    audit('quiz_status', $quiz['title'] . ' → ' . $status);
    return ['status' => $status];
}

function act_t_quiz_release(array $in): array
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $released = bool_in($in, 'released');
    q('UPDATE quizzes SET results_released = ?, updated_at = ? WHERE id = ?', [$released ? 1 : 0, time(), $quiz['id']]);
    audit($released ? 'results_released' : 'results_hidden', $quiz['title']);
    return ['results_released' => $released];
}

function act_t_quiz_delete(array $in): array
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $images = array_filter(array_column(rows('SELECT image FROM questions WHERE quiz_id = ? AND image IS NOT NULL', [$quiz['id']]), 'image'));
    q('DELETE FROM quizzes WHERE id = ?', [$quiz['id']]);
    foreach ($images as $img) {
        delete_image_if_unused($img);
    }
    audit('quiz_delete', $quiz['title']);
    return ['deleted' => true];
}

function copy_image(?string $image): ?string
{
    if (!$image || !is_file(upload_dir() . '/' . $image)) {
        return null;
    }
    $ext = pathinfo($image, PATHINFO_EXTENSION);
    $name = random_hex(16) . '.' . $ext;
    copy(upload_dir() . '/' . $image, upload_dir() . '/' . $name);
    return $name;
}

function delete_image_if_unused(?string $image): void
{
    if (!$image || !preg_match('/^[a-f0-9]{32}\.(jpg|png|gif|webp)$/', $image)) {
        return;
    }
    if (!(int) val('SELECT COUNT(*) FROM questions WHERE image = ?', [$image])) {
        @unlink(upload_dir() . '/' . $image);
    }
}

function act_t_quiz_duplicate(array $in): array
{
    $src = quiz_row(int_in($in, 'quiz_id'));
    return tx(function () use ($src) {
        $row = row('SELECT * FROM quizzes WHERE id = ?', [$src['id']]);
        unset($row['id']);
        $row['title'] = mb_substr('Copie de ' . $row['title'], 0, 200);
        $row['status'] = 'draft';
        $row['results_released'] = 0;
        $row['created_at'] = $row['updated_at'] = time();
        $id = insert('quizzes', $row);
        foreach (rows('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id', [$src['id']]) as $q) {
            unset($q['id']);
            $q['quiz_id'] = $id;
            $q['image'] = copy_image($q['image']);
            $q['created_at'] = $q['updated_at'] = time();
            insert('questions', $q);
        }
        save_quiz_classes($id, quiz_class_ids($src['id']));
        audit('quiz_duplicate', $src['title']);
        return ['id' => $id];
    });
}

function act_t_question_save(array $in): array
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $data = validate_question($in);
    $id = int_in($in, 'id', 0);
    return tx(function () use ($quiz, $data, $id) {
        $data['updated_at'] = time();
        if ($id) {
            $old = row('SELECT * FROM questions WHERE id = ? AND quiz_id = ?', [$id, $quiz['id']]);
            if (!$old) {
                fail('Question introuvable.', 404);
            }
            update('questions', $id, $data);
            if ($old['image'] && $old['image'] !== $data['image']) {
                delete_image_if_unused($old['image']);
            }
            $q = cast_question(row('SELECT * FROM questions WHERE id = ?', [$id]));
            regrade_question($q, $quiz['speed_bonus']);
        } else {
            $data['quiz_id'] = $quiz['id'];
            $data['position'] = 1 + (int) val('SELECT COALESCE(MAX(position), -1) FROM questions WHERE quiz_id = ?', [$quiz['id']]);
            $data['created_at'] = time();
            $id = insert('questions', $data);
            $q = cast_question(row('SELECT * FROM questions WHERE id = ?', [$id]));
        }
        q('UPDATE quizzes SET updated_at = ? WHERE id = ?', [time(), $quiz['id']]);
        return ['question' => $q];
    });
}

function act_t_question_delete(array $in): array
{
    $q = row('SELECT * FROM questions WHERE id = ?', [int_in($in, 'question_id')]);
    if (!$q) {
        fail('Question introuvable.', 404);
    }
    return tx(function () use ($q) {
        q('DELETE FROM questions WHERE id = ?', [(int) $q['id']]);
        delete_image_if_unused($q['image']);
        recompute_quiz_attempts((int) $q['quiz_id']);
        q('UPDATE quizzes SET updated_at = ? WHERE id = ?', [time(), (int) $q['quiz_id']]);
        return ['deleted' => true];
    });
}

function act_t_question_duplicate(array $in): array
{
    $q = row('SELECT * FROM questions WHERE id = ?', [int_in($in, 'question_id')]);
    if (!$q) {
        fail('Question introuvable.', 404);
    }
    return tx(function () use ($q) {
        q('UPDATE questions SET position = position + 1 WHERE quiz_id = ? AND position > ?', [(int) $q['quiz_id'], (int) $q['position']]);
        unset($q['id']);
        $q['position'] = (int) $q['position'] + 1;
        $q['image'] = copy_image($q['image']);
        $q['created_at'] = $q['updated_at'] = time();
        $id = insert('questions', $q);
        return ['question' => cast_question(row('SELECT * FROM questions WHERE id = ?', [$id]))];
    });
}

function act_t_question_reorder(array $in): array
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $ids = array_map('intval', is_array($in['ids'] ?? null) ? $in['ids'] : []);
    $existing = array_map('intval', array_column(rows('SELECT id FROM questions WHERE quiz_id = ?', [$quiz['id']]), 'id'));
    sort($existing);
    $check = $ids;
    sort($check);
    if ($check !== $existing) {
        fail('Liste de questions invalide.');
    }
    tx(function () use ($ids) {
        foreach ($ids as $pos => $id) {
            q('UPDATE questions SET position = ? WHERE id = ?', [$pos, $id]);
        }
    });
    return ['ok' => true];
}

function act_t_import(array $in): array
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    [$parsed, $errors] = parse_aiken(str_in($in, 'text', 200000));
    $time = max(0, min(3600, int_in($in, 'time_limit', 30)));
    $points = max(0, min(100, (float) ($in['points'] ?? 1)));
    $created = 0;
    tx(function () use ($quiz, $parsed, $time, $points, &$created, &$errors) {
        $pos = 1 + (int) val('SELECT COALESCE(MAX(position), -1) FROM questions WHERE quiz_id = ?', [$quiz['id']]);
        foreach ($parsed as $i => $p) {
            try {
                $data = validate_question($p + ['time_limit' => $time, 'points' => $points, 'partial' => true]);
            } catch (ApiError $e) {
                $errors[] = 'Question ' . ($i + 1) . ' : ' . $e->getMessage();
                continue;
            }
            $data['quiz_id'] = $quiz['id'];
            $data['position'] = $pos++;
            $data['created_at'] = $data['updated_at'] = time();
            insert('questions', $data);
            $created++;
        }
        q('UPDATE quizzes SET updated_at = ? WHERE id = ?', [time(), $quiz['id']]);
    });
    return ['created' => $created, 'errors' => $errors];
}

function act_t_quiz_export_json(array $in): void
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $export = [
        'format' => 'quiz-ses/1',
        'title' => $quiz['title'],
        'description' => $quiz['description'],
        'level' => $quiz['level'],
        'chapter' => $quiz['chapter'],
        'questions' => array_map(fn($q) => [
            'type' => $q['type'],
            'prompt' => $q['prompt'],
            'data' => $q['data'],
            'points' => $q['points'],
            'time_limit' => $q['time_limit'],
            'partial' => $q['partial'],
            'explanation' => $q['explanation'],
        ], quiz_questions($quiz['id'])),
    ];
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="quiz-' . slugify($quiz['title']) . '.json"');
    echo json_encode($export, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function act_t_quiz_import_json(array $in): array
{
    $src = json_decode(str_in($in, 'json', 2000000), true);
    if (!is_array($src) || ($src['format'] ?? '') !== 'quiz-ses/1' || !is_array($src['questions'] ?? null)) {
        fail('Fichier de quiz invalide.');
    }
    $quizData = validate_quiz([
        'title' => $src['title'] ?? 'Quiz importé',
        'description' => $src['description'] ?? '',
        'level' => $src['level'] ?? 'Autre',
        'chapter' => $src['chapter'] ?? '',
        'max_attempts' => 1,
        'shuffle_questions' => true,
        'shuffle_choices' => true,
        'feedback_mode' => 'release',
        'show_leaderboard' => true,
        'speed_bonus' => true,
        'require_fullscreen' => true,
        'exit_action' => 'lock',
    ]);
    return tx(function () use ($quizData, $src) {
        $quizData['status'] = 'draft';
        $quizData['created_at'] = $quizData['updated_at'] = time();
        $id = insert('quizzes', $quizData);
        foreach (array_values($src['questions']) as $pos => $q) {
            if (!is_array($q)) {
                continue;
            }
            $q['image'] = null;
            $data = validate_question($q);
            $data['quiz_id'] = $id;
            $data['position'] = $pos;
            $data['created_at'] = $data['updated_at'] = time();
            insert('questions', $data);
        }
        audit('quiz_import', $quizData['title']);
        return ['id' => $id];
    });
}

function slugify(string $s): string
{
    $s = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower(strip_accents($s))), '-');
    return $s !== '' ? substr($s, 0, 60) : 'quiz';
}

function act_t_upload(array $in): array
{
    $f = $_FILES['image'] ?? null;
    if (!is_array($f) || !isset($f['error']) || is_array($f['error']) || $f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
        fail('Envoi de l’image impossible (6 Mo maximum).');
    }
    if ($f['size'] > 6 * 1024 * 1024) {
        fail('Image trop lourde (6 Mo maximum).');
    }
    $info = @getimagesize($f['tmp_name']);
    $types = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'];
    if (!$info || !isset($types[$info[2]]) || $info[0] < 1 || $info[1] < 1 || $info[0] * $info[1] > 40000000) {
        fail('Formats acceptés : JPG, PNG, GIF ou WEBP.');
    }
    if (function_exists('finfo_open')) {
        $mime = (string) finfo_file(finfo_open(FILEINFO_MIME_TYPE), $f['tmp_name']);
        if (!str_starts_with($mime, 'image/')) {
            fail('Ce fichier n’est pas une image.');
        }
    }
    $ext = $types[$info[2]];
    $dir = upload_dir();
    if (!is_dir($dir) || !is_writable($dir)) {
        fail('Le dossier uploads/ n’est pas accessible en écriture sur le serveur.', 500, 'uploads');
    }
    $name = random_hex(16) . '.' . $ext;
    $dest = $dir . '/' . $name;

    if (extension_loaded('gd') && $ext !== 'gif') {
        // Re-encoding strips metadata and anything hidden inside the file.
        $img = @imagecreatefromstring((string) file_get_contents($f['tmp_name']));
        if (!$img) {
            fail('Image illisible.');
        }
        if ($ext === 'jpg' && function_exists('exif_read_data')) {
            $exif = @exif_read_data($f['tmp_name']);
            $rot = [3 => 180, 6 => -90, 8 => 90][(int) ($exif['Orientation'] ?? 1)] ?? 0;
            if ($rot) {
                $img = imagerotate($img, $rot, 0);
            }
        }
        $w = imagesx($img);
        $h = imagesy($img);
        $scale = min(1, 1600 / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $out = imagecreatetruecolor($nw, $nh);
        if ($ext !== 'jpg') {
            imagealphablending($out, false);
            imagesavealpha($out, true);
            imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
        } else {
            imagefill($out, 0, 0, imagecolorallocate($out, 255, 255, 255));
        }
        imagecopyresampled($out, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
        $ok = match ($ext) {
            'jpg' => imagejpeg($out, $dest, 86),
            'png' => imagepng($out, $dest, 6),
            'webp' => function_exists('imagewebp') ? imagewebp($out, $dest, 86) : false,
        };
        if (!$ok) {
            fail('Impossible d’enregistrer l’image.');
        }
    } elseif (!move_uploaded_file($f['tmp_name'], $dest)) {
        fail('Impossible d’enregistrer l’image.');
    }
    @chmod($dest, 0644);
    return ['file' => $name];
}

/* ------------------------------------------------------------------ */
/*  Results                                                            */
/* ------------------------------------------------------------------ */

function act_t_results(array $in): array
{
    sweep_attempts(int_in($in, 'quiz_id'));
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $classId = int_in($in, 'class_id', 0);
    $questions = quiz_questions($quiz['id']);
    $params = [$quiz['id']];
    $classSql = '';
    if ($classId) {
        $classSql = ' AND u.class_id = ?';
        $params[] = $classId;
    }
    $attempts = rows(
        "SELECT a.*, u.first_name, u.last_name, u.class_id, c.name AS class_name
         FROM attempts a JOIN users u ON u.id = a.user_id LEFT JOIN classes c ON c.id = u.class_id
         WHERE a.quiz_id = ? AND a.is_preview = 0 $classSql
         ORDER BY u.last_name, u.first_name, a.attempt_no",
        $params
    );

    $list = [];
    $best = [];
    $finishedIds = [];
    foreach ($attempts as $r) {
        $a = cast_attempt($r);
        $n20 = note20($a['score'], $a['max_score']);
        $list[] = [
            'id' => $a['id'],
            'user_id' => $a['user_id'],
            'name' => student_display($r),
            'first_name' => $r['first_name'],
            'last_name' => $r['last_name'],
            'class_name' => $r['class_name'],
            'attempt_no' => $a['attempt_no'],
            'status' => $a['status'],
            'finish_reason' => $a['finish_reason'],
            'score' => $a['score'],
            'max_score' => $a['max_score'],
            'note20' => $n20,
            'points' => $a['points'],
            'zeroed' => $a['zeroed'],
            'exits' => $a['exits'],
            'incidents' => $a['incidents'],
            'away_ms' => $a['away_ms'],
            'device' => $a['device'],
            'started_ms' => $a['started_ms'],
            'finished_ms' => $a['finished_ms'],
            'duration_ms' => $a['finished_ms'] ? $a['finished_ms'] - $a['started_ms'] : null,
        ];
        if ($a['status'] === 'finished') {
            $finishedIds[] = $a['id'];
            if ($n20 !== null && (!isset($best[$a['user_id']]) || $n20 > $best[$a['user_id']])) {
                $best[$a['user_id']] = $n20;
            }
        }
    }

    $notes = array_values($best);
    $stats = null;
    if ($notes) {
        $mean = array_sum($notes) / count($notes);
        $var = array_sum(array_map(fn($x) => ($x - $mean) ** 2, $notes)) / count($notes);
        $hist = array_fill(0, 10, 0);
        foreach ($notes as $n) {
            $hist[min(9, (int) floor($n / 2))]++;
        }
        $stats = [
            'count' => count($notes),
            'mean' => round($mean, 2),
            'median' => round(median($notes), 2),
            'min' => round(min($notes), 2),
            'max' => round(max($notes), 2),
            'stddev' => round(sqrt($var), 2),
            'pass_rate' => round(count(array_filter($notes, fn($n) => $n >= 10)) / count($notes) * 100),
            'histogram' => $hist,
        ];
    }

    $qStats = [];
    $answersBy = [];
    if ($finishedIds) {
        foreach (rows('SELECT question_id, response, status, fraction, time_ms FROM answers WHERE attempt_id IN (' . implode(',', $finishedIds) . ')') as $r) {
            $answersBy[(int) $r['question_id']][] = $r;
        }
    }
    foreach ($questions as $i => $q) {
        $ans = $answersBy[$q['id']] ?? [];
        $answered = array_filter($ans, fn($x) => $x['status'] === 'answered');
        $times = array_filter(array_map(fn($x) => $x['time_ms'] !== null ? (int) $x['time_ms'] : null, $answered), fn($t) => $t !== null);
        $dist = [];
        $wrongTexts = [];
        foreach ($answered as $x) {
            $resp = json_dec($x['response'], null);
            if (!is_array($resp)) {
                continue;
            }
            if ($q['type'] === 'single' && isset($resp['choice'])) {
                $dist[$resp['choice']] = ($dist[$resp['choice']] ?? 0) + 1;
            } elseif ($q['type'] === 'multiple') {
                foreach ((array) ($resp['choices'] ?? []) as $c) {
                    $dist[$c] = ($dist[$c] ?? 0) + 1;
                }
            } elseif ($q['type'] === 'truefalse' && isset($resp['value'])) {
                $k = $resp['value'] ? 'true' : 'false';
                $dist[$k] = ($dist[$k] ?? 0) + 1;
            } elseif (in_array($q['type'], ['short', 'numeric'], true) && (float) $x['fraction'] < 1) {
                $t = mb_substr(trim((string) ($resp['text'] ?? '')), 0, 60);
                if ($t !== '') {
                    $wrongTexts[$t] = ($wrongTexts[$t] ?? 0) + 1;
                }
            }
        }
        arsort($wrongTexts);
        $qStats[] = [
            'id' => $q['id'],
            'n' => $i + 1,
            'type' => $q['type'],
            'prompt' => $q['prompt'],
            'points' => $q['points'],
            'served' => count($ans),
            'answered' => count($answered),
            'timeouts' => count(array_filter($ans, fn($x) => $x['status'] === 'timeout')),
            'cancelled' => count(array_filter($ans, fn($x) => $x['status'] === 'cancelled')),
            'success' => $ans ? round(array_sum(array_map(fn($x) => (float) $x['fraction'], $ans)) / count($ans) * 100) : null,
            'avg_time_ms' => $times ? (int) round(array_sum($times) / count($times)) : null,
            'distribution' => $dist,
            'wrong_answers' => array_slice(array_map(fn($k, $v) => ['text' => (string) $k, 'count' => $v], array_keys($wrongTexts), $wrongTexts), 0, 5),
            'correction' => correction_of($q),
        ];
    }

    return [
        'quiz' => [
            'id' => $quiz['id'],
            'title' => $quiz['title'],
            'level' => $quiz['level'],
            'status' => $quiz['status'],
            'results_released' => $quiz['results_released'],
            'feedback_mode' => $quiz['feedback_mode'],
            'show_leaderboard' => $quiz['show_leaderboard'],
        ],
        'classes' => classes_list(),
        'class_id' => $classId ?: null,
        'attempts' => $list,
        'stats' => $stats,
        'questions' => $qStats,
        'leaderboard' => $quiz['show_leaderboard'] ? leaderboard_data($quiz, null)['top'] : [],
    ];
}

function act_t_attempt(array $in): array
{
    $r = row('SELECT a.*, u.first_name, u.last_name, c.name AS class_name FROM attempts a JOIN users u ON u.id = a.user_id LEFT JOIN classes c ON c.id = u.class_id WHERE a.id = ?', [int_in($in, 'attempt_id')]);
    if (!$r) {
        fail('Copie introuvable.', 404);
    }
    $a = cast_attempt($r);
    $quiz = quiz_row($a['quiz_id']);
    return [
        'attempt' => [
            'id' => $a['id'],
            'status' => $a['status'],
            'finish_reason' => $a['finish_reason'],
            'lock_reason' => $a['lock_reason'],
            'attempt_no' => $a['attempt_no'],
            'score' => $a['score'],
            'max_score' => $a['max_score'],
            'note20' => note20($a['score'], $a['max_score']),
            'points' => $a['points'],
            'zeroed' => $a['zeroed'],
            'exits' => $a['exits'],
            'incidents' => $a['incidents'],
            'away_ms' => $a['away_ms'],
            'started_ms' => $a['started_ms'],
            'finished_ms' => $a['finished_ms'],
            'device' => $a['device'],
            'ip' => $a['ip'],
            'user_agent' => $a['user_agent'],
            'index' => $a['current_index'],
            'total' => count(attempt_qids($a)),
        ],
        'student' => ['id' => $a['user_id'], 'name' => student_display($r), 'class_name' => $r['class_name']],
        'quiz' => ['id' => $quiz['id'], 'title' => $quiz['title'], 'level' => $quiz['level']],
        'items' => attempt_corrections($a),
        'incidents' => array_map('incident_row', rows('SELECT * FROM incidents WHERE attempt_id = ? ORDER BY created_ms, id', [$a['id']])),
    ];
}

function act_t_answer_override(array $in): array
{
    $ans = row('SELECT an.*, q.points AS max_points FROM answers an JOIN questions q ON q.id = an.question_id WHERE an.id = ?', [int_in($in, 'answer_id')]);
    if (!$ans) {
        fail('Réponse introuvable.', 404);
    }
    $score = $in['score'] ?? null;
    if ($score === null || $score === '') {
        $value = null;
    } else {
        $value = round((float) str_replace(',', '.', (string) $score), 2);
        if ($value < 0 || $value > (float) $ans['max_points']) {
            fail('La note doit être comprise entre 0 et ' . (float) $ans['max_points'] . '.');
        }
    }
    q('UPDATE answers SET override_score = ? WHERE id = ?', [$value, (int) $ans['id']]);
    recompute_attempt((int) $ans['attempt_id']);
    audit('answer_override', 'Copie #' . $ans['attempt_id'] . ' : ' . ($value === null ? 'note automatique' : $value));
    return ['ok' => true];
}

function csv_safe($v): string
{
    $v = (string) $v;
    return preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;
}

function act_t_export(array $in): void
{
    $quiz = quiz_row(int_in($in, 'quiz_id'));
    $rows = rows(
        "SELECT a.*, u.first_name, u.last_name, c.name AS class_name
         FROM attempts a JOIN users u ON u.id = a.user_id LEFT JOIN classes c ON c.id = u.class_id
         WHERE a.quiz_id = ? AND a.is_preview = 0 ORDER BY c.name, u.last_name, u.first_name, a.attempt_no",
        [$quiz['id']]
    );
    $status = ['in_progress' => 'En cours', 'locked' => 'Verrouillé', 'finished' => 'Terminé'];
    $reasons = ['completed' => 'Terminé', 'timeout' => 'Temps écoulé', 'exits' => 'Sorties', 'teacher' => 'Arrêté par la professeure', 'excluded' => 'Exclu'];
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="resultats-' . slugify($quiz['title']) . '-' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['Nom', 'Prénom', 'Classe', 'Tentative', 'Statut', 'Fin', 'Note /20', 'Score', 'Barème', 'Points', 'Durée (min)', 'Sorties', 'Incidents', 'Temps hors quiz (s)', 'Appareil', 'Début', 'Fin'], ';');
    foreach ($rows as $r) {
        $a = cast_attempt($r);
        $n20 = note20($a['score'], $a['max_score']);
        fputcsv($out, array_map('csv_safe', [
            mb_strtoupper($r['last_name']),
            $r['first_name'],
            $r['class_name'] ?? '',
            $a['attempt_no'],
            $status[$a['status']] ?? $a['status'],
            $reasons[$a['finish_reason'] ?? ''] ?? '',
            $n20 !== null ? str_replace('.', ',', (string) $n20) : '',
            str_replace('.', ',', (string) $a['score']),
            str_replace('.', ',', (string) $a['max_score']),
            $a['points'],
            $a['finished_ms'] ? str_replace('.', ',', (string) round(($a['finished_ms'] - $a['started_ms']) / 60000, 1)) : '',
            $a['exits'],
            $a['incidents'],
            (int) round($a['away_ms'] / 1000),
            $a['device'],
            date('d/m/Y H:i', intdiv($a['started_ms'], 1000)),
            $a['finished_ms'] ? date('d/m/Y H:i', intdiv($a['finished_ms'], 1000)) : '',
        ]), ';');
    }
    fclose($out);
    exit;
}

/* ------------------------------------------------------------------ */
/*  Students & classes                                                 */
/* ------------------------------------------------------------------ */

function classes_list(): array
{
    return array_map(fn($r) => ['id' => (int) $r['id'], 'name' => $r['name'], 'students' => (int) $r['students']],
        rows("SELECT c.id, c.name, (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'student') AS students FROM classes c ORDER BY c.name"));
}

function act_t_students(array $in): array
{
    $list = rows(
        "SELECT u.id, u.first_name, u.last_name, u.status, u.class_id, c.name AS class_name, u.created_at, u.last_login_at, u.must_change_password,
           (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id AND a.is_preview = 0 AND a.status = 'finished') AS finished,
           (SELECT AVG(a.score / NULLIF(a.max_score, 0)) * 20 FROM attempts a WHERE a.user_id = u.id AND a.is_preview = 0 AND a.status = 'finished') AS avg20,
           (SELECT COALESCE(SUM(a.exits), 0) FROM attempts a WHERE a.user_id = u.id AND a.is_preview = 0) AS exits
         FROM users u LEFT JOIN classes c ON c.id = u.class_id
         WHERE u.role = 'student'
         ORDER BY FIELD(u.status, 'pending', 'active', 'disabled'), c.name, u.last_name, u.first_name"
    );
    return [
        'students' => array_map(fn($r) => [
            'id' => (int) $r['id'],
            'first_name' => $r['first_name'],
            'last_name' => $r['last_name'],
            'name' => student_display($r),
            'status' => $r['status'],
            'class_id' => $r['class_id'] !== null ? (int) $r['class_id'] : null,
            'class_name' => $r['class_name'],
            'created_at' => (int) $r['created_at'],
            'last_login_at' => $r['last_login_at'] !== null ? (int) $r['last_login_at'] : null,
            'must_change_password' => (bool) $r['must_change_password'],
            'finished' => (int) $r['finished'],
            'avg20' => $r['avg20'] !== null ? round((float) $r['avg20'], 2) : null,
            'exits' => (int) $r['exits'],
        ], $list),
        'classes' => classes_list(),
    ];
}

function act_t_student(array $in): array
{
    $u = row("SELECT u.*, c.name AS class_name FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = ? AND u.role = 'student'", [int_in($in, 'student_id')]);
    if (!$u) {
        fail('Élève introuvable.', 404);
    }
    $attempts = rows(
        "SELECT a.id, a.status, a.finish_reason, a.score, a.max_score, a.zeroed, a.exits, a.incidents, a.started_ms, a.finished_ms, a.attempt_no, q.title, q.id AS quiz_id
         FROM attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.user_id = ? AND a.is_preview = 0 ORDER BY a.started_ms DESC",
        [(int) $u['id']]
    );
    return [
        'student' => public_user($u) + ['name' => student_display($u), 'created_at' => (int) $u['created_at'], 'last_login_at' => $u['last_login_at'] !== null ? (int) $u['last_login_at'] : null],
        'attempts' => array_map(fn($r) => [
            'id' => (int) $r['id'],
            'quiz_id' => (int) $r['quiz_id'],
            'title' => $r['title'],
            'attempt_no' => (int) $r['attempt_no'],
            'status' => $r['status'],
            'finish_reason' => $r['finish_reason'],
            'note20' => note20((float) $r['score'], (float) $r['max_score']),
            'zeroed' => (bool) $r['zeroed'],
            'exits' => (int) $r['exits'],
            'incidents' => (int) $r['incidents'],
            'started_ms' => (int) $r['started_ms'],
            'finished_ms' => $r['finished_ms'] !== null ? (int) $r['finished_ms'] : null,
        ], $attempts),
        'classes' => classes_list(),
    ];
}

function temp_password(): string
{
    $words = ['pib', 'eco', 'euro', 'marche', 'socio', 'budget', 'bourse', 'credit', 'emploi', 'capital'];
    return $words[random_int(0, count($words) - 1)] . '-' . random_digits(4);
}

function act_t_student_action(array $in): array
{
    $u = row("SELECT * FROM users WHERE id = ? AND role = 'student'", [int_in($in, 'student_id')]);
    if (!$u) {
        fail('Élève introuvable.', 404);
    }
    $id = (int) $u['id'];
    $name = student_display($u);
    $action = str_in($in, 'action', 20);
    switch ($action) {
        case 'validate':
        case 'enable':
            q("UPDATE users SET status = 'active' WHERE id = ?", [$id]);
            break;
        case 'disable':
            q("UPDATE users SET status = 'disabled', session_token = NULL WHERE id = ?", [$id]);
            break;
        case 'class':
            $cid = int_in($in, 'class_id', 0);
            if ($cid && !val('SELECT id FROM classes WHERE id = ?', [$cid])) {
                fail('Classe introuvable.');
            }
            q('UPDATE users SET class_id = ? WHERE id = ?', [$cid ?: null, $id]);
            break;
        case 'rename':
            $first = clean_name(str_in($in, 'first_name', 60));
            $last = clean_name(str_in($in, 'last_name', 60));
            if (!valid_name($first) || !valid_name($last)) {
                fail('Prénom ou nom invalide.');
            }
            $key = student_key($first, $last);
            if (val("SELECT id FROM users WHERE role = 'student' AND login_key = ? AND id <> ?", [$key, $id])) {
                fail('Un autre élève porte déjà ce nom.');
            }
            q('UPDATE users SET first_name = ?, last_name = ?, login_key = ? WHERE id = ?', [$first, $last, $key, $id]);
            break;
        case 'reset_password':
            $temp = temp_password();
            q('UPDATE users SET password_hash = ?, must_change_password = 1, session_token = NULL WHERE id = ?', [password_hash($temp, PASSWORD_DEFAULT), $id]);
            throttle_clear('s:' . $u['login_key']);
            audit('student_password_reset', $name);
            return ['temp_password' => $temp];
        case 'delete':
            q('DELETE FROM users WHERE id = ?', [$id]);
            audit('student_delete', $name);
            return ['deleted' => true];
        default:
            fail('Action inconnue.');
    }
    audit('student_' . $action, $name);
    return ['ok' => true];
}

function act_t_students_bulk(array $in): array
{
    $action = str_in($in, 'action', 20);
    $ids = array_values(array_filter(array_map('intval', is_array($in['ids'] ?? null) ? $in['ids'] : [])));
    if (!$ids) {
        fail('Aucun élève sélectionné.');
    }
    $in_ = implode(',', array_fill(0, count($ids), '?'));
    switch ($action) {
        case 'validate':
            q("UPDATE users SET status = 'active' WHERE role = 'student' AND id IN ($in_)", $ids);
            break;
        case 'class':
            $cid = int_in($in, 'class_id', 0);
            if ($cid && !val('SELECT id FROM classes WHERE id = ?', [$cid])) {
                fail('Classe introuvable.');
            }
            q("UPDATE users SET class_id = ? WHERE role = 'student' AND id IN ($in_)", array_merge([$cid ?: null], $ids));
            break;
        case 'delete':
            q("DELETE FROM users WHERE role = 'student' AND id IN ($in_)", $ids);
            break;
        default:
            fail('Action inconnue.');
    }
    audit('students_bulk_' . $action, count($ids) . ' élève(s)');
    return ['ok' => true, 'count' => count($ids)];
}

function act_t_classes(array $in): array
{
    return ['classes' => classes_list()];
}

function act_t_class_save(array $in): array
{
    $name = trim(preg_replace('/\s+/u', ' ', str_in($in, 'name', 60)));
    if ($name === '') {
        fail('Donne un nom à la classe (ex : 2nde 3).');
    }
    $id = int_in($in, 'id', 0);
    if (val('SELECT id FROM classes WHERE name = ? AND id <> ?', [$name, $id])) {
        fail('Cette classe existe déjà.');
    }
    if ($id) {
        q('UPDATE classes SET name = ? WHERE id = ?', [$name, $id]);
    } else {
        $id = insert('classes', ['name' => $name, 'created_at' => time()]);
    }
    audit('class_save', $name);
    return ['classes' => classes_list(), 'id' => $id];
}

function act_t_class_delete(array $in): array
{
    $c = row('SELECT * FROM classes WHERE id = ?', [int_in($in, 'class_id')]);
    if (!$c) {
        fail('Classe introuvable.', 404);
    }
    q('DELETE FROM classes WHERE id = ?', [(int) $c['id']]);
    audit('class_delete', $c['name']);
    return ['classes' => classes_list()];
}

/* ------------------------------------------------------------------ */
/*  Settings                                                           */
/* ------------------------------------------------------------------ */

function act_t_settings(array $in): array
{
    $s = settings_all();
    return [
        'settings' => [
            'site_name' => $s['site_name'],
            'teacher_name' => $s['teacher_name'],
            'allow_registration' => $s['allow_registration'] === '1',
            'require_validation' => $s['require_validation'] === '1',
        ],
        'my_ip' => client_ip(),
    ];
}

function act_t_settings_save(array $in): array
{
    $site = str_in($in, 'site_name', 60);
    $teacher = str_in($in, 'teacher_name', 60);
    if ($site === '' || $teacher === '') {
        fail('Le nom du site et le nom de la professeure sont obligatoires.');
    }
    set_setting('site_name', $site);
    set_setting('teacher_name', $teacher);
    set_setting('allow_registration', bool_in($in, 'allow_registration') ? '1' : '0');
    set_setting('require_validation', bool_in($in, 'require_validation') ? '1' : '0');
    audit('settings_update');
    return ['ok' => true];
}

function act_t_audit(array $in): array
{
    return ['entries' => array_map(fn($r) => [
        'id' => (int) $r['id'],
        'action' => $r['action'],
        'detail' => $r['detail'],
        'ip' => $r['ip'],
        'created_at' => (int) $r['created_at'],
    ], rows('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300'))];
}

function act_t_my_ip(array $in): array
{
    return ['ip' => client_ip()];
}
