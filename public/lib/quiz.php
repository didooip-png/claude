<?php
defined('APP') || exit;

const QUIZ_LEVELS = ['Seconde', 'Première', 'Terminale', 'Autre'];

function quiz_row(int $id): array
{
    $quiz = row('SELECT * FROM quizzes WHERE id = ?', [$id]);
    if (!$quiz) {
        fail('Quiz introuvable.', 404, 'not_found');
    }
    return cast_quiz($quiz);
}

function cast_quiz(array $q): array
{
    foreach (['id', 'max_attempts', 'time_limit', 'pool_size', 'max_exits'] as $k) {
        $q[$k] = (int) $q[$k];
    }
    foreach (['shuffle_questions', 'shuffle_choices', 'results_released', 'show_leaderboard', 'speed_bonus', 'require_fullscreen'] as $k) {
        $q[$k] = (bool) $q[$k];
    }
    $q['opens_at'] = $q['opens_at'] !== null ? (int) $q['opens_at'] : null;
    $q['closes_at'] = $q['closes_at'] !== null ? (int) $q['closes_at'] : null;
    return $q;
}

function cast_question(array $r): array
{
    return [
        'id' => (int) $r['id'],
        'quiz_id' => (int) $r['quiz_id'],
        'position' => (int) $r['position'],
        'type' => $r['type'],
        'prompt' => $r['prompt'],
        'image' => $r['image'],
        'data' => json_dec($r['data']),
        'points' => (float) $r['points'],
        'time_limit' => (int) $r['time_limit'],
        'partial' => (bool) $r['partial'],
        'explanation' => $r['explanation'],
    ];
}

function quiz_questions(int $quizId): array
{
    return array_map('cast_question', rows('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position, id', [$quizId]));
}

