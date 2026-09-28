<?php
defined('APP') || exit;

function act_session(array $in): array
{
    $u = current_user();
    $s = settings_all();
    return [
        'user' => public_user($u),
        'csrf' => csrf_token(),
        'session_replaced' => !empty($GLOBALS['SESSION_REPLACED']),
        'settings' => [
            'site_name' => $s['site_name'],
            'teacher_name' => $s['teacher_name'],
            'allow_registration' => $s['allow_registration'] === '1',
        ],
        'server_ms' => now_ms(),
    ];
}

function act_register(array $in): array
{
    if (setting('allow_registration') !== '1') {
        fail('Les inscriptions sont fermées. Demande à ta professeure.', 403, 'closed');
    }
    $first = clean_name(str_in($in, 'first_name', 60));
    $last = clean_name(str_in($in, 'last_name', 60));
    $password = is_string($in['password'] ?? null) ? $in['password'] : '';
    if (!valid_name($first) || !valid_name($last)) {
        fail('Indique ton vrai prénom et ton vrai nom (lettres uniquement).');
    }
    if ($problem = password_problem($password, 'student', [$first, $last])) {
        fail($problem);
    }
    $key = student_key($first, $last);
    throttle_guard('register:' . client_ip());
    if (val('SELECT id FROM users WHERE role = ? AND login_key = ?', ['student', $key])) {
        throttle_fail('register:' . client_ip());
        fail('Un compte existe déjà avec ce prénom et ce nom. Si c’est le tien, connecte-toi ; sinon préviens ta professeure.', 409, 'exists');
    }
    $status = setting('require_validation') === '1' ? 'pending' : 'active';
    $id = insert('users', [
        'role' => 'student',
        'login_key' => $key,
        'first_name' => $first,
        'last_name' => $last,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'status' => $status,
        'created_at' => time(),
    ]);
    $u = row('SELECT u.*, NULL AS class_name FROM users u WHERE id = ?', [$id]);
    login_as($u);
    return ['user' => public_user($u), 'csrf' => $_SESSION['csrf']];
}

function act_login_student(array $in): array
{
    $first = clean_name(str_in($in, 'first_name', 60));
    $last = clean_name(str_in($in, 'last_name', 60));
    $password = is_string($in['password'] ?? null) ? $in['password'] : '';
    $key = student_key($first, $last);
    throttle_guard('s:' . $key);
    $u = row('SELECT u.*, c.name AS class_name FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.role = ? AND u.login_key = ?', ['student', $key]);
    if (!$u) {
        dummy_password_check($password);
    }
    if (!$u || !password_verify($password, $u['password_hash'])) {
        throttle_fail('s:' . $key);
        fail('Prénom, nom ou mot de passe incorrect.', 401, 'bad_credentials');
    }
    if ($u['status'] === 'disabled') {
        fail('Ce compte a été désactivé par ta professeure.', 403, 'disabled');
    }
    throttle_clear('s:' . $key);
    if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
        q('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($password, PASSWORD_DEFAULT), (int) $u['id']]);
    }
    login_as($u);
    return ['user' => public_user($u), 'csrf' => $_SESSION['csrf']];
}

function act_login_teacher(array $in): array
{
    $username = name_key(str_in($in, 'username', 60));
    $password = is_string($in['password'] ?? null) ? $in['password'] : '';
    throttle_guard('t:' . $username);
    $u = row('SELECT u.*, NULL AS class_name FROM users u WHERE role = ? AND login_key = ?', ['teacher', $username]);
    if (!$u) {
        dummy_password_check($password);
    }
    if (!$u || !password_verify($password, $u['password_hash'])) {
        throttle_fail('t:' . $username);
        insert('audit_log', ['user_id' => null, 'action' => 'login_failed', 'detail' => 'Identifiant : ' . mb_substr($username, 0, 40), 'ip' => client_ip(), 'created_at' => time()]);
        fail('Identifiant ou mot de passe incorrect.', 401, 'bad_credentials');
    }
    throttle_clear('t:' . $username);
    login_as($u);
    audit('login');
    return ['user' => public_user($u), 'csrf' => $_SESSION['csrf']];
}

function act_logout(array $in): array
{
    logout_current();
    return ['csrf' => csrf_token()];
}

function act_change_password(array $in): array
{
    $u = require_user();
    $current = is_string($in['current'] ?? null) ? $in['current'] : '';
    $new = is_string($in['new'] ?? null) ? $in['new'] : '';
    throttle_guard('pw:' . $u['id']);
    if (!password_verify($current, $u['password_hash'])) {
        throttle_fail('pw:' . $u['id']);
        fail('Mot de passe actuel incorrect.', 400, 'bad_password');
    }
    if ($problem = password_problem($new, $u['role'], [$u['first_name'], $u['last_name']])) {
        fail($problem);
    }
    if (password_verify($new, $u['password_hash'])) {
        fail('Choisis un mot de passe différent de l’actuel.');
    }
    q('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), (int) $u['id']]);
    login_as($u);
    if ($u['role'] === 'teacher') {
        audit('password_changed');
    }
    $fresh = row('SELECT u.*, c.name AS class_name FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = ?', [(int) $u['id']]);
    return ['user' => public_user($fresh), 'csrf' => $_SESSION['csrf']];
}
