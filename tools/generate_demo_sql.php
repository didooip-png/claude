<?php
// Génère database/demo_data.sql à partir de database/demo_quizzes.json.
// Usage : php tools/generate_demo_sql.php

$root = dirname(__DIR__);
$src = json_decode(file_get_contents($root . '/database/demo_quizzes.json'), true, 512, JSON_THROW_ON_ERROR);

function sq($v): string
{
    if ($v === null) {
        return 'NULL';
    }
    if (is_bool($v)) {
        return $v ? '1' : '0';
    }
    if (is_int($v) || is_float($v)) {
        return (string) $v;
    }
    return "'" . str_replace(["\\", "'"], ["\\\\", "''"], (string) $v) . "'";
}

$out = [];
$out[] = '-- =====================================================================';
$out[] = '--  Quiz SES — Données de démonstration (OPTIONNEL)';
$out[] = '--  À importer APRÈS schema.sql si tu veux des quiz d’exemple.';
$out[] = '--  Fichier généré par tools/generate_demo_sql.php';
$out[] = '-- =====================================================================';
$out[] = '';
$out[] = 'SET NAMES utf8mb4;';
$out[] = '';

foreach ($src['classes'] as $name) {
    $out[] = 'INSERT IGNORE INTO classes (name, created_at) VALUES (' . sq($name) . ', UNIX_TIMESTAMP());';
}
$out[] = '';

foreach ($src['quizzes'] as $quiz) {
    $out[] = '-- Quiz : ' . $quiz['title'];
    $out[] = 'INSERT INTO quizzes (title, description, level, chapter, status, access_code, max_attempts, time_limit,'
        . ' shuffle_questions, shuffle_choices, pool_size, feedback_mode, results_released, show_leaderboard, speed_bonus,'
        . ' require_fullscreen, max_exits, exit_action, created_at, updated_at) VALUES ('
        . implode(', ', [
            sq($quiz['title']), sq($quiz['description']), sq($quiz['level']), sq($quiz['chapter']),
            sq($quiz['status']), sq($quiz['access_code']), 1, 0, 1, 1, 0,
            sq($quiz['feedback_mode']), 0, (int) $quiz['show_leaderboard'], 1, 1,
            (int) $quiz['max_exits'], sq($quiz['exit_action']),
        ])
        . ', UNIX_TIMESTAMP(), UNIX_TIMESTAMP());';
    $out[] = 'SET @quiz_id = LAST_INSERT_ID();';
    foreach ($quiz['questions'] as $pos => $q) {
        $out[] = 'INSERT INTO questions (quiz_id, position, type, prompt, data, points, time_limit, partial, explanation, created_at, updated_at) VALUES ('
            . implode(', ', [
                '@quiz_id', $pos, sq($q['type']), sq($q['prompt']),
                sq(json_encode($q['data'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)),
                number_format((float) $q['points'], 2, '.', ''), (int) $q['time_limit'],
                (int) ($q['partial'] ?? 0), sq($q['explanation'] ?? null),
            ])
            . ', UNIX_TIMESTAMP(), UNIX_TIMESTAMP());';
    }
    $out[] = '';
}

file_put_contents($root . '/database/demo_data.sql', implode("\n", $out));
echo "database/demo_data.sql généré.\n";
