<?php
defined('APP') || exit;

class ApiError extends Exception
{
    public int $http;
    public string $errCode;

    public function __construct(string $message, int $http = 400, string $errCode = 'error')
    {
        parent::__construct($message);
        $this->http = $http;
        $this->errCode = $errCode;
    }
}

function fail(string $message, int $http = 400, string $code = 'error'): void
{
    throw new ApiError($message, $http, $code);
}

function db(): PDO
{
    if (!empty($GLOBALS['DB'])) {
        return $GLOBALS['DB'];
    }
    $c = $GLOBALS['CFG'];
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['db_host'], (int) ($c['db_port'] ?? 3306), $c['db_name']);
    try {
        $GLOBALS['DB'] = new PDO($dsn, $c['db_user'], $c['db_pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (PDOException $e) {
        error_log('[quiz-ses] DB connection failed: ' . $e->getMessage());
        throw new ApiError('Connexion à la base de données impossible : vérifie les identifiants dans config.php.', 500, 'db');
    }
    return $GLOBALS['DB'];
}

function q(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute(array_values($params));
    return $st;
}

function row(string $sql, array $params = []): ?array
{
    $r = q($sql, $params)->fetch();
    return $r === false ? null : $r;
}

function rows(string $sql, array $params = []): array
{
    return q($sql, $params)->fetchAll();
}

function val(string $sql, array $params = [])
{
    $v = q($sql, $params)->fetchColumn();
    return $v === false ? null : $v;
}

function insert(string $table, array $data): int
{
    $cols = array_keys($data);
    $sql = 'INSERT INTO ' . $table . ' (' . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')';
    q($sql, array_values($data));
    return (int) db()->lastInsertId();
}

function update(string $table, int $id, array $data): void
{
    if (!$data) {
        return;
    }
    $sets = implode(', ', array_map(fn($c) => $c . ' = ?', array_keys($data)));
    $params = array_values($data);
    $params[] = $id;
    q('UPDATE ' . $table . ' SET ' . $sets . ' WHERE id = ?', $params);
}

function tx(callable $fn)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $result = $fn();
        $pdo->commit();
        return $result;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}
