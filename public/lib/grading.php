<?php
defined('APP') || exit;

const QUESTION_TYPES = ['single', 'multiple', 'truefalse', 'short', 'numeric', 'ordering'];

function normalize_answer(string $s): string
{
    $s = mb_strtolower(trim($s));
    $s = strip_accents($s);
    $s = preg_replace('/[^a-z0-9%]+/', ' ', $s);
    $s = trim(preg_replace('/\s+/', ' ', $s));
    $s = preg_replace('/^(les|le|la|l|un|une|des|du|d)\s+/', '', $s);
    return $s;
}

function parse_number(string $s): ?float
{
    $s = str_replace(["\u{2212}", "\u{2013}", "\u{2014}"], '-', $s);
    $s = preg_replace('/[^0-9,.\-+]/u', '', $s);
    $s = str_replace(',', '.', $s);
    if (!preg_match('/^[+-]?(\d+(\.\d*)?|\.\d+)$/', $s)) {
        return null;
    }
    return (float) $s;
}

function typo_allowance(int $len): int
{
    if ($len >= 12) {
        return 2;
    }
    return $len >= 5 ? 1 : 0;
}

/**
 * Grades a response. Returns fraction (0..1), score (points earned) and Kahoot-style points.
 */
function grade_question(array $q, $response, ?int $timeMs, bool $speedBonus): array
{
    $data = $q['data'];
    $fraction = 0.0;
    $r = is_array($response) ? $response : [];

    switch ($q['type']) {
        case 'single':
            $choice = $r['choice'] ?? null;
            foreach ($data['choices'] as $c) {
                if (is_string($choice) && $c['id'] === $choice && !empty($c['correct'])) {
                    $fraction = 1.0;
                }
            }
            break;

        case 'truefalse':
            $v = $r['value'] ?? null;
            if ($v === 'true' || $v === 'false') {
                $v = $v === 'true';
            }
            if (is_bool($v) && $v === (bool) $data['answer']) {
                $fraction = 1.0;
            }
            break;

        case 'multiple':
            $valid = array_column($data['choices'], 'id');
            $correct = array_column(array_filter($data['choices'], fn($c) => !empty($c['correct'])), 'id');
            $selected = array_values(array_unique(array_filter((array) ($r['choices'] ?? []), fn($id) => is_string($id) && in_array($id, $valid, true))));
            $good = count(array_intersect($selected, $correct));
            $bad = count(array_diff($selected, $correct));
            if ($correct) {
                if ($q['partial']) {
                    $fraction = max(0.0, ($good - $bad) / count($correct));
                } else {
                    $fraction = ($good === count($correct) && $bad === 0) ? 1.0 : 0.0;
                }
            }
            break;

        case 'short':
            $text = normalize_answer((string) ($r['text'] ?? ''));
            if ($text !== '') {
                foreach ($data['answers'] as $accepted) {
                    $a = normalize_answer((string) $accepted);
                    if ($a === '') {
                        continue;
                    }
                    if ($a === $text || (!empty($data['tolerance']) && levenshtein($a, $text) <= typo_allowance(strlen($a)))) {
                        $fraction = 1.0;
                        break;
                    }
                }
            }
            break;

        case 'numeric':
            $v = parse_number((string) ($r['text'] ?? ''));
            if ($v !== null && abs($v - (float) $data['value']) <= (float) ($data['tolerance'] ?? 0) + 1e-9) {
                $fraction = 1.0;
            }
            break;

        case 'ordering':
            $expected = array_column($data['items'], 'id');
            $given = array_values((array) ($r['order'] ?? []));
            $isPermutation = count($given) === count($expected) && !array_diff($expected, $given) && count(array_unique($given)) === count($given);
            if ($isPermutation) {
                $matches = 0;
                foreach ($expected as $i => $id) {
                    if ($given[$i] === $id) {
                        $matches++;
                    }
                }
                if ($q['partial']) {
                    $fraction = $matches / count($expected);
                } else {
                    $fraction = $matches === count($expected) ? 1.0 : 0.0;
                }
            }
            break;
    }

    $fraction = round(min(1.0, max(0.0, $fraction)), 4);
    $points = 0;
    if ($fraction > 0) {
        $factor = 1.0;
        if ($speedBonus && $q['time_limit'] > 0 && $timeMs !== null) {
            $factor = 1 - min(1, max(0, $timeMs / ($q['time_limit'] * 1000))) / 2;
        }
        $weight = min(5.0, max(0.0, (float) $q['points']));
        $points = (int) round(1000 * $weight * $fraction * $factor);
    }

    return [
        'fraction' => $fraction,
        'score' => round((float) $q['points'] * $fraction, 2),
        'points' => $points,
    ];
}

/** Sanitises a student response before storage (bounded size, expected shape only). */
function clean_response(array $q, $response): ?array
{
    if (!is_array($response)) {
        return null;
    }
    switch ($q['type']) {
        case 'single':
            return ['choice' => is_string($response['choice'] ?? null) ? mb_substr($response['choice'], 0, 20) : null];
        case 'truefalse':
            $v = $response['value'] ?? null;
            return ['value' => $v === true || $v === 'true' ? true : ($v === false || $v === 'false' ? false : null)];
        case 'multiple':
            return ['choices' => array_slice(array_values(array_filter((array) ($response['choices'] ?? []), 'is_string')), 0, 12)];
        case 'short':
        case 'numeric':
            return ['text' => mb_substr(is_scalar($response['text'] ?? null) ? (string) $response['text'] : '', 0, 300)];
        case 'ordering':
            return ['order' => array_slice(array_values(array_filter((array) ($response['order'] ?? []), 'is_string')), 0, 12)];
    }
    return null;
}

/** Correct answer, as shown in corrections. */
function correction_of(array $q): array
{
    $d = $q['data'];
    switch ($q['type']) {
        case 'single':
        case 'multiple':
            return ['choices' => array_map(fn($c) => ['id' => $c['id'], 'text' => $c['text'], 'correct' => !empty($c['correct'])], $d['choices'])];
        case 'truefalse':
            return ['value' => (bool) $d['answer']];
        case 'short':
            return ['answers' => array_values($d['answers'])];
        case 'numeric':
            return ['value' => (float) $d['value'], 'tolerance' => (float) ($d['tolerance'] ?? 0), 'unit' => (string) ($d['unit'] ?? '')];
        case 'ordering':
            return ['items' => array_map(fn($i) => ['id' => $i['id'], 'text' => $i['text']], $d['items'])];
    }
    return [];
}
