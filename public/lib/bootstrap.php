<?php
defined('APP') || exit;

$configFile = is_file(__DIR__ . '/../config.local.php') ? __DIR__ . '/../config.local.php' : __DIR__ . '/../config.php';
$GLOBALS['CFG'] = require $configFile;

date_default_timezone_set($GLOBALS['CFG']['timezone'] ?? 'Europe/Paris');
mb_internal_encoding('UTF-8');

require __DIR__ . '/db.php';
require __DIR__ . '/util.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/grading.php';
require __DIR__ . '/quiz.php';
require __DIR__ . '/attempt.php';
require __DIR__ . '/actions_auth.php';
require __DIR__ . '/actions_student.php';
require __DIR__ . '/actions_teacher.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');

set_exception_handler(function (Throwable $e): void {
    if (!empty($GLOBALS['DB']) && $GLOBALS['DB']->inTransaction()) {
        $GLOBALS['DB']->rollBack();
    }
    if ($e instanceof ApiError) {
        http_response_code($e->http);
        echo json_encode(['ok' => false, 'error' => $e->getMessage(), 'code' => $e->errCode], JSON_UNESCAPED_UNICODE);
        return;
    }
    error_log('[quiz-ses] ' . $e);
    http_response_code(500);
    $msg = !empty($GLOBALS['CFG']['debug']) ? $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine() : 'Erreur interne du serveur.';
    echo json_encode(['ok' => false, 'error' => $msg, 'code' => 'server'], JSON_UNESCAPED_UNICODE);
});

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['SERVER_PORT'] ?? '') == 443);
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
ini_set('session.gc_maxlifetime', '28800');
session_name('QUIZSES');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $https,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();
