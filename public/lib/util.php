<?php
defined('APP') || exit;

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function input(): array
{
    static $data = null;
    if ($data !== null) {
        return $data;
    }
    $data = [];
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $ctype = $_SERVER['CONTENT_TYPE'] ?? '';
        if (stripos($ctype, 'multipart/form-data') !== false) {
            $data = $_POST;
        } else {
            $raw = file_get_contents('php://input', false, null, 0, 2000000);
            $decoded = json_decode((string) $raw, true);
            $data = is_array($decoded) ? $decoded : [];
        }
    }
    foreach ($_GET as $k => $v) {
        if (!array_key_exists($k, $data) && is_string($v)) {
            $data[$k] = $v;
        }
    }
    return $data;
}

function str_in(array $in, string $key, int $max = 1000): string
{
    $v = $in[$key] ?? '';
    if (!is_string($v) && !is_numeric($v)) {
        return '';
    }
    $v = trim(str_replace("\0", '', (string) $v));
    return mb_substr($v, 0, $max);
}

function int_in(array $in, string $key, int $default = 0): int
{
    $v = $in[$key] ?? null;
    return is_numeric($v) ? (int) $v : $default;
}

function bool_in(array $in, string $key): bool
{
    $v = $in[$key] ?? false;
    return $v === true || $v === 1 || $v === '1' || $v === 'true' || $v === 'on';
}

function json_enc($v): string
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function json_dec(?string $s, $default = [])
{
    if ($s === null || $s === '') {
        return $default;
    }
    $v = json_decode($s, true);
    return $v === null ? $default : $v;
}

function strip_accents(string $s): string
{
    $s = strtr($s, ['œ' => 'oe', 'Œ' => 'OE', 'æ' => 'ae', 'Æ' => 'AE', 'ß' => 'ss']);
    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($s, Normalizer::FORM_D);
        if ($n !== false) {
            return preg_replace('/\p{Mn}+/u', '', $n);
        }
    }
    $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
    return $t === false ? $s : $t;
}

function clean_name(string $s): string
{
    $s = preg_replace('/[\p{C}]+/u', '', $s);
    $s = trim(preg_replace('/\s+/u', ' ', $s));
    $s = mb_substr($s, 0, 60);
    return preg_replace_callback('/(^|[\s\-’\'])(\p{Ll})/u', fn($m) => $m[1] . mb_strtoupper($m[2]), mb_strtolower($s));
}

function valid_name(string $s): bool
{
    return $s !== '' && preg_match("/^[\p{L}][\p{L}\s\-’'.]{0,59}$/u", $s) === 1;
}

function name_key(string $s): string
{
    $s = mb_strtolower(strip_accents($s));
    $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
    return trim($s);
}

function student_key(string $first, string $last): string
{
    return name_key($first) . '|' . name_key($last);
}

function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);
}

function user_agent(): string
{
    return mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
}

function device_label(string $ua, string $hint = ''): string
{
    if (preg_match('/iPhone|iPod/i', $ua)) {
        return 'iPhone';
    }
    if (preg_match('/iPad/i', $ua) || ($hint === 'ipad' && preg_match('/Macintosh/i', $ua))) {
        return 'iPad';
    }
    if (preg_match('/Android/i', $ua)) {
        return preg_match('/Mobile/i', $ua) ? 'Android' : 'Tablette Android';
    }
    if (preg_match('/CrOS/i', $ua)) {
        return 'Chromebook';
    }
    if (preg_match('/Macintosh|Mac OS X/i', $ua)) {
        return 'Mac';
    }
    if (preg_match('/Windows/i', $ua)) {
        return 'PC Windows';
    }
    if (preg_match('/Linux/i', $ua)) {
        return 'Linux';
    }
    return 'Autre';
}

function random_hex(int $bytes = 32): string
{
    return bin2hex(random_bytes($bytes));
}

function random_digits(int $len = 6): string
{
    $s = (string) random_int(1, 9);
    for ($i = 1; $i < $len; $i++) {
        $s .= (string) random_int(0, 9);
    }
    return $s;
}

function secure_shuffle(array $items): array
{
    $items = array_values($items);
    for ($i = count($items) - 1; $i > 0; $i--) {
        $j = random_int(0, $i);
        [$items[$i], $items[$j]] = [$items[$j], $items[$i]];
    }
    return $items;
}

function settings_all(): array
{
    static $cache = null;
    if ($cache === null) {
        $cache = [
            'site_name' => 'Quiz SES',
            'teacher_name' => 'Mme Cyrine',
            'allow_registration' => '1',
            'require_validation' => '1',
        ];
        foreach (rows('SELECT name, value FROM settings') as $r) {
            $cache[$r['name']] = $r['value'];
        }
    }
    return $cache;
}

function setting(string $name, ?string $default = null): ?string
{
    return settings_all()[$name] ?? $default;
}

function set_setting(string $name, string $value): void
{
    q('INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [$name, $value]);
}

function note20(float $score, float $max): ?float
{
    return $max > 0 ? round($score / $max * 20, 2) : null;
}

function median(array $values): ?float
{
    if (!$values) {
        return null;
    }
    sort($values);
    $n = count($values);
    $mid = intdiv($n, 2);
    return $n % 2 ? (float) $values[$mid] : ($values[$mid - 1] + $values[$mid]) / 2;
}
