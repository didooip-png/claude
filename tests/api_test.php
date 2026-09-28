<?php
// Test de bout en bout de l'API (à lancer en local, jamais sur le serveur de production).
// Usage : php -S 127.0.0.1:8080 -t public  puis  php tests/api_test.php [http://127.0.0.1:8080] [mysql_cli_cmd]
// La base doit venir d'être importée (schema.sql + demo_data.sql).

$base = ($argv[1] ?? 'http://127.0.0.1:8080') . '/api/index.php';
$mysql = $argv[2] ?? 'mariadb -uroot quiz_ses';
$teacherPass = 'Cyrine2026Ses!';
$failures = 0;
$passes = 0;

final class Client
{
    public string $jar;
    public string $csrf = '';

    public function __construct(private string $base)
    {
        $this->jar = tempnam(sys_get_temp_dir(), 'jar');
        $this->csrf = $this->get('session')['data']['csrf'];
    }

    public function get(string $a, array $q = []): array
    {
        return $this->req('GET', $a, null, $q);
    }

    public function post(string $a, array $body = [], bool $withCsrf = true): array
    {
        $r = $this->req('POST', $a, $body, [], $withCsrf);
        if (!empty($r['data']['csrf'])) {
            $this->csrf = $r['data']['csrf'];
        }
        return $r;
    }

    public function raw(string $a, array $q = []): string
    {
        $ch = curl_init($this->base . '?' . http_build_query(['a' => $a] + $q));
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $this->jar, CURLOPT_COOKIEFILE => $this->jar]);
        $out = curl_exec($ch);
        curl_close($ch);
        return (string) $out;
    }

    private function req(string $method, string $a, ?array $body, array $q = [], bool $withCsrf = true): array
    {
        $ch = curl_init($this->base . '?' . http_build_query(['a' => $a] + $q));
        $headers = ['Content-Type: application/json'];
        if ($withCsrf) {
            $headers[] = 'X-CSRF-Token: ' . $this->csrf;
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_COOKIEJAR => $this->jar,
            CURLOPT_COOKIEFILE => $this->jar,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        $out = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $json = json_decode((string) $out, true);
        if (!is_array($json)) {
            $json = ['ok' => false, 'error' => 'NON-JSON: ' . substr((string) $out, 0, 300)];
        }
        $json['_http'] = $code;
        $json['_raw'] = (string) $out;
        return $json;
    }
}

function check(bool $cond, string $label, $debug = null): void
{
    global $failures, $passes;
    if ($cond) {
        $passes++;
        echo "  ok  $label\n";
    } else {
        $failures++;
        echo "  FAIL $label\n";
        if ($debug !== null) {
            echo '       ' . substr(is_string($debug) ? $debug : json_encode($debug, JSON_UNESCAPED_UNICODE), 0, 600) . "\n";
        }
    }
}

function sql(string $query): string
{
    global $mysql;
    return trim((string) shell_exec($mysql . ' -N -e ' . escapeshellarg($query)));
}

echo "== Authentification professeure\n";
$t = new Client($base);
$r = $t->post('login_teacher', ['username' => 'cyrine', 'password' => 'mauvais']);
check($r['_http'] === 401, 'mauvais mot de passe refusé', $r);
$r = $t->post('login_teacher', ['username' => 'Cyrine', 'password' => 'ChangeMoi2026!']);
check($r['ok'] && $r['data']['user']['must_change_password'] === true, 'connexion avec mot de passe provisoire', $r);
$r = $t->post('t_quizzes');
check($r['_http'] === 403 && $r['code'] === 'must_change_password', 'changement de mot de passe obligatoire', $r);
$r = $t->post('change_password', ['current' => 'ChangeMoi2026!', 'new' => 'court']);
check(!$r['ok'], 'mot de passe trop faible refusé', $r);
$r = $t->post('change_password', ['current' => 'ChangeMoi2026!', 'new' => $teacherPass]);
check($r['ok'] && $r['data']['user']['must_change_password'] === false, 'nouveau mot de passe enregistré', $r);
$r = $t->post('t_quizzes');
check($r['ok'] && count($r['data']['quizzes']) === 4, '4 quiz de démo listés', $r);
$quizId = null;
foreach ($r['data']['quizzes'] as $qz) {
    if ($qz['title'] === 'La croissance économique') {
        $quizId = $qz['id'];
    }
}
check($quizId !== null, 'quiz « La croissance économique » présent');
$r = $t->post('t_quizzes', [], false);
check($r['_http'] === 419, 'requête sans jeton CSRF refusée', $r);

