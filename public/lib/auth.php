<?php
defined('APP') || exit;

const SESSION_IDLE_TEACHER = 4 * 3600;
const SESSION_IDLE_STUDENT = 8 * 3600;
const THROTTLE_WINDOW = 900;
const THROTTLE_MAX_PER_ACCOUNT = 8;
const THROTTLE_MAX_PER_IP = 120;

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = random_hex(32);
    }
    return $_SESSION['csrf'];
}

function check_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? (input()['_csrf'] ?? '');
    if (!is_string($sent) || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
        fail('Session expirée : recharge la page.', 419, 'csrf');
    }
}

function current_user(): ?array
{
    static $resolved = false;
    static $user = null;
    if ($resolved) {
        return $user;
    }
    $resolved = true;
    $uid = $_SESSION['uid'] ?? null;
    $tok = $_SESSION['tok'] ?? null;
    if (!$uid || !is_string($tok)) {
        return null;
    }
    $u = row('SELECT u.*, c.name AS class_name FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = ?', [(int) $uid]);
    $idle = ($u && $u['role'] === 'teacher') ? SESSION_IDLE_TEACHER : SESSION_IDLE_STUDENT;
    $expired = isset($_SESSION['seen']) && time() - (int) $_SESSION['seen'] > $idle;
    if (!$u || $u['status'] === 'disabled' || $expired || !is_string($u['session_token']) || !hash_equals($u['session_token'], $tok)) {
        if ($u && is_string($u['session_token']) && !hash_equals($u['session_token'], $tok)) {
            $GLOBALS['SESSION_REPLACED'] = true;
        }
        unset($_SESSION['uid'], $_SESSION['tok'], $_SESSION['seen']);
        return null;
    }
    $_SESSION['seen'] = time();
    $user = $u;
    return $user;
}

function require_user(): array
{
    $u = current_user();
    if (!$u) {
        if (!empty($GLOBALS['SESSION_REPLACED'])) {
            fail('Tu as été déconnecté : ton compte vient d’être ouvert sur un autre appareil.', 401, 'session_replaced');
        }
        fail('Connexion requise.', 401, 'auth');
    }
    return $u;
}

function require_student(bool $allowPending = false): array
{
    $u = require_user();
    if ($u['role'] !== 'student') {
        fail('Réservé aux élèves.', 403, 'forbidden');
    }
    if ((int) $u['must_change_password']) {
        fail('Tu dois d’abord choisir un nouveau mot de passe.', 403, 'must_change_password');
    }
    if (!$allowPending && $u['status'] !== 'active') {
        fail('Ton compte est en attente de validation par ta professeure.', 403, 'pending');
    }
    return $u;
}

function require_teacher(): array
{
    $u = require_user();
    if ($u['role'] !== 'teacher') {
        fail('Accès réservé à la professeure.', 403, 'forbidden');
    }
    if ((int) $u['must_change_password']) {
        fail('Choisis d’abord un nouveau mot de passe.', 403, 'must_change_password');
    }
    return $u;
}

function public_user(?array $u): ?array
{
    if (!$u) {
        return null;
    }
    return [
        'id' => (int) $u['id'],
        'role' => $u['role'],
        'first_name' => $u['first_name'],
        'last_name' => $u['last_name'],
        'class_id' => $u['class_id'] !== null ? (int) $u['class_id'] : null,
        'class_name' => $u['class_name'] ?? null,
        'status' => $u['status'],
        'must_change_password' => (bool) $u['must_change_password'],
    ];
}

function login_as(array $u): void
{
    session_regenerate_id(true);
    $token = random_hex(32);
    q('UPDATE users SET session_token = ?, last_login_at = ? WHERE id = ?', [$token, time(), (int) $u['id']]);
    $_SESSION['uid'] = (int) $u['id'];
    $_SESSION['tok'] = $token;
    $_SESSION['seen'] = time();
    $_SESSION['csrf'] = random_hex(32);
}

function logout_current(): void
{
    $u = current_user();
    if ($u) {
        q('UPDATE users SET session_token = NULL WHERE id = ?', [(int) $u['id']]);
    }
    $_SESSION = [];
    session_regenerate_id(true);
}

function throttle_guard(string $key): void
{
    if (random_int(1, 50) === 1) {
        q('DELETE FROM login_attempts WHERE attempted_at < ?', [time() - 86400]);
    }
    $since = time() - THROTTLE_WINDOW;
    $byKey = (int) val('SELECT COUNT(*) FROM login_attempts WHERE login_key = ? AND attempted_at > ?', [$key, $since]);
    $byIp = (int) val('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND attempted_at > ?', [client_ip(), $since]);
    if ($byKey >= THROTTLE_MAX_PER_ACCOUNT || $byIp >= THROTTLE_MAX_PER_IP) {
        fail('Trop de tentatives de connexion. Réessaie dans 15 minutes.', 429, 'throttled');
    }
}

function throttle_fail(string $key): void
{
    insert('login_attempts', ['ip' => client_ip(), 'login_key' => $key, 'attempted_at' => time()]);
}

function throttle_clear(string $key): void
{
    q('DELETE FROM login_attempts WHERE login_key = ?', [$key]);
}

function password_problem(string $password, string $role, array $names = []): ?string
{
    $min = $role === 'teacher' ? 10 : 6;
    if (mb_strlen($password) < $min) {
        return "Le mot de passe doit contenir au moins $min caractères.";
    }
    if (mb_strlen($password) > 128) {
        return 'Le mot de passe est trop long (128 caractères maximum).';
    }
    if ($role === 'teacher' && (!preg_match('/\p{L}/u', $password) || !preg_match('/\d/', $password))) {
        return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    }
    $plain = name_key($password);
    foreach ($names as $n) {
        if ($n !== '' && $plain === name_key($n)) {
            return 'Le mot de passe ne doit pas être ton prénom ou ton nom.';
        }
    }
    if (in_array(mb_strtolower($password), ['123456', '1234567', '12345678', 'azerty', 'azertyuiop', 'motdepasse', 'password', '000000', '111111', 'qwerty'], true)) {
        return 'Ce mot de passe est trop facile à deviner.';
    }
    return null;
}

function dummy_password_check(string $password): void
{
    password_verify($password, '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG');
}
