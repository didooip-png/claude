<?php
define('APP', true);
require __DIR__ . '/../lib/bootstrap.php';

$action = isset($_GET['a']) && is_string($_GET['a']) ? $_GET['a'] : '';
if (!preg_match('/^[a-z_]{2,40}$/', $action) || !function_exists('act_' . $action)) {
    fail('Action inconnue.', 404, 'unknown_action');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$getActions = ['session', 't_export', 't_quiz_export_json'];
if ($method === 'GET') {
    if (!in_array($action, $getActions, true)) {
        fail('Méthode non autorisée.', 405, 'method');
    }
} elseif ($method === 'POST') {
    check_csrf();
} else {
    fail('Méthode non autorisée.', 405, 'method');
}

if (str_starts_with($action, 't_')) {
    require_teacher();
}

$result = ('act_' . $action)(input());
echo json_encode(['ok' => true, 'data' => $result], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