echo "== Inscription élève + validation\n";
$s = new Client($base);
$r = $s->post('register', ['first_name' => 'jean-pierre', 'last_name' => 'dupont', 'password' => '123456']);
check(!$r['ok'], 'mot de passe trop facile refusé', $r);
$r = $s->post('register', ['first_name' => 'jean-pierre', 'last_name' => 'dupont', 'password' => 'ses-2026']);
check($r['ok'] && $r['data']['user']['status'] === 'pending' && $r['data']['user']['first_name'] === 'Jean-Pierre', 'compte créé en attente, nom mis en forme', $r);
$studentId = $r['data']['user']['id'] ?? 0;
$r = $s->post('student_dashboard');
check($r['ok'] && $r['data']['pending'] === true, 'tableau de bord en attente', $r);
$r = $s->post('quiz_start', ['quiz_id' => $quizId]);
check($r['_http'] === 403 && $r['code'] === 'pending', 'élève non validé ne peut pas commencer', $r);
$s2 = new Client($base);
$r = $s2->post('register', ['first_name' => 'Jean Pierre', 'last_name' => 'DUPONT', 'password' => 'autre-2026']);
check($r['_http'] === 409, 'doublon de nom (accents/majuscules/tirets) refusé', $r);
$r = $s->post('t_students');
check($r['_http'] === 403, 'un élève ne peut pas appeler une action professeure', $r);
$r = $t->post('t_student_action', ['student_id' => $studentId, 'action' => 'validate']);
check($r['ok'], 'la professeure valide le compte', $r);

echo "== Tableau de bord élève\n";
$r = $s->post('student_dashboard');
$titles = array_column($r['data']['quizzes'] ?? [], 'title');
check($r['ok'] && $titles === ['La croissance économique'], 'seul le quiz ouvert est visible (brouillons cachés)', $titles);

echo "== Passage du quiz : aucune réponse divulguée\n";
$r = $s->post('quiz_start', ['quiz_id' => $quizId]);
check($r['ok'] && $r['data']['status'] === 'in_progress' && $r['data']['question'] === null && $r['data']['total'] === 20, 'copie créée, question pas encore servie', $r);
$attemptId = $r['data']['attempt_id'];
$r = $s->post('attempt_state', ['attempt_id' => $attemptId, 'serve' => true, 'fresh' => true]);
$q = $r['data']['question'] ?? null;
check($q && count($q['choices']) === 3 && $r['data']['exits'] === 0, 'première question servie sans pénalité', $r);
check(!str_contains($r['_raw'], '"correct"') && !str_contains($r['_raw'], 'explanation'), 'ni bonne réponse ni explication dans la réponse du serveur', $r['_raw']);
$full = $t->post('t_quiz_get', ['quiz_id' => $quizId])['data']['quiz']['questions'];
$byId = [];
foreach ($full as $fq) {
    $byId[$fq['id']] = $fq;
}
$correctOf = function (array $q) use ($byId) {
    foreach ($byId[$q['id']]['data']['choices'] as $c) {
        if ($c['correct']) {
            return $c['id'];
        }
    }
    return null;
};
$r = $s->post('attempt_answer', ['attempt_id' => $attemptId, 'index' => 0, 'response' => ['choice' => $correctOf($q)]]);
check($r['ok'] && $r['data']['accepted'] && !isset($r['data']['feedback']['correct']), 'réponse acceptée, correction non révélée (mode « après publication »)', $r);
$r = $s->post('attempt_answer', ['attempt_id' => $attemptId, 'index' => 0, 'response' => ['choice' => 'a']]);
check($r['ok'] && !$r['data']['accepted'], 'impossible de répondre deux fois', $r);