function questions_by_ids(array $ids): array
{
    $ids = array_values(array_filter(array_map('intval', $ids)));
    if (!$ids) {
        return [];
    }
    $out = [];
    foreach (rows('SELECT * FROM questions WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids) as $r) {
        $out[(int) $r['id']] = cast_question($r);
    }
    return $out;
}

function quiz_class_ids(int $quizId): array
{
    return array_map('intval', array_column(rows('SELECT class_id FROM quiz_classes WHERE quiz_id = ?', [$quizId]), 'class_id'));
}

function quiz_window(array $quiz): string
{
    $now = time();
    if ($quiz['opens_at'] && $now < $quiz['opens_at']) {
        return 'not_yet';
    }
    if ($quiz['closes_at'] && $now > $quiz['closes_at']) {
        return 'ended';
    }
    return 'open';
}

function student_can_see_quiz(array $quiz, array $user): bool
{
    if ($quiz['status'] !== 'open') {
        return false;
    }
    $classes = quiz_class_ids($quiz['id']);
    return !$classes || ($user['class_id'] !== null && in_array((int) $user['class_id'], $classes, true));
}

/** Question as sent to a student: never contains the correct answer. */
function public_question(array $q, array $orders): array
{
    $out = [
        'id' => $q['id'],
        'type' => $q['type'],
        'prompt' => $q['prompt'],
        'image' => $q['image'],
        'points' => $q['points'],
        'time_limit' => $q['time_limit'],
    ];
    $order = $orders[(string) $q['id']] ?? null;
    switch ($q['type']) {
        case 'single':
        case 'multiple':
            $byId = [];
            foreach ($q['data']['choices'] as $c) {
                $byId[$c['id']] = $c['text'];
            }
            $ids = is_array($order) ? array_values(array_filter($order, fn($id) => isset($byId[$id]))) : array_keys($byId);
            foreach (array_keys($byId) as $id) {
                if (!in_array($id, $ids, true)) {
                    $ids[] = $id;
                }
            }
            $out['choices'] = array_map(fn($id) => ['id' => $id, 'text' => $byId[$id]], $ids);
            break;
        case 'ordering':
            $byId = [];
            foreach ($q['data']['items'] as $it) {
                $byId[$it['id']] = $it['text'];
            }
            $ids = is_array($order) ? array_values(array_filter($order, fn($id) => isset($byId[$id]))) : array_keys($byId);
            foreach (array_keys($byId) as $id) {
                if (!in_array($id, $ids, true)) {
                    $ids[] = $id;
                }
            }
            $out['items'] = array_map(fn($id) => ['id' => $id, 'text' => $byId[$id]], $ids);
            break;
        case 'numeric':
            $out['unit'] = (string) ($q['data']['unit'] ?? '');
            break;
    }
    return $out;
}

function clean_id(string $id): string
{
    $id = preg_replace('/[^a-z0-9]/', '', strtolower($id));
    return substr($id, 0, 12);
}

/** Validates teacher input for a question; returns a row ready to insert/update. */
function validate_question(array $in): array
{
    $type = str_in($in, 'type', 20);
    if (!in_array($type, QUESTION_TYPES, true)) {
        fail('Type de question invalide.');
    }
    $prompt = str_in($in, 'prompt', 5000);
    if ($prompt === '') {
        fail('L’énoncé de la question est obligatoire.');
    }
    $points = round((float) ($in['points'] ?? 1), 2);
    if ($points < 0 || $points > 100) {
        fail('Le barème doit être compris entre 0 et 100 points.');
    }
    $time = int_in($in, 'time_limit', 30);
    if ($time < 0 || $time > 3600) {
        fail('Le temps par question doit être compris entre 0 et 3600 secondes.');
    }
    if ($time > 0 && $time < 5) {
        $time = 5;
    }
    $image = $in['image'] ?? null;
    if ($image !== null && $image !== '') {
        if (!is_string($image) || !preg_match('/^[a-f0-9]{32}\.(jpg|png|gif|webp)$/', $image) || !is_file(upload_dir() . '/' . $image)) {
            fail('Image invalide.');
        }
    } else {
        $image = null;
    }
    $raw = is_array($in['data'] ?? null) ? $in['data'] : [];
    $data = [];

    switch ($type) {
        case 'single':
        case 'multiple':
            $choices = [];
            $seen = [];
            foreach ((array) ($raw['choices'] ?? []) as $i => $c) {
                if (!is_array($c)) {
                    continue;
                }
                $text = str_in($c, 'text', 500);
                if ($text === '') {
                    continue;
                }
                $id = clean_id((string) ($c['id'] ?? ''));
                if ($id === '' || isset($seen[$id])) {
                    $id = 'c' . substr(random_hex(4), 0, 6);
                }
                $seen[$id] = true;
                $choices[] = ['id' => $id, 'text' => $text, 'correct' => bool_in($c, 'correct')];
            }
            if (count($choices) < 2 || count($choices) > 8) {
                fail('Il faut entre 2 et 8 propositions de réponse.');
            }
            $nCorrect = count(array_filter($choices, fn($c) => $c['correct']));
            if ($type === 'single' && $nCorrect !== 1) {
                fail('Coche exactement une bonne réponse.');
            }
            if ($type === 'multiple' && $nCorrect < 1) {
                fail('Coche au moins une bonne réponse.');
            }
            $data['choices'] = $choices;
            break;

        case 'truefalse':
            $data['answer'] = bool_in($raw, 'answer');
            break;

        case 'short':
            $answers = [];
            foreach ((array) ($raw['answers'] ?? []) as $a) {
                $a = is_string($a) ? mb_substr(trim($a), 0, 200) : '';
                if ($a !== '' && normalize_answer($a) !== '' && !in_array($a, $answers, true)) {
                    $answers[] = $a;
                }
            }
            if (!$answers || count($answers) > 30) {
                fail('Indique au moins une réponse acceptée (30 maximum).');
            }
            $data['answers'] = $answers;
            $data['tolerance'] = bool_in($raw, 'tolerance');
            break;

        case 'numeric':
            $value = is_numeric($raw['value'] ?? null) ? (float) $raw['value'] : parse_number((string) ($raw['value'] ?? ''));
            if ($value === null || !is_finite($value)) {
                fail('Indique la valeur numérique attendue.');
            }
            $tol = is_numeric($raw['tolerance'] ?? null) ? abs((float) $raw['tolerance']) : (parse_number((string) ($raw['tolerance'] ?? '')) ?? 0.0);
            $data['value'] = $value;
            $data['tolerance'] = abs($tol);
            $data['unit'] = str_in($raw, 'unit', 20);
            break;

        case 'ordering':
            $items = [];
            $seen = [];
            foreach ((array) ($raw['items'] ?? []) as $it) {
                if (!is_array($it)) {
                    continue;
                }
                $text = str_in($it, 'text', 300);
                if ($text === '') {
                    continue;
                }
                $id = clean_id((string) ($it['id'] ?? ''));
                if ($id === '' || isset($seen[$id])) {
                    $id = 'i' . substr(random_hex(4), 0, 6);
                }
                $seen[$id] = true;
                $items[] = ['id' => $id, 'text' => $text];
            }
            if (count($items) < 2 || count($items) > 10) {
                fail('Il faut entre 2 et 10 éléments à remettre dans l’ordre.');
            }
            $data['items'] = $items;
            break;
    }

    $explanation = str_in($in, 'explanation', 3000);
    return [
        'type' => $type,
        'prompt' => $prompt,
        'image' => $image,
        'data' => json_enc($data),
        'points' => number_format($points, 2, '.', ''),
        'time_limit' => $time,
        'partial' => in_array($type, ['multiple', 'ordering'], true) && bool_in($in, 'partial') ? 1 : 0,
        'explanation' => $explanation !== '' ? $explanation : null,
    ];
}

/** Validates quiz settings from the editor. */
function validate_quiz(array $in): array
{
    $title = str_in($in, 'title', 200);
    if ($title === '') {
        fail('Le titre du quiz est obligatoire.');
    }
    $level = str_in($in, 'level', 30);
    if (!in_array($level, QUIZ_LEVELS, true)) {
        $level = 'Autre';
    }
    $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', str_in($in, 'access_code', 20)));
    if ($code !== '' && (strlen($code) < 4 || strlen($code) > 12)) {
        fail('Le code d’accès doit contenir entre 4 et 12 lettres ou chiffres.');
    }
    $opens = int_in($in, 'opens_at', 0);
    $closes = int_in($in, 'closes_at', 0);
    if ($opens && $closes && $closes <= $opens) {
        fail('La date de fermeture doit être après la date d’ouverture.');
    }
    $feedback = str_in($in, 'feedback_mode', 20);
    if (!in_array($feedback, ['immediate', 'end', 'release'], true)) {
        $feedback = 'release';
    }
    $exitAction = str_in($in, 'exit_action', 10);
    if (!in_array($exitAction, ['lock', 'submit', 'log'], true)) {
        $exitAction = 'lock';
    }
    return [
        'title' => $title,
        'description' => str_in($in, 'description', 2000),
        'level' => $level,
        'chapter' => str_in($in, 'chapter', 200),
        'access_code' => $code !== '' ? $code : null,
        'opens_at' => $opens > 0 ? $opens : null,
        'closes_at' => $closes > 0 ? $closes : null,
        'max_attempts' => max(1, min(20, int_in($in, 'max_attempts', 1))),
        'time_limit' => max(0, min(6 * 3600, int_in($in, 'time_limit', 0))),
        'shuffle_questions' => bool_in($in, 'shuffle_questions') ? 1 : 0,
        'shuffle_choices' => bool_in($in, 'shuffle_choices') ? 1 : 0,
        'pool_size' => max(0, min(500, int_in($in, 'pool_size', 0))),
        'feedback_mode' => $feedback,
        'show_leaderboard' => bool_in($in, 'show_leaderboard') ? 1 : 0,
        'speed_bonus' => bool_in($in, 'speed_bonus') ? 1 : 0,
        'require_fullscreen' => bool_in($in, 'require_fullscreen') ? 1 : 0,
        'max_exits' => max(0, min(10, int_in($in, 'max_exits', 0))),
        'exit_action' => $exitAction,
        'allowed_ips' => clean_ip_list(str_in($in, 'allowed_ips', 500)),
    ];
}

function clean_ip_list(string $raw): ?string
{
    $out = [];
    foreach (preg_split('/[\s,;]+/', $raw) as $rule) {
        if ($rule === '') {
            continue;
        }
        if (!preg_match('/^[0-9a-fA-F:.]+\*?$/', $rule)) {
            fail('Adresse IP invalide : « ' . mb_substr($rule, 0, 40) . ' ».');
        }
        $out[] = $rule;
    }
    return $out ? implode(', ', array_unique($out)) : null;
}

function audit(string $action, ?string $detail = null): void
{
    $u = current_user();
    insert('audit_log', [
        'user_id' => $u ? (int) $u['id'] : null,
        'action' => $action,
        'detail' => $detail !== null ? mb_substr($detail, 0, 255) : null,
        'ip' => client_ip(),
        'created_at' => time(),
    ]);
}

function recompute_attempt(int $attemptId): void
{
    $a = row('SELECT id, question_ids, zeroed FROM attempts WHERE id = ?', [$attemptId]);
    if (!$a) {
        return;
    }
    $qids = array_map('intval', json_dec($a['question_ids']));
    $max = 0.0;
    if ($qids) {
        $max = (float) val('SELECT COALESCE(SUM(points), 0) FROM questions WHERE id IN (' . implode(',', array_fill(0, count($qids), '?')) . ')', $qids);
    }
    $sum = row('SELECT COALESCE(SUM(COALESCE(override_score, score)), 0) AS s, COALESCE(SUM(points), 0) AS p FROM answers WHERE attempt_id = ?', [$attemptId]);
    $score = (int) $a['zeroed'] ? 0.0 : min($max, (float) $sum['s']);
    q('UPDATE attempts SET score = ?, max_score = ?, points = ? WHERE id = ?', [$score, $max, (int) $a['zeroed'] ? 0 : (int) $sum['p'], $attemptId]);
}

/** Re-grades every stored answer of a question after the teacher edited it. */
function regrade_question(array $q, bool $speedBonus): void
{
    $attemptIds = [];
    foreach (rows('SELECT id, attempt_id, response, status, time_ms FROM answers WHERE question_id = ?', [$q['id']]) as $ans) {
        $attemptIds[(int) $ans['attempt_id']] = true;
        if ($ans['status'] !== 'answered') {
            continue;
        }
        $g = grade_question($q, json_dec($ans['response'], null), $ans['time_ms'] !== null ? (int) $ans['time_ms'] : null, $speedBonus);
        q('UPDATE answers SET fraction = ?, score = ?, points = ? WHERE id = ?', [$g['fraction'], $g['score'], $g['points'], (int) $ans['id']]);
    }
    foreach (array_keys($attemptIds) as $id) {
        recompute_attempt($id);
    }
}

function recompute_quiz_attempts(int $quizId): void
{
    foreach (rows('SELECT id FROM attempts WHERE quiz_id = ?', [$quizId]) as $a) {
        recompute_attempt((int) $a['id']);
    }
}

/**
 * Parses pasted questions. Accepts Moodle "Aiken" (ANSWER: B, blocks separated by blank lines) and
 * the common numbered format: "1. Question", "• A. choice", "✓ B — explanation".
 * Several letters ("ANSWER: A, C") make a multiple-answer question. Returns [questions[], errors[]].
 */
function parse_aiken(string $text): array
{
    $lines = explode("\n", str_replace(["\r\n", "\r"], "\n", $text));
    $questions = [];
    $errors = [];
    $cur = null;

    $finish = function () use (&$cur, &$questions, &$errors) {
        if ($cur === null) {
            return;
        }
        $label = 'Question « ' . mb_substr(implode(' ', $cur['prompt']), 0, 50) . ' »';
        if (!$cur['choices'] && $cur['answer'] === null) {
            $cur = null; // title or free text: ignored
            return;
        }
        if (count($cur['choices']) < 2) {
            $errors[] = "$label : il faut au moins 2 propositions (A. B. …).";
        } elseif (!$cur['answer']) {
            $errors[] = "$label : bonne réponse manquante (ligne « ANSWER: B » ou « ✓ B »).";
        } else {
            $missing = array_diff($cur['answer'], array_keys($cur['choices']));
            if ($missing) {
                $errors[] = "$label : la réponse « " . implode(', ', $missing) . ' » ne correspond à aucune proposition.';
            } else {
                $list = [];
                foreach ($cur['choices'] as $letter => $t) {
                    $list[] = ['id' => strtolower($letter), 'text' => $t, 'correct' => in_array($letter, $cur['answer'], true)];
                }
                $questions[] = [
                    'type' => count($cur['answer']) > 1 ? 'multiple' : 'single',
                    'prompt' => trim(implode("\n", $cur['prompt'])),
                    'data' => ['choices' => $list],
                    'explanation' => $cur['explanation'],
                ];
            }
        }
        $cur = null;
    };
    $start = function (string $prompt) use (&$cur, $finish) {
        $finish();
        $cur = ['prompt' => [$prompt], 'choices' => [], 'answer' => null, 'explanation' => null, 'last' => null];
    };

    foreach ($lines as $rawLine) {
        $line = trim(preg_replace('/^[\s\x{2022}\x{25E6}\x{25AA}\x{25CF}\x{2023}\x{2043}\x{2219}*\-–]+(?=\S)/u', '', $rawLine));
        if ($line === '') {
            continue;
        }
        if (preg_match('/^(?:[\x{2713}\x{2714}\x{2611}\x{2705}]|ANSWER|R[ÉEée]PONSES?|BONNES?\s+R[ÉEée]PONSES?)\s*[:：]?\s*([A-Ha-h](?:\s*(?:,|;|&|\bet\b|\/)\s*[A-Ha-h])*)(?![\p{L}\d])\s*(?:[—–\-:.)]\s*(.*))?$/u', $line, $m) && $cur !== null) {
            $cur['answer'] = array_values(array_unique(array_map('strtoupper', preg_split('/\s*(?:,|;|&|\bet\b|\/)\s*/u', trim($m[1])))));
            if (isset($m[2]) && trim($m[2]) !== '') {
                $cur['explanation'] = trim($m[2]);
            }
            continue;
        }
        if (preg_match('/^(?:EXPLICATION|FEEDBACK|CORRECTION)\s*[:：]\s*(.+)$/iu', $line, $m) && $cur !== null) {
            $cur['explanation'] = trim($m[1]);
            continue;
        }
        if (preg_match('/^([A-Ha-h])\s*[.)\]:]\s*(.+)$/u', $line, $m) && $cur !== null && $cur['answer'] === null) {
            $letter = strtoupper($m[1]);
            $cur['choices'][$letter] = trim($m[2]);
            $cur['last'] = $letter;
            continue;
        }
        if (preg_match('/^(?:Q(?:uestion)?\s*)?\d{1,3}\s*[.)\-:]\s*(.+)$/iu', $line, $m)) {
            $start(trim($m[1]));
            continue;
        }
        if ($cur === null || $cur['answer'] !== null) {
            $start($line);
        } elseif (!$cur['choices']) {
            $cur['prompt'][] = $line;
        } elseif ($cur['last'] !== null) {
            $cur['choices'][$cur['last']] .= ' ' . $line;
        }
    }
    $finish();
    return [$questions, $errors];
}

function upload_dir(): string
{
    return dirname(__DIR__) . '/uploads';
}