echo "== Anti-triche : l'élève quitte l'appli pendant une question\n";
$r = $s->post('attempt_state', ['attempt_id' => $attemptId, 'serve' => true]);
check($r['data']['index'] === 1 && $r['data']['question'] !== null, 'question 2 servie', $r);
$r = $s->post('attempt_event', ['attempt_id' => $attemptId, 'type' => 'hidden', 'exit_key' => 'exit-abc1']);
check($r['ok'] && $r['data']['action'] === 'lock' && $r['data']['cancelled'] === true && $r['data']['state']['status'] === 'locked', 'question annulée et quiz verrouillé', $r);
$r = $s->post('attempt_event', ['attempt_id' => $attemptId, 'type' => 'hidden', 'exit_key' => 'exit-abc1', 'duration_ms' => 8000]);
check($r['ok'] && $r['data']['state']['exits'] === 1, 'le retour met à jour la durée sans compter une 2e sortie', $r);
$r = $s->post('attempt_answer', ['attempt_id' => $attemptId, 'index' => 1, 'response' => ['choice' => 'b']]);
check($r['ok'] && !$r['data']['accepted'], 'répondre après être revenu est impossible', $r);
$r = $s->post('attempt_state', ['attempt_id' => $attemptId, 'serve' => true]);
check($r['data']['status'] === 'locked' && $r['data']['question'] === null, 'verrouillé : aucune question servie', $r);

echo "== Surveillance en direct\n";
$r = $t->post('t_live', ['quiz_id' => $quizId]);
$live = $r['data']['attempts'][0] ?? null;
check($r['ok'] && $live && $live['status'] === 'locked' && $live['exits'] === 1 && $live['device'] === 'iPhone', 'la prof voit l’élève verrouillé, sur iPhone', $r);
check(count($live['answers']) === 2 && $live['answers'][1]['status'] === 'cancelled', 'la prof voit Q1 répondue et Q2 annulée', $live['answers'] ?? null);
$types = array_column($r['data']['incidents'], 'type');
check(in_array('hidden', $types, true), 'incident visible dans le fil en direct', $types);
$r = $t->post('t_alerts');
check($r['ok'] && $r['data']['alerts'] === [] && $r['data']['last_id'] >= 1, 'premier appel : curseur d’alertes initialisé', $r);
$r = $t->post('t_alerts', ['since' => 0]);
check($r['ok'] && count($r['data']['alerts']) >= 1 && $r['data']['locked'] === 1, 'alerte de triche remontée à la prof', $r);
$r = $t->post('t_attempt_action', ['attempt_id' => $attemptId, 'action' => 'warn', 'message' => 'Dernier avertissement !']);
check($r['ok'], 'avertissement envoyé', $r);
$r = $t->post('t_attempt_action', ['attempt_id' => $attemptId, 'action' => 'unlock']);
check($r['ok'] && $r['data']['status'] === 'in_progress', 'déblocage par la prof', $r);
$r = $s->post('attempt_heartbeat', ['attempt_id' => $attemptId, 'vis' => 'visible', 'focus' => true]);
check($r['data']['warning']['text'] === 'Dernier avertissement !', 'l’élève reçoit l’avertissement', $r);
$r = $s->post('attempt_ack_warning', ['attempt_id' => $attemptId]);
check($r['data']['warning'] === null, 'avertissement lu', $r);

echo "== Anti-triche côté serveur : plus aucun signal (appli quittée)\n";
$r = $s->post('attempt_state', ['attempt_id' => $attemptId, 'serve' => true]);
check($r['data']['index'] === 2 && $r['data']['question'] !== null, 'question 3 servie après déblocage', $r);
sql("UPDATE attempts SET last_seen_ms = last_seen_ms - 15000, q_started_ms = q_started_ms - 15000 WHERE id = $attemptId");
$r = $t->post('t_live', ['quiz_id' => $quizId]);
check($r['data']['attempts'][0]['status'] === 'locked', 'le serveur détecte seul l’absence de signal et verrouille', $r['data']['attempts'][0] ?? $r);
$t->post('t_attempt_action', ['attempt_id' => $attemptId, 'action' => 'unlock']);

echo "== Rechargement de page pendant une question\n";
$r = $s->post('attempt_state', ['attempt_id' => $attemptId, 'serve' => true]);
$r = $s->post('attempt_state', ['attempt_id' => $attemptId, 'fresh' => true]);
check($r['data']['status'] === 'locked', 'recharger la page pendant une question = sortie', $r);
$t->post('t_attempt_action', ['attempt_id' => $attemptId, 'action' => 'unlock']);

echo "== Connexion depuis un 2e appareil\n";
$other = new Client($base);
$r = $other->post('login_student', ['first_name' => 'Jean-Pierre', 'last_name' => 'Dupont', 'password' => 'ses-2026']);
check($r['ok'], 'connexion sur un autre appareil', $r);
$r = $s->post('attempt_state', ['attempt_id' => $attemptId]);
check($r['_http'] === 401 && $r['code'] === 'session_replaced', 'le premier appareil est déconnecté', $r);
$r = $other->post('quiz_start', ['quiz_id' => $quizId]);
check($r['ok'] && $r['data']['attempt_id'] === $attemptId && $r['data']['exits'] >= 4, 'reprise de la même copie, changement d’appareil compté', $r);
$s = $other;
$t->post('t_attempt_action', ['attempt_id' => $attemptId, 'action' => 'unlock']);

echo "== Temps écoulé côté serveur\n";
$r = $s->post('attempt_state', ['attempt_id' => $attemptId, 'serve' => true]);
$idx = $r['data']['index'];
sql("UPDATE attempts SET q_started_ms = q_started_ms - 45000 WHERE id = $attemptId");
$r = $s->post('attempt_answer', ['attempt_id' => $attemptId, 'index' => $idx, 'response' => ['choice' => 'a']]);
check($r['ok'] && $r['data']['accepted'] === false && $r['data']['state']['index'] === $idx + 1, 'réponse envoyée après le chrono refusée (question passée par le serveur)', $r);

echo "== Fin du quiz\n";
$guard = 0;
while ($guard++ < 25) {
    $r = $s->post('attempt_state', ['attempt_id' => $attemptId, 'serve' => true]);
    if ($r['data']['status'] !== 'in_progress') {
        break;
    }
    $q = $r['data']['question'];
    $s->post('attempt_heartbeat', ['attempt_id' => $attemptId, 'vis' => 'visible', 'focus' => true]);
    $s->post('attempt_answer', ['attempt_id' => $attemptId, 'index' => $r['data']['index'], 'response' => ['choice' => $correctOf($q)]]);
}
check($r['data']['status'] === 'finished' && $r['data']['result'] === null, 'quiz terminé, note cachée avant publication', $r);
$r = $s->post('attempt_result', ['attempt_id' => $attemptId]);
check($r['_http'] === 403 && $r['code'] === 'not_released', 'correction inaccessible avant publication', $r);
$r = $s->post('quiz_start', ['quiz_id' => $quizId]);
check($r['_http'] === 409, 'impossible de repasser le quiz', $r);
$t->post('t_quiz_release', ['quiz_id' => $quizId, 'released' => true]);
$r = $s->post('attempt_result', ['attempt_id' => $attemptId]);
check($r['ok'] && count($r['data']['items']) === 20 && $r['data']['attempt']['note20'] !== null, 'correction complète après publication', $r);
$lost = count(array_filter($r['data']['items'], fn($i) => $i['fraction'] < 1));
check($lost === 4, "4 questions perdues (sortie, signal perdu, rechargement, hors délai) : $lost", array_map(fn($i) => $i['status'], $r['data']['items']));
$r = $s->post('leaderboard', ['quiz_id' => $quizId]);
check($r['ok'] && $r['data']['my_rank'] === 1, 'classement disponible', $r);

echo "== Résultats professeure\n";
$r = $t->post('t_results', ['quiz_id' => $quizId]);
check($r['ok'] && $r['data']['stats']['count'] === 1 && count($r['data']['questions']) === 20, 'statistiques et analyse par question', $r['data']['stats'] ?? $r);
$csv = $t->raw('t_export', ['quiz_id' => $quizId]);
check(str_starts_with($csv, "\xEF\xBB\xBF") && str_contains($csv, 'DUPONT;Jean-Pierre'), 'export CSV compatible Excel', substr($csv, 0, 200));
$r = $t->post('t_attempt', ['attempt_id' => $attemptId]);
check($r['ok'] && count($r['data']['incidents']) >= 5, 'chronologie complète des incidents', count($r['data']['incidents'] ?? []));
$r = $t->post('t_attempt_action', ['attempt_id' => $attemptId, 'action' => 'exclude']);
$r = $t->post('t_results', ['quiz_id' => $quizId]);
check($r['data']['attempts'][0]['note20'] === 0.0 || $r['data']['attempts'][0]['note20'] === 0, 'exclusion = 0/20', $r['data']['attempts'][0] ?? null);

echo "== Éditeur de quiz\n";
$r = $t->post('t_quiz_save', ['title' => 'Test éditeur', 'level' => 'Seconde', 'shuffle_questions' => true, 'shuffle_choices' => true, 'feedback_mode' => 'immediate', 'require_fullscreen' => true, 'exit_action' => 'lock', 'access_code' => 'ab-12 cd']);
check($r['ok'] && $r['data']['quiz']['access_code'] === 'AB12CD', 'création de quiz, code d’accès normalisé', $r);
$newQuiz = $r['data']['quiz']['id'];
$r = $t->post('t_question_save', ['quiz_id' => $newQuiz, 'type' => 'numeric', 'prompt' => 'Taux ?', 'points' => 2, 'time_limit' => 30, 'data' => ['value' => '-2,5', 'tolerance' => '0,1', 'unit' => '%']]);
check($r['ok'] && $r['data']['question']['data']['value'] == -2.5, 'question numérique (virgule française)', $r);
$r = $t->post('t_question_save', ['quiz_id' => $newQuiz, 'type' => 'single', 'prompt' => 'X', 'data' => ['choices' => [['text' => 'a', 'correct' => true], ['text' => 'b', 'correct' => true]]]]);
check(!$r['ok'], 'choix unique avec 2 bonnes réponses refusé', $r);
$r = $t->post('t_import', ['quiz_id' => $newQuiz, 'text' => "Le PIB mesure ?\nA. la production\nB. le patrimoine\nANSWER: A\n\nSources de croissance ?\nA) travail\nB) capital\nC) chômage\nANSWER: A, B"]);
check($r['ok'] && $r['data']['created'] === 2 && !$r['data']['errors'], 'import format Aiken (Moodle)', $r);
$r = $t->post('t_quiz_status', ['quiz_id' => $newQuiz, 'status' => 'open']);
check($r['ok'], 'ouverture du quiz', $r);
$r = $s->post('quiz_start', ['quiz_id' => $newQuiz]);
check($r['_http'] === 400 && $r['code'] === 'code_required', 'code d’accès exigé', $r);
$r = $s->post('quiz_start', ['quiz_id' => $newQuiz, 'code' => 'ZZZZ99']);
check($r['_http'] === 403 && $r['code'] === 'bad_code', 'mauvais code refusé', $r);
$r = $s->post('quiz_start', ['quiz_id' => $newQuiz, 'code' => 'ab12cd']);
check($r['ok'], 'bon code accepté', $r);
$att2 = $r['data']['attempt_id'];
$r = $s->post('attempt_state', ['attempt_id' => $att2, 'serve' => true]);
$q = $r['data']['question'];
$resp = match ($q['type']) {
    'numeric' => ['text' => '−2,5 %'],
    'single' => ['choice' => 'a'],
    default => ['choices' => ['a', 'b']],
};
$r = $s->post('attempt_answer', ['attempt_id' => $att2, 'index' => 0, 'response' => $resp]);
check($r['ok'] && $r['data']['feedback']['correct'] === true && $r['data']['feedback']['points_gained'] > 0, 'mode Kahoot : correction immédiate + points de rapidité (' . $q['type'] . ')', $r);

echo "== Anti force brute\n";
$bf = new Client($base);
for ($i = 0; $i < 8; $i++) {
    $bf->post('login_student', ['first_name' => 'Jean-Pierre', 'last_name' => 'Dupont', 'password' => 'x' . $i]);
}
$r = $bf->post('login_student', ['first_name' => 'Jean-Pierre', 'last_name' => 'Dupont', 'password' => 'ses-2026']);
check($r['_http'] === 429, 'compte bloqué 15 min après 8 échecs', $r);

echo "\n$passes réussis, $failures échecs\n";
exit($failures ? 1 : 0);
