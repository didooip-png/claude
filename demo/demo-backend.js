/* Quiz SES — serveur de démonstration exécuté dans le navigateur.
 * Mirrors the PHP API (public/lib/*.php) action by action so the very same interface runs on a static page.
 * Data lives in this browser only (localStorage, per-tab session in sessionStorage). Not for real exams:
 * on a static page the answers necessarily ship with the page. */
(function (QZ) {
  'use strict';
  const KEY = 'qzdemo.db.v3';
  const SKEY = 'qzdemo.session.v3';
  const DEMO = window.QZ_DEMO_DATA;
  let mem = null;
  let memSession = null;
  let storageOk = true;

  /* ---------------- Storage ---------------- */
  function load() {
    try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { storageOk = false; }
    return mem;
  }
  function save(db) {
    mem = db;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { storageOk = false; }
  }
  function getSession() {
    try { const s = sessionStorage.getItem(SKEY); if (s) return JSON.parse(s); } catch (e) { /* ignore */ }
    return memSession || {};
  }
  function setSession(s) {
    memSession = s;
    try { sessionStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  /* ---------------- Helpers ---------------- */
  const now = () => Date.now();
  const sec = () => Math.floor(Date.now() / 1000);
  const fail = (m, status = 400, code = 'error') => { throw new QZ.ApiError(m, status, code); };
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
  const byId = (arr, id) => arr.find((x) => x.id === +id);
  const str = (v, max = 1000) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\0/g, '').trim().slice(0, max) : '');
  const int = (v, d = 0) => (v !== null && v !== '' && !isNaN(+v) ? Math.trunc(+v) : d);
  const bool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
  const round2 = (n) => Math.round(n * 100) / 100;
  const note20 = (s, m) => (m > 0 ? round2((s / m) * 20) : null);

  function stripAccents(s) {
    return String(s).replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  const nameKey = (s) => stripAccents(String(s).toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
  const studentKey = (f, l) => nameKey(f) + '|' + nameKey(l);
  function cleanName(s) {
    s = String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).toLowerCase();
    return s.replace(/(^|[\s\-’'])(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
  }
  const validName = (s) => /^[\p{L}][\p{L}\s\-’'.]{0,59}$/u.test(s);

  /* Compact synchronous SHA-256 (passwords are never stored in clear, even in the demo). */
  function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length;
    const withPad = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    withPad.set(bytes);
    withPad[l] = 0x80;
    const bits = l * 8;
    const dv = new DataView(withPad.buffer);
    dv.setUint32(withPad.length - 4, bits >>> 0);
    dv.setUint32(withPad.length - 8, Math.floor(bits / 0x100000000));
    const W = new Uint32Array(64);
    const r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < withPad.length; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }
  const hashPw = (db, pw) => { const salt = hex(8); return salt + '$' + sha256(db.pepper + salt + pw); };
  const checkPw = (db, pw, stored) => { const [salt, h] = String(stored).split('$'); return sha256(db.pepper + salt + pw) === h; };

  /* ---------------- Grading (same rules as grading.php) ---------------- */
  function normalizeAnswer(s) {
    s = stripAccents(String(s).toLowerCase().trim()).replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s.replace(/^(les|le|la|l|un|une|des|du|d)\s+/, '');
  }
  function parseNumber(s) {
    s = String(s).replace(/[−–—]/g, '-').replace(/[^0-9,.\-+]/g, '').replace(/,/g, '.');
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
    return parseFloat(s);
  }
  function lev(a, b) {
    const m = a.length; const n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  const typoAllowance = (len) => (len >= 12 ? 2 : len >= 5 ? 1 : 0);
  function grade(q, r, timeMs, speed) {
    const d = q.data;
    r = r && typeof r === 'object' ? r : {};
    let f = 0;
    if (q.type === 'single') { if (d.choices.some((c) => c.id === r.choice && c.correct)) f = 1; }
    else if (q.type === 'truefalse') { let v = r.value; if (v === 'true' || v === 'false') v = v === 'true'; if (typeof v === 'boolean' && v === !!d.answer) f = 1; }
    else if (q.type === 'multiple') {
      const valid = d.choices.map((c) => c.id);
      const correct = d.choices.filter((c) => c.correct).map((c) => c.id);
      const sel = Array.from(new Set((r.choices || []).filter((id) => valid.includes(id))));
      const good = sel.filter((id) => correct.includes(id)).length;
      const bad = sel.filter((id) => !correct.includes(id)).length;
      if (correct.length) f = q.partial ? Math.max(0, (good - bad) / correct.length) : (good === correct.length && bad === 0 ? 1 : 0);
    } else if (q.type === 'short') {
      const t = normalizeAnswer(r.text || '');
      if (t) for (const acc of d.answers) { const a = normalizeAnswer(acc); if (a && (a === t || (d.tolerance && lev(a, t) <= typoAllowance(a.length)))) { f = 1; break; } }
    } else if (q.type === 'numeric') {
      const v = parseNumber(r.text || '');
      if (v !== null && Math.abs(v - d.value) <= (+d.tolerance || 0) + 1e-9) f = 1;
    } else if (q.type === 'ordering') {
      const exp = d.items.map((i) => i.id);
      const given = Array.isArray(r.order) ? r.order : [];
      const perm = given.length === exp.length && exp.every((id) => given.includes(id)) && new Set(given).size === given.length;
      if (perm) { const m = exp.filter((id, i) => given[i] === id).length; f = q.partial ? m / exp.length : (m === exp.length ? 1 : 0); }
    }
    f = Math.round(Math.min(1, Math.max(0, f)) * 10000) / 10000;
    let points = 0;
    if (f > 0) {
      let factor = 1;
      if (speed && q.time_limit > 0 && timeMs !== null) factor = 1 - Math.min(1, Math.max(0, timeMs / (q.time_limit * 1000))) / 2;
      points = Math.round(1000 * Math.min(5, Math.max(0, q.points)) * f * factor);
    }
    return { fraction: f, score: round2(q.points * f), points };
  }
  function cleanResponse(q, r) {
    if (!r || typeof r !== 'object') return null;
    switch (q.type) {
      case 'single': return { choice: typeof r.choice === 'string' ? r.choice.slice(0, 20) : null };
      case 'truefalse': return { value: r.value === true || r.value === 'true' ? true : r.value === false || r.value === 'false' ? false : null };
      case 'multiple': return { choices: (Array.isArray(r.choices) ? r.choices : []).filter((x) => typeof x === 'string').slice(0, 12) };
      case 'short': case 'numeric': return { text: String(r.text == null ? '' : r.text).slice(0, 300) };
      case 'ordering': return { order: (Array.isArray(r.order) ? r.order : []).filter((x) => typeof x === 'string').slice(0, 12) };
    }
    return null;
  }
  function correctionOf(q) {
    const d = q.data;
    switch (q.type) {
      case 'single': case 'multiple': return { choices: d.choices.map((c) => ({ id: c.id, text: c.text, correct: !!c.correct })) };
      case 'truefalse': return { value: !!d.answer };
      case 'short': return { answers: d.answers.slice() };
      case 'numeric': return { value: +d.value, tolerance: +d.tolerance || 0, unit: d.unit || '' };
      case 'ordering': return { items: d.items.map((i) => ({ id: i.id, text: i.text })) };
    }
    return {};
  }
  function publicQuestion(q, orders) {
    const out = { id: q.id, type: q.type, prompt: q.prompt, image: q.image, points: q.points, time_limit: q.time_limit };
    const order = orders && orders[String(q.id)];
    const pick = (list) => {
      const map = Object.fromEntries(list.map((x) => [x.id, x.text]));
      const ids = Array.isArray(order) ? order.filter((id) => id in map) : Object.keys(map);
      Object.keys(map).forEach((id) => { if (!ids.includes(id)) ids.push(id); });
      return ids.map((id) => ({ id, text: map[id] }));
    };
    if (q.type === 'single' || q.type === 'multiple') out.choices = pick(q.data.choices);
    if (q.type === 'ordering') out.items = pick(q.data.items);
    if (q.type === 'numeric') out.unit = q.data.unit || '';
    return out;
  }

  /* ---------------- Quizzes ---------------- */
  const quizOr404 = (db, id) => byId(db.quizzes, id) || fail('Quiz introuvable.', 404, 'not_found');
  const quizQuestions = (db, qid) => db.questions.filter((q) => q.quiz_id === qid).sort((a, b) => a.position - b.position || a.id - b.id);
  const quizClassIds = (db, qid) => db.quiz_classes.filter((x) => x.quiz_id === qid).map((x) => x.class_id);
  function quizWindow(q) { const t = sec(); if (q.opens_at && t < q.opens_at) return 'not_yet'; if (q.closes_at && t > q.closes_at) return 'ended'; return 'open'; }
  function canSee(db, quiz, u) { if (quiz.status !== 'open') return false; const c = quizClassIds(db, quiz.id); return !c.length || (u.class_id !== null && c.includes(u.class_id)); }
  const resultsVisible = (quiz) => quiz.feedback_mode !== 'release' || quiz.results_released;
  const cleanId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);

  function validateQuestion(inp) {
    const type = str(inp.type, 20);
    if (!['single', 'multiple', 'truefalse', 'short', 'numeric', 'ordering'].includes(type)) fail('Type de question invalide.');
    const prompt = str(inp.prompt, 5000);
    if (!prompt) fail('L’énoncé de la question est obligatoire.');
    const points = round2(parseFloat(inp.points ?? 1) || 0);
    if (points < 0 || points > 100) fail('Le barème doit être compris entre 0 et 100 points.');
    let time = int(inp.time_limit, 30);
    if (time < 0 || time > 3600) fail('Le temps par question doit être compris entre 0 et 3600 secondes.');
    if (time > 0 && time < 5) time = 5;
    const image = typeof inp.image === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/.test(inp.image) && inp.image.length < 1500000 ? inp.image : null;
    const raw = inp.data && typeof inp.data === 'object' ? inp.data : {};
    const data = {};
    if (type === 'single' || type === 'multiple') {
      const seen = new Set();
      const choices = (raw.choices || []).filter((c) => c && str(c.text, 500)).map((c) => {
        let id = cleanId(c.id);
        if (!id || seen.has(id)) id = 'c' + hex(3);
        seen.add(id);
        return { id, text: str(c.text, 500), correct: bool(c.correct) };
      });
      if (choices.length < 2 || choices.length > 8) fail('Il faut entre 2 et 8 propositions de réponse.');
      const n = choices.filter((c) => c.correct).length;
      if (type === 'single' && n !== 1) fail('Coche exactement une bonne réponse.');
      if (type === 'multiple' && n < 1) fail('Coche au moins une bonne réponse.');
      data.choices = choices;
    } else if (type === 'truefalse') {
      data.answer = bool(raw.answer);
    } else if (type === 'short') {
      const answers = [];
      (raw.answers || []).forEach((a) => { a = typeof a === 'string' ? a.trim().slice(0, 200) : ''; if (a && normalizeAnswer(a) && !answers.includes(a)) answers.push(a); });
      if (!answers.length || answers.length > 30) fail('Indique au moins une réponse acceptée (30 maximum).');
      data.answers = answers;
      data.tolerance = bool(raw.tolerance);
    } else if (type === 'numeric') {
      const v = typeof raw.value === 'number' ? raw.value : parseNumber(raw.value ?? '');
      if (v === null || !isFinite(v)) fail('Indique la valeur numérique attendue.');
      const tol = typeof raw.tolerance === 'number' ? raw.tolerance : parseNumber(raw.tolerance ?? '') ?? 0;
      data.value = v; data.tolerance = Math.abs(tol); data.unit = str(raw.unit, 20);
    } else if (type === 'ordering') {
      const seen = new Set();
      const items = (raw.items || []).filter((i) => i && str(i.text, 300)).map((i) => {
        let id = cleanId(i.id);
        if (!id || seen.has(id)) id = 'i' + hex(3);
        seen.add(id);
        return { id, text: str(i.text, 300) };
      });
      if (items.length < 2 || items.length > 10) fail('Il faut entre 2 et 10 éléments à remettre dans l’ordre.');
      data.items = items;
    }
    const expl = str(inp.explanation, 3000);
    return { type, prompt, image, data, points, time_limit: time, partial: (type === 'multiple' || type === 'ordering') && bool(inp.partial), explanation: expl || null };
  }

  function validateQuiz(inp) {
    const title = str(inp.title, 200);
    if (!title) fail('Le titre du quiz est obligatoire.');
    let level = str(inp.level, 30);
    if (!['Seconde', 'Première', 'Terminale', 'Autre'].includes(level)) level = 'Autre';
    const code = str(inp.access_code, 20).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (code && (code.length < 4 || code.length > 12)) fail('Le code d’accès doit contenir entre 4 et 12 lettres ou chiffres.');
    const opens = int(inp.opens_at, 0);
    const closes = int(inp.closes_at, 0);
    if (opens && closes && closes <= opens) fail('La date de fermeture doit être après la date d’ouverture.');
    const fb = ['immediate', 'end', 'release'].includes(inp.feedback_mode) ? inp.feedback_mode : 'release';
    const ea = ['lock', 'submit', 'log'].includes(inp.exit_action) ? inp.exit_action : 'lock';
    const ips = str(inp.allowed_ips, 500).split(/[\s,;]+/).filter(Boolean);
    ips.forEach((r) => { if (!/^[0-9a-fA-F:.]+\*?$/.test(r)) fail('Adresse IP invalide : « ' + r.slice(0, 40) + ' ».'); });
    return {
      title, description: str(inp.description, 2000), level, chapter: str(inp.chapter, 200), access_code: code || null,
      opens_at: opens > 0 ? opens : null, closes_at: closes > 0 ? closes : null,
      max_attempts: Math.max(1, Math.min(20, int(inp.max_attempts, 1))), time_limit: Math.max(0, Math.min(21600, int(inp.time_limit, 0))),
      shuffle_questions: bool(inp.shuffle_questions), shuffle_choices: bool(inp.shuffle_choices), pool_size: Math.max(0, Math.min(500, int(inp.pool_size, 0))),
      feedback_mode: fb, show_leaderboard: bool(inp.show_leaderboard), speed_bonus: bool(inp.speed_bonus), require_fullscreen: bool(inp.require_fullscreen),
      max_exits: Math.max(0, Math.min(10, int(inp.max_exits, 0))), exit_action: ea, allowed_ips: ips.length ? Array.from(new Set(ips)).join(', ') : null
    };
  }

  /* Same parser as parse_aiken() in quiz.php. */
  function parseAiken(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const questions = [];
    const errors = [];
    let cur = null;
    const finish = () => {
      if (!cur) return;
      const label = 'Question « ' + cur.prompt.join(' ').slice(0, 50) + ' »';
      const letters = Object.keys(cur.choices);
      if (!letters.length && cur.answer === null) { cur = null; return; }
      if (letters.length < 2) errors.push(label + ' : il faut au moins 2 propositions (A. B. …).');
      else if (!cur.answer || !cur.answer.length) errors.push(label + ' : bonne réponse manquante (ligne « ANSWER: B » ou « ✓ B »).');
      else {
        const missing = cur.answer.filter((l) => !letters.includes(l));
        if (missing.length) errors.push(label + ' : la réponse « ' + missing.join(', ') + ' » ne correspond à aucune proposition.');
        else questions.push({ type: cur.answer.length > 1 ? 'multiple' : 'single', prompt: cur.prompt.join('\n').trim(), data: { choices: letters.map((l) => ({ id: l.toLowerCase(), text: cur.choices[l], correct: cur.answer.includes(l) })) }, explanation: cur.explanation });
      }
      cur = null;
    };
    const start = (p) => { finish(); cur = { prompt: [p], choices: {}, answer: null, explanation: null, last: null }; };
    for (const rawLine of lines) {
      const line = rawLine.replace(/^[\s•◦▪●‣⁃∙*\-–]+(?=\S)/u, '').trim();
      if (!line) continue;
      let m = line.match(/^(?:[✓✔☑✅]|ANSWER|R[ÉEée]PONSES?|BONNES?\s+R[ÉEée]PONSES?)\s*[:：]?\s*([A-Ha-h](?:\s*(?:,|;|&|\bet\b|\/)\s*[A-Ha-h])*)(?![\p{L}\d])\s*(?:[—–\-:.)]\s*(.*))?$/iu);
      if (m && cur) { cur.answer = Array.from(new Set(m[1].trim().split(/\s*(?:,|;|&|\bet\b|\/)\s*/u).map((x) => x.toUpperCase()))); if (m[2] && m[2].trim()) cur.explanation = m[2].trim(); continue; }
      m = line.match(/^(?:EXPLICATION|FEEDBACK|CORRECTION)\s*[:：]\s*(.+)$/iu);
      if (m && cur) { cur.explanation = m[1].trim(); continue; }
      m = line.match(/^([A-Ha-h])\s*[.)\]:]\s*(.+)$/u);
      if (m && cur && cur.answer === null) { const l = m[1].toUpperCase(); cur.choices[l] = m[2].trim(); cur.last = l; continue; }
      m = line.match(/^(?:Q(?:uestion)?\s*)?\d{1,3}\s*[.)\-:]\s*(.+)$/iu);
      if (m) { start(m[1].trim()); continue; }
      if (!cur || cur.answer !== null) start(line);
      else if (!Object.keys(cur.choices).length) cur.prompt.push(line);
      else if (cur.last) cur.choices[cur.last] += ' ' + line;
    }
    finish();
    return [questions, errors];
  }

  /* ---------------- Attempts (same rules as attempt.php) ---------------- */
  const EXIT_TYPES = ['hidden', 'blur', 'fullscreen', 'reload', 'device', 'ai_extension', 'devtools', 'gap', 'automation', 'split', 'hb_hidden', 'hb_blur', 'tamper'];
  const CLIENT_INCIDENTS = ['hidden', 'blur', 'fullscreen', 'ai_extension', 'devtools', 'split', 'automation', 'paste', 'copy', 'shortcut', 'screenshot', 'print', 'multiscreen', 'typing', 'extension', 'back', 'mouse_out', 'tamper'];
  const HEARTBEAT_GAP_MS = 10000;
  const GRACE = 2500;
  const MERGE = 4000;
  const LABELS = {
    hidden: 'A quitté la page / l’application', blur: 'A utilisé une autre fenêtre ou application', fullscreen: 'Est sorti du plein écran', reload: 'A rechargé la page pendant une question',
    device: 'S’est connecté depuis un autre appareil', ai_extension: 'Extension d’IA détectée dans le navigateur', devtools: 'Outils de développement ouverts', gap: 'Signal perdu (application quittée ou page figée)',
    automation: 'Navigateur automatisé détecté', split: 'Écran partagé / fenêtre réduite', hb_hidden: 'Page masquée (contrôle serveur)', hb_blur: 'Page sans le focus (contrôle serveur)',
    paste: 'Tentative de coller', copy: 'Tentative de copier', shortcut: 'Raccourci clavier bloqué', screenshot: 'Touche capture d’écran', print: 'Tentative d’impression', multiscreen: 'Plusieurs écrans détectés',
    typing: 'Texte inséré d’un coup (IA / dictée ?)', extension: 'Élément inconnu injecté dans la page', back: 'Tentative de retour arrière', mouse_out: 'Souris hors de la fenêtre', warning_ack: 'A lu l’avertissement',
    tamper: 'Modification du fonctionnement de la page', teacher: 'Action de la professeure'
  };

  const curQ = (db, a) => { const id = a.question_ids[a.current_index]; return id === undefined ? null : byId(db.questions, id) || null; };
  function storeAnswer(db, a, q, response, status, g, timeMs) {
    if (db.answers.some((x) => x.attempt_id === a.id && x.question_id === q.id)) return;
    db.answers.push({ id: ++db.seq.answer, attempt_id: a.id, question_id: q.id, position: a.current_index, response, status, fraction: g.fraction, score: g.score, points: g.points, override_score: null, time_ms: timeMs, created_ms: now() });
  }
  const ZERO = { fraction: 0, score: 0, points: 0 };
  function advance(db, a) { a.current_index++; a.q_started_ms = null; if (a.current_index >= a.question_ids.length) finishAttempt(db, a, 'completed'); }
  function finishAttempt(db, a, reason) {
    if (a.status === 'finished') return;
    const q = a.q_started_ms !== null ? curQ(db, a) : null;
    if (q) storeAnswer(db, a, q, null, 'timeout', ZERO, now() - a.q_started_ms);
    Object.assign(a, { status: 'finished', finish_reason: reason, lock_reason: null, q_started_ms: null, finished_ms: now() });
  }
  function cancelCurrent(db, a) {
    if (a.q_started_ms === null) return;
    const q = curQ(db, a);
    if (q) storeAnswer(db, a, q, null, 'cancelled', ZERO, now() - a.q_started_ms);
    advance(db, a);
  }
  function logIncident(db, a, type, detail, dur, counted, key = null) {
    a.incidents++;
    if (dur) a.away_ms += Math.min(dur, 3600000);
    db.incidents.push({ id: ++db.seq.incident, attempt_id: a.id, type, detail: detail ? String(detail).slice(0, 255) : null, question_index: a.status === 'finished' ? null : a.current_index, duration_ms: dur ?? null, counted: !!counted, exit_key: key, created_ms: now() });
  }
  function registerExit(db, a, quiz, type, detail, dur, key) {
    if (key) {
      const ex = db.incidents.find((i) => i.attempt_id === a.id && i.exit_key === key);
      if (ex) { if (dur && dur > (ex.duration_ms || 0)) { a.away_ms += dur - (ex.duration_ms || 0); ex.duration_ms = dur; } return { action: null }; }
    }
    let counted = a.status === 'in_progress';
    if (counted && !['reload', 'device', 'gap'].includes(type)) {
      const recent = db.incidents.filter((i) => i.attempt_id === a.id && i.counted && !['reload', 'device', 'gap'].includes(i.type)).reduce((m, i) => Math.max(m, i.created_ms), 0);
      if (recent && now() - recent < MERGE && (a.q_started_ms === null || a.q_started_ms <= recent)) counted = false;
    }
    logIncident(db, a, type, detail, dur, counted, key);
    if (!counted) return { action: null };
    a.exits++;
    if (quiz.exit_action === 'log') return { action: 'warn', cancelled: false };
    const cancelled = a.q_started_ms !== null;
    cancelCurrent(db, a);
    if (a.status !== 'in_progress') return { action: 'submit', cancelled };
    if (a.exits > quiz.max_exits) {
      if (quiz.exit_action === 'submit') { finishAttempt(db, a, 'exits'); return { action: 'submit', cancelled }; }
      a.status = 'locked';
      a.lock_reason = LABELS[type] || 'Sortie du quiz détectée';
      return { action: 'lock', cancelled };
    }
    return { action: 'warn', cancelled };
  }
  function sync(db, a, quiz) {
    const t = now();
    if (a.status === 'finished') return;
    if (a.deadline_ms && t > a.deadline_ms + GRACE) { finishAttempt(db, a, 'timeout'); return; }
    if (a.status !== 'in_progress' || a.q_started_ms === null) return;
    const q = curQ(db, a);
    if (!q) { finishAttempt(db, a, 'completed'); return; }
    const qd = q.time_limit > 0 ? a.q_started_ms + q.time_limit * 1000 : null;
    const last = Math.max(a.last_seen_ms, a.q_started_ms);
    const gapEnd = qd !== null ? Math.min(t, qd) : t;
    if (gapEnd - last > HEARTBEAT_GAP_MS) registerExit(db, a, quiz, 'gap', 'Aucun signal pendant ' + Math.round((gapEnd - last) / 1000) + ' s', gapEnd - last, 'gap-' + a.current_index);
    if (a.status === 'in_progress' && a.q_started_ms !== null && qd !== null && t > qd + GRACE) { storeAnswer(db, a, q, null, 'timeout', ZERO, q.time_limit * 1000); advance(db, a); }
  }
  function checkDevice(db, a, quiz, sess) {
    if (sess.tok && a.session_token && a.session_token !== sess.tok) {
      if (a.status !== 'finished') registerExit(db, a, quiz, 'device', 'Autre onglet ou appareil', null, null);
      a.session_token = sess.tok;
    }
  }
  function serve(a) { if (a.status === 'in_progress' && a.q_started_ms === null && a.current_index < a.question_ids.length) { a.q_started_ms = now(); a.last_seen_ms = a.q_started_ms; } }
  function recompute(db, a) {
    const max = a.question_ids.reduce((s, id) => s + ((byId(db.questions, id) || {}).points || 0), 0);
    const ans = db.answers.filter((x) => x.attempt_id === a.id);
    const score = ans.reduce((s, x) => s + (x.override_score ?? x.score), 0);
    a.max_score = round2(max);
    a.score = a.zeroed ? 0 : round2(Math.min(max, score));
    a.points = a.zeroed ? 0 : ans.reduce((s, x) => s + x.points, 0);
  }
  function streak(db, a) { let n = 0; for (const x of db.answers.filter((y) => y.attempt_id === a.id).sort((p, q) => q.position - p.position)) { if (x.fraction < 1) break; n++; } return n; }
  function payload(db, a, quiz, u) {
    recompute(db, a);
    const t = now();
    const p = {
      attempt_id: a.id, status: a.status, finish_reason: a.finish_reason, lock_reason: a.lock_reason, index: a.current_index, total: a.question_ids.length, exits: a.exits, is_preview: a.is_preview,
      deadline_remaining_ms: a.deadline_ms ? Math.max(0, a.deadline_ms - t) : null,
      warning: a.warning_text !== null ? { id: a.warning_ms, text: a.warning_text } : null,
      student: (u.first_name + ' ' + (u.last_name || '').toUpperCase()).trim(),
      quiz: { id: quiz.id, title: quiz.title, level: quiz.level, feedback_mode: quiz.feedback_mode, require_fullscreen: quiz.require_fullscreen, max_exits: quiz.max_exits, exit_action: quiz.exit_action, time_limit: quiz.time_limit, show_leaderboard: quiz.show_leaderboard },
      points: quiz.feedback_mode === 'immediate' ? a.points : null, question: null, result: null
    };
    const q = a.status === 'in_progress' && a.q_started_ms !== null ? curQ(db, a) : null;
    if (q) { const pub = publicQuestion(q, a.choice_orders); pub.remaining_ms = q.time_limit > 0 ? Math.max(0, a.q_started_ms + q.time_limit * 1000 - t) : null; p.question = pub; }
    if (a.status === 'finished' && (a.is_preview || resultsVisible(quiz))) p.result = { score: a.score, max_score: a.max_score, note20: note20(a.score, a.max_score), points: a.points, zeroed: a.zeroed };
    return p;
  }
  function corrections(db, a, timing = true) {
    return a.question_ids.map((qid, pos) => {
      const q = byId(db.questions, qid);
      if (!q) return null;
      const ans = db.answers.find((x) => x.attempt_id === a.id && x.question_id === qid);
      const it = {
        position: pos, question: publicQuestion(q, a.choice_orders), correction: correctionOf(q), explanation: q.explanation, answer_id: ans ? ans.id : null,
        response: ans ? ans.response : null, status: ans ? ans.status : 'unanswered', fraction: ans ? ans.fraction : 0, score: ans ? (ans.override_score ?? ans.score) : 0,
        auto_score: ans ? ans.score : 0, overridden: !!(ans && ans.override_score !== null), max: q.points
      };
      if (timing) { it.time_ms = ans ? ans.time_ms : null; it.points = ans ? ans.points : 0; }
      return it;
    }).filter(Boolean);
  }
  function createAttempt(db, quiz, u, preview, sess) {
    const questions = quizQuestions(db, quiz.id);
    if (!questions.length) fail('Ce quiz ne contient encore aucune question.');
    let sel = questions;
    if (quiz.pool_size > 0 && quiz.pool_size < questions.length) sel = shuffle(questions.map((_, i) => i)).slice(0, quiz.pool_size).sort((a, b) => a - b).map((i) => questions[i]);
    if (quiz.shuffle_questions) sel = shuffle(sel);
    const orders = {};
    sel.forEach((q) => {
      if (q.type === 'single' || q.type === 'multiple') { const ids = q.data.choices.map((c) => c.id); orders[q.id] = quiz.shuffle_choices ? shuffle(ids) : ids; }
      if (q.type === 'ordering') { const ids = q.data.items.map((i) => i.id); let s = shuffle(ids); for (let k = 0; k < 10 && s.join() === ids.join(); k++) s = shuffle(ids); orders[q.id] = s; }
    });
    const t = now();
    const a = {
      id: ++db.seq.attempt, quiz_id: quiz.id, user_id: u.id, attempt_no: preview ? 0 : 1 + db.attempts.filter((x) => x.quiz_id === quiz.id && x.user_id === u.id && !x.is_preview).length,
      is_preview: preview, status: 'in_progress', finish_reason: null, lock_reason: null, question_ids: sel.map((q) => q.id), choice_orders: orders, current_index: 0, q_started_ms: null,
      started_ms: t, deadline_ms: quiz.time_limit > 0 ? t + quiz.time_limit * 1000 : null, finished_ms: null, last_seen_ms: t, score: 0, max_score: 0, points: 0, zeroed: false,
      warning_text: null, warning_ms: null, exits: 0, incidents: 0, away_ms: 0, session_token: sess.tok || '', ip: '127.0.0.1 (démo)', device: deviceLabel(), user_agent: navigator.userAgent.slice(0, 255)
    };
    db.attempts.push(a);
    return a;
  }
  function deviceLabel() {
    const ua = navigator.userAgent;
    if (/iPhone|iPod/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android' : 'Tablette Android';
    if (/CrOS/.test(ua)) return 'Chromebook';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'PC Windows';
    return 'Linux';
  }

  /* ---------------- Auth ---------------- */
  function currentUser(ctx) {
    const { db, sess } = ctx;
    if (!sess.uid) return null;
    const u = byId(db.users, sess.uid);
    if (!u || u.status === 'disabled' || u.session_token !== sess.tok) {
      if (u && u.session_token && u.session_token !== sess.tok) ctx.replaced = true;
      delete sess.uid; delete sess.tok;
      return null;
    }
    return u;
  }
  function requireUser(ctx) {
    const u = currentUser(ctx);
    if (!u) ctx.replaced ? fail('Tu as été déconnecté : ton compte vient d’être ouvert sur un autre appareil.', 401, 'session_replaced') : fail('Connexion requise.', 401, 'auth');
    return u;
  }
  function requireStudent(ctx, allowPending = false) {
    const u = requireUser(ctx);
    if (u.role !== 'student') fail('Réservé aux élèves.', 403, 'forbidden');
    if (u.must_change_password) fail('Tu dois d’abord choisir un nouveau mot de passe.', 403, 'must_change_password');
    if (!allowPending && u.status !== 'active') fail('Ton compte est en attente de validation par ta professeure.', 403, 'pending');
    return u;
  }
  function requireTeacher(ctx) {
    const u = requireUser(ctx);
    if (u.role !== 'teacher') fail('Accès réservé à la professeure.', 403, 'forbidden');
    if (u.must_change_password) fail('Choisis d’abord un nouveau mot de passe.', 403, 'must_change_password');
    return u;
  }
  const attemptUser = (ctx) => { const u = requireUser(ctx); return u.role === 'teacher' ? requireTeacher(ctx) : requireStudent(ctx); };
  function publicUser(db, u) {
    if (!u) return null;
    const c = u.class_id ? byId(db.classes, u.class_id) : null;
    return { id: u.id, role: u.role, first_name: u.first_name, last_name: u.last_name, class_id: u.class_id, class_name: c ? c.name : null, status: u.status, must_change_password: !!u.must_change_password };
  }
  function loginAs(ctx, u) { u.session_token = hex(16); u.last_login_at = sec(); ctx.sess.uid = u.id; ctx.sess.tok = u.session_token; }
  function passwordProblem(pw, role, names) {
    const min = role === 'teacher' ? 10 : 6;
    if (pw.length < min) return `Le mot de passe doit contenir au moins ${min} caractères.`;
    if (pw.length > 128) return 'Le mot de passe est trop long (128 caractères maximum).';
    if (role === 'teacher' && (!/\p{L}/u.test(pw) || !/\d/.test(pw))) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    if (names.some((n) => n && nameKey(n) === nameKey(pw))) return 'Le mot de passe ne doit pas être ton prénom ou ton nom.';
    if (['123456', '1234567', '12345678', 'azerty', 'azertyuiop', 'motdepasse', 'password', '000000', '111111', 'qwerty'].includes(pw.toLowerCase())) return 'Ce mot de passe est trop facile à deviner.';
    return null;
  }
  function throttle(db, key) {
    const since = now() - 900000;
    db.throttle = (db.throttle || []).filter((x) => x.t > since);
    if (db.throttle.filter((x) => x.k === key).length >= 8) fail('Trop de tentatives de connexion. Réessaie dans 15 minutes.', 429, 'throttled');
  }
  const throttleFail = (db, key) => { db.throttle.push({ k: key, t: now() }); };
  const throttleClear = (db, key) => { db.throttle = db.throttle.filter((x) => x.k !== key); };
  function audit(ctx, action, detail = null) {
    const u = currentUser(ctx);
    ctx.db.audit.push({ id: ++ctx.db.seq.audit, user_id: u ? u.id : null, action, detail: detail ? String(detail).slice(0, 255) : null, ip: '127.0.0.1 (démo)', created_at: sec() });
  }
  const display = (u) => (u.first_name + ' ' + (u.last_name || '').toUpperCase()).trim();
  const incRow = (i) => ({ id: i.id, type: i.type, label: LABELS[i.type] || i.type, detail: i.detail, question_index: i.question_index, duration_ms: i.duration_ms, counted: !!i.counted, created_ms: i.created_ms });
  const classesList = (db) => db.classes.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name, students: db.users.filter((u) => u.role === 'student' && u.class_id === c.id).length }));

  function sweep(db, quizId = null) {
    const t = now();
    db.attempts.filter((a) => !a.is_preview && (a.status === 'in_progress' || a.status === 'locked') && (!quizId || a.quiz_id === quizId)).forEach((a) => {
      if ((a.q_started_ms !== null && a.last_seen_ms < t - 3000) || (a.deadline_ms && a.deadline_ms < t) || (a.q_started_ms !== null && a.q_started_ms < t - 5000)) {
        sync(db, a, quizOr404(db, a.quiz_id));
        recompute(db, a);
      }
    });
  }

  function leaderboardData(db, quiz, userId) {
    const best = {};
    db.attempts.filter((a) => a.quiz_id === quiz.id && !a.is_preview && a.status === 'finished' && !a.zeroed).forEach((a) => {
      const r = a.max_score ? a.score / a.max_score : 0;
      if (!best[a.user_id] || a.points > best[a.user_id].points) best[a.user_id] = { points: a.points, ratio: r };
    });
    const rows = Object.entries(best).map(([uid, v]) => ({ uid: +uid, ...v })).sort((x, y) => y.points - x.points || y.ratio - x.ratio);
    let my = null;
    const top = [];
    rows.forEach((r, i) => {
      const u = byId(db.users, r.uid);
      if (r.uid === userId) my = i + 1;
      if (i < 10 && u) top.push({ rank: i + 1, name: u.first_name + ' ' + (u.last_name || '').slice(0, 1).toUpperCase() + '.', points: r.points, me: r.uid === userId });
    });
    return { top, my_rank: my, participants: rows.length };
  }

  function csvLine(cols) { return cols.map((c) => { let v = String(c ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'); }
  const slug = (s) => stripAccents(String(s).toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'quiz';
  const pad = (n) => String(n).padStart(2, '0');
  const dfmt = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  /* ---------------- Actions ---------------- */
  const A = {};

  A.session = (ctx) => {
    const u = currentUser(ctx);
    const s = ctx.db.settings;
    return { user: publicUser(ctx.db, u), csrf: 'demo', session_replaced: !!ctx.replaced, settings: { site_name: s.site_name, teacher_name: s.teacher_name, allow_registration: s.allow_registration }, server_ms: now() };
  };
  A.register = (ctx) => {
    const { db, data } = ctx;
    if (!db.settings.allow_registration) fail('Les inscriptions sont fermées. Demande à ta professeure.', 403, 'closed');
    const first = cleanName(str(data.first_name, 60));
    const last = cleanName(str(data.last_name, 60));
    const pw = typeof data.password === 'string' ? data.password : '';
    if (!validName(first) || !validName(last)) fail('Indique ton vrai prénom et ton vrai nom (lettres uniquement).');
    const pb = passwordProblem(pw, 'student', [first, last]);
    if (pb) fail(pb);
    const key = studentKey(first, last);
    if (db.users.some((u) => u.role === 'student' && u.login_key === key)) fail('Un compte existe déjà avec ce prénom et ce nom. Si c’est le tien, connecte-toi ; sinon préviens ta professeure.', 409, 'exists');
    const u = { id: ++db.seq.user, role: 'student', login_key: key, first_name: first, last_name: last, password_hash: hashPw(db, pw), class_id: null, status: db.settings.require_validation ? 'pending' : 'active', must_change_password: false, session_token: null, created_at: sec(), last_login_at: null };
    db.users.push(u);
    loginAs(ctx, u);
    return { user: publicUser(db, u), csrf: 'demo' };
  };
  A.login_student = (ctx) => {
    const { db, data } = ctx;
    const key = studentKey(cleanName(str(data.first_name, 60)), cleanName(str(data.last_name, 60)));
    throttle(db, 's:' + key);
    const u = db.users.find((x) => x.role === 'student' && x.login_key === key);
    if (!u || !checkPw(db, String(data.password || ''), u.password_hash)) { throttleFail(db, 's:' + key); ctx.commitOnError = true; fail('Prénom, nom ou mot de passe incorrect.', 401, 'bad_credentials'); }
    if (u.status === 'disabled') fail('Ce compte a été désactivé par ta professeure.', 403, 'disabled');
    throttleClear(db, 's:' + key);
    loginAs(ctx, u);
    return { user: publicUser(db, u), csrf: 'demo' };
  };
  A.login_teacher = (ctx) => {
    const { db, data } = ctx;
    const key = nameKey(str(data.username, 60));
    throttle(db, 't:' + key);
    const u = db.users.find((x) => x.role === 'teacher' && x.login_key === key);
    if (!u || !checkPw(db, String(data.password || ''), u.password_hash)) {
      throttleFail(db, 't:' + key);
      db.audit.push({ id: ++db.seq.audit, user_id: null, action: 'login_failed', detail: 'Identifiant : ' + key.slice(0, 40), ip: '127.0.0.1 (démo)', created_at: sec() });
      ctx.commitOnError = true;
      fail('Identifiant ou mot de passe incorrect.', 401, 'bad_credentials');
    }
    throttleClear(db, 't:' + key);
    loginAs(ctx, u);
    audit(ctx, 'login');
    return { user: publicUser(db, u), csrf: 'demo' };
  };
  A.logout = (ctx) => { const u = currentUser(ctx); if (u) u.session_token = null; delete ctx.sess.uid; delete ctx.sess.tok; return { csrf: 'demo' }; };
  A.change_password = (ctx) => {
    const { db, data } = ctx;
    const u = requireUser(ctx);
    if (!checkPw(db, String(data.current || ''), u.password_hash)) fail('Mot de passe actuel incorrect.', 400, 'bad_password');
    const pb = passwordProblem(String(data.new || ''), u.role, [u.first_name, u.last_name]);
    if (pb) fail(pb);
    u.password_hash = hashPw(db, String(data.new));
    u.must_change_password = false;
    loginAs(ctx, u);
    return { user: publicUser(db, u), csrf: 'demo' };
  };

  A.student_dashboard = (ctx) => {
    const { db } = ctx;
    const u = requireStudent(ctx, true);
    if (u.status !== 'active') return { pending: true, quizzes: [], history: [] };
    const quizzes = db.quizzes.filter((q) => canSee(db, q, u)).sort((a, b) => b.updated_at - a.updated_at).map((quiz) => {
      const count = quizQuestions(db, quiz.id).length;
      if (!count) return null;
      const atts = db.attempts.filter((a) => a.quiz_id === quiz.id && a.user_id === u.id && !a.is_preview).sort((a, b) => b.id - a.id);
      const running = atts.find((a) => a.status !== 'finished');
      const done = atts.filter((a) => a.status === 'finished');
      const vis = resultsVisible(quiz);
      return {
        id: quiz.id, title: quiz.title, description: quiz.description, level: quiz.level, chapter: quiz.chapter, question_count: quiz.pool_size > 0 ? Math.min(quiz.pool_size, count) : count,
        time_limit: quiz.time_limit, needs_code: !!quiz.access_code, window: quizWindow(quiz), opens_at: quiz.opens_at, closes_at: quiz.closes_at, max_attempts: quiz.max_attempts,
        attempts_used: done.length, running: running ? { attempt_id: running.id, status: running.status } : null,
        last: done[0] ? { attempt_id: done[0].id, visible: vis, note20: vis ? note20(done[0].score, done[0].max_score) : null } : null,
        require_fullscreen: quiz.require_fullscreen, feedback_mode: quiz.feedback_mode, max_exits: quiz.max_exits, exit_action: quiz.exit_action
      };
    }).filter(Boolean);
    const history = db.attempts.filter((a) => a.user_id === u.id && !a.is_preview && a.status === 'finished').sort((a, b) => b.finished_ms - a.finished_ms).map((a) => {
      const q = byId(db.quizzes, a.quiz_id);
      if (!q || q.status === 'draft') return null;
      const vis = resultsVisible(q);
      return { attempt_id: a.id, quiz_id: q.id, title: q.title, level: q.level, finished_ms: a.finished_ms, visible: vis, note20: vis ? note20(a.score, a.max_score) : null, zeroed: a.zeroed };
    }).filter(Boolean);
    return { pending: false, quizzes, history };
  };

  A.quiz_start = (ctx) => {
    const { db, data, sess } = ctx;
    const u = attemptUser(ctx);
    const preview = u.role === 'teacher';
    const quiz = quizOr404(db, data.quiz_id);
    if (!preview) {
      if (!canSee(db, quiz, u)) fail('Ce quiz n’est pas disponible.', 403, 'unavailable');
      const w = quizWindow(quiz);
      if (w === 'not_yet') fail('Ce quiz n’est pas encore ouvert.', 403, 'not_yet');
      if (w === 'ended') fail('Ce quiz est terminé.', 403, 'ended');
      if (bool(data.webdriver)) fail('Navigateur automatisé détecté. Utilise Safari, Chrome, Firefox ou Edge normalement.', 403, 'automation');
    }
    let a;
    if (preview) {
      const old = db.attempts.filter((x) => x.quiz_id === quiz.id && x.user_id === u.id && x.is_preview).map((x) => x.id);
      db.attempts = db.attempts.filter((x) => !old.includes(x.id));
      db.answers = db.answers.filter((x) => !old.includes(x.attempt_id));
      db.incidents = db.incidents.filter((x) => !old.includes(x.attempt_id));
      a = createAttempt(db, quiz, u, true, sess);
    } else {
      a = db.attempts.find((x) => x.quiz_id === quiz.id && x.user_id === u.id && !x.is_preview && x.status !== 'finished');
      if (a) { checkDevice(db, a, quiz, sess); sync(db, a, quiz); }
      else {
        if (db.attempts.filter((x) => x.quiz_id === quiz.id && x.user_id === u.id && !x.is_preview).length >= quiz.max_attempts) fail(quiz.max_attempts > 1 ? 'Tu as utilisé toutes tes tentatives pour ce quiz.' : 'Tu as déjà passé ce quiz.', 409, 'no_attempts_left');
        if (quiz.access_code) {
          const code = str(data.code, 20).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          if (!code) fail('Entre le code d’accès donné par ta professeure.', 400, 'code_required');
          throttle(db, 'code:' + u.id);
          if (code !== quiz.access_code) { throttleFail(db, 'code:' + u.id); ctx.commitOnError = true; fail('Code d’accès incorrect.', 403, 'bad_code'); }
        }
        a = createAttempt(db, quiz, u, false, sess);
        if (bool(data.multiscreen)) logIncident(db, a, 'multiscreen', 'Détecté au démarrage', null, false);
      }
    }
    a.last_seen_ms = now();
    return payload(db, a, quiz, u);
  };

  function withAttempt(ctx, fn) {
    const { db, data, sess } = ctx;
    const u = attemptUser(ctx);
    const a = byId(db.attempts, data.attempt_id);
    if (!a || a.user_id !== u.id) fail('Copie introuvable.', 404, 'not_found');
    const quiz = quizOr404(db, a.quiz_id);
    checkDevice(db, a, quiz, sess);
    sync(db, a, quiz);
    const out = fn(a, quiz, u);
    if (a.status !== 'finished') a.last_seen_ms = now();
    recompute(db, a);
    return out;
  }
  A.attempt_state = (ctx) => withAttempt(ctx, (a, quiz, u) => {
    if (bool(ctx.data.fresh) && a.status === 'in_progress' && a.q_started_ms !== null) registerExit(ctx.db, a, quiz, 'reload', null, null, 'reload-' + a.current_index + '-' + a.q_started_ms);
    if (bool(ctx.data.serve)) serve(a);
    return payload(ctx.db, a, quiz, u);
  });
  A.attempt_answer = (ctx) => withAttempt(ctx, (a, quiz, u) => {
    const { db, data } = ctx;
    if (a.status !== 'in_progress' || a.q_started_ms === null || int(data.index, -1) !== a.current_index) return { accepted: false, feedback: null, state: payload(db, a, quiz, u) };
    const q = curQ(db, a);
    const el = now() - a.q_started_ms;
    const late = q.time_limit > 0 && el > q.time_limit * 1000 + GRACE;
    const resp = data.response == null ? null : cleanResponse(q, data.response);
    const timeout = resp === null || late;
    const tMs = q.time_limit > 0 ? Math.min(el, q.time_limit * 1000) : el;
    const g = timeout ? ZERO : grade(q, resp, tMs, quiz.speed_bonus);
    storeAnswer(db, a, q, resp, timeout ? 'timeout' : 'answered', g, tMs);
    a.last_seen_ms = now();
    advance(db, a);
    recompute(db, a);
    const fb = { recorded: true, timeout };
    if (quiz.feedback_mode === 'immediate' || a.is_preview) Object.assign(fb, { fraction: g.fraction, correct: g.fraction >= 1, score: g.score, max: q.points, points_gained: g.points, streak: streak(db, a), type: q.type, response: resp, correction: correctionOf(q), explanation: q.explanation, question: publicQuestion(q, a.choice_orders) });
    return { accepted: true, feedback: fb, state: payload(db, a, quiz, u) };
  });
  A.attempt_event = (ctx) => {
    const type = str(ctx.data.type, 30);
    if (!CLIENT_INCIDENTS.includes(type)) fail('Évènement inconnu.');
    return withAttempt(ctx, (a, quiz, u) => {
      const { db, data } = ctx;
      const detail = str(data.detail, 200) || null;
      const dur = data.duration_ms != null && !isNaN(+data.duration_ms) ? Math.max(0, Math.min(+data.duration_ms, 86400000)) : null;
      const k = str(data.exit_key, 40);
      const key = /^[A-Za-z0-9-]{4,40}$/.test(k) ? 'c-' + k : null;
      let r = { action: null };
      if (EXIT_TYPES.includes(type)) r = registerExit(db, a, quiz, type, detail, dur, key);
      else if (a.status !== 'finished') logIncident(db, a, type, detail, null, false);
      return { action: r.action, cancelled: !!r.cancelled, state: payload(db, a, quiz, u) };
    });
  };
  A.attempt_heartbeat = (ctx) => withAttempt(ctx, (a, quiz, u) => {
    const { db, data } = ctx;
    const k = str(data.away_key, 40);
    const away = Math.max(0, int(data.away_ms, 0));
    if (a.status === 'in_progress' && /^[A-Za-z0-9-]{4,40}$/.test(k)) {
      if (data.vis === 'hidden') registerExit(db, a, quiz, 'hb_hidden', null, away || null, 'c-' + k);
      else if (!bool(data.focus) && away >= 1500) registerExit(db, a, quiz, 'hb_blur', null, away, 'c-' + k);
    }
    return payload(db, a, quiz, u);
  });
  A.attempt_ack_warning = (ctx) => withAttempt(ctx, (a, quiz, u) => {
    if (a.warning_text !== null) { logIncident(ctx.db, a, 'warning_ack', a.warning_text.slice(0, 120), null, false); a.warning_text = null; }
    return payload(ctx.db, a, quiz, u);
  });
  A.attempt_preview_unlock = (ctx) => {
    requireTeacher(ctx);
    return withAttempt(ctx, (a, quiz, u) => { if (a.is_preview && a.status === 'locked') { a.status = 'in_progress'; a.lock_reason = null; } return payload(ctx.db, a, quiz, u); });
  };
  A.attempt_result = (ctx) => {
    const { db, data } = ctx;
    const u = attemptUser(ctx);
    const a = byId(db.attempts, data.attempt_id);
    if (!a || a.user_id !== u.id) fail('Copie introuvable.', 404, 'not_found');
    const quiz = quizOr404(db, a.quiz_id);
    if (a.status !== 'finished') fail('Ce quiz n’est pas terminé.', 409, 'not_finished');
    if (!a.is_preview && !resultsVisible(quiz)) fail('Les résultats n’ont pas encore été publiés par ta professeure.', 403, 'not_released');
    recompute(db, a);
    return {
      quiz: { id: quiz.id, title: quiz.title, level: quiz.level, show_leaderboard: quiz.show_leaderboard },
      attempt: { id: a.id, score: a.score, max_score: a.max_score, note20: note20(a.score, a.max_score), points: a.points, zeroed: a.zeroed, finish_reason: a.finish_reason, started_ms: a.started_ms, finished_ms: a.finished_ms, exits: a.exits, is_preview: a.is_preview },
      rank: !a.is_preview && quiz.show_leaderboard ? leaderboardData(db, quiz, u.id).my_rank : null,
      items: corrections(db, a)
    };
  };
  A.leaderboard = (ctx) => {
    const { db, data } = ctx;
    const u = requireStudent(ctx);
    const quiz = quizOr404(db, data.quiz_id);
    if (!quiz.show_leaderboard || !resultsVisible(quiz) || quiz.status === 'draft') fail('Le classement n’est pas disponible pour ce quiz.', 403, 'unavailable');
    if (!db.attempts.some((a) => a.quiz_id === quiz.id && a.user_id === u.id && !a.is_preview && a.status === 'finished')) fail('Termine le quiz pour voir le classement.', 403, 'not_played');
    return { quiz: { id: quiz.id, title: quiz.title }, ...leaderboardData(db, quiz, u.id) };
  };

  /* ----- Teacher ----- */
  A.t_overview = (ctx) => {
    const { db } = ctx;
    sweep(db);
    const real = db.attempts.filter((a) => !a.is_preview);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const studs = db.users.filter((u) => u.role === 'student');
    return {
      stats: {
        students: studs.filter((u) => u.status === 'active').length, pending: studs.filter((u) => u.status === 'pending').length,
        quizzes_open: db.quizzes.filter((q) => q.status === 'open').length, quizzes_total: db.quizzes.filter((q) => q.status !== 'archived').length,
        live: real.filter((a) => a.status === 'in_progress').length, locked: real.filter((a) => a.status === 'locked').length,
        finished_today: real.filter((a) => a.status === 'finished' && a.finished_ms >= today.getTime()).length
      },
      pending_students: studs.filter((u) => u.status === 'pending').sort((a, b) => b.created_at - a.created_at).map((u) => ({ id: u.id, name: display(u), created_at: u.created_at })),
      recent: real.filter((a) => a.status === 'finished').sort((a, b) => b.finished_ms - a.finished_ms).slice(0, 8).map((a) => ({ attempt_id: a.id, name: display(byId(db.users, a.user_id)), quiz: byId(db.quizzes, a.quiz_id).title, note20: note20(a.score, a.max_score), finished_ms: a.finished_ms, exits: a.exits, zeroed: a.zeroed })),
      alerts: db.incidents.filter((i) => i.counted && real.some((a) => a.id === i.attempt_id)).sort((a, b) => b.id - a.id).slice(0, 8).map((i) => { const a = byId(db.attempts, i.attempt_id); return { ...incRow(i), name: display(byId(db.users, a.user_id)), quiz: byId(db.quizzes, a.quiz_id).title, quiz_id: a.quiz_id, attempt_id: a.id }; })
    };
  };
  A.t_alerts = (ctx) => {
    const { db, data } = ctx;
    sweep(db);
    const since = data.since === undefined ? -1 : int(data.since, -1);
    const real = db.attempts.filter((a) => !a.is_preview);
    const alerts = since < 0 ? [] : db.incidents.filter((i) => i.id > since && (i.counted || ['ai_extension', 'devtools', 'tamper', 'automation', 'device'].includes(i.type)) && real.some((a) => a.id === i.attempt_id)).slice(0, 30).map((i) => {
      const a = byId(db.attempts, i.attempt_id);
      return { ...incRow(i), name: display(byId(db.users, a.user_id)), quiz: byId(db.quizzes, a.quiz_id).title, quiz_id: a.quiz_id, attempt_id: a.id, attempt_status: a.status };
    });
    return { last_id: db.seq.incident, alerts, live: real.filter((a) => a.status === 'in_progress').length, locked: real.filter((a) => a.status === 'locked').length, pending: db.users.filter((u) => u.role === 'student' && u.status === 'pending').length };
  };
  A.t_live = (ctx) => {
    const { db, data } = ctx;
    const running = (q) => db.attempts.filter((a) => a.quiz_id === q.id && !a.is_preview && a.status !== 'finished').length;
    const quizzes = db.quizzes.filter((q) => q.status === 'open' || q.status === 'closed').sort((a, b) => (b.status === 'open') - (a.status === 'open') || running(b) - running(a) || b.updated_at - a.updated_at);
    let quizId = int(data.quiz_id, 0);
    if (!quizId && quizzes.length) quizId = quizzes[0].id;
    const out = { quizzes: quizzes.map((q) => ({ id: q.id, title: q.title, level: q.level, status: q.status, running: running(q) })), quiz: null, server_ms: now() };
    if (!quizId) return out;
    sweep(db, quizId);
    const quiz = quizOr404(db, quizId);
    const qs = quizQuestions(db, quizId);
    const qInfo = {};
    qs.forEach((q, i) => { qInfo[q.id] = { n: i + 1, prompt: q.prompt.slice(0, 140), time_limit: q.time_limit }; });
    const t = now();
    const atts = db.attempts.filter((a) => a.quiz_id === quizId && !a.is_preview).map((a) => ({ a, u: byId(db.users, a.user_id) })).filter((x) => x.u).sort((x, y) => (x.u.last_name + x.u.first_name).localeCompare(y.u.last_name + y.u.first_name));
    out.attempts = atts.map(({ a, u }) => {
      recompute(db, a);
      const cq = a.question_ids[a.current_index];
      const c = u.class_id ? byId(db.classes, u.class_id) : null;
      return {
        id: a.id, user_id: u.id, name: display(u), class_name: c ? c.name : null, attempt_no: a.attempt_no, status: a.status, finish_reason: a.finish_reason, lock_reason: a.lock_reason,
        index: a.current_index, total: a.question_ids.length, current_q: a.status === 'in_progress' && cq && a.q_started_ms !== null ? (qInfo[cq] || {}).n || null : null,
        q_elapsed_ms: a.q_started_ms !== null ? t - a.q_started_ms : null, q_limit_ms: cq && qInfo[cq] ? qInfo[cq].time_limit * 1000 : null,
        exits: a.exits, incidents: a.incidents, away_ms: a.away_ms, device: a.device, ip: a.ip, started_ms: a.started_ms, finished_ms: a.finished_ms,
        last_seen_ago_ms: t - a.last_seen_ms, online: a.status !== 'finished' && t - a.last_seen_ms < 7000, score: a.score, max_score: a.max_score, note20: note20(a.score, a.max_score),
        points: a.points, zeroed: a.zeroed, warning_pending: a.warning_text !== null,
        answers: db.answers.filter((x) => x.attempt_id === a.id).sort((p, q) => p.position - q.position).map((x) => ({ pos: x.position, qid: x.question_id, status: x.status, fraction: x.fraction, time_ms: x.time_ms, n: (qInfo[x.question_id] || {}).n || null }))
      };
    });
    const cls = quizClassIds(db, quizId);
    out.not_started = db.users.filter((u) => u.role === 'student' && u.status === 'active' && (!cls.length || cls.includes(u.class_id)) && !db.attempts.some((a) => a.user_id === u.id && a.quiz_id === quizId && !a.is_preview))
      .map((u) => ({ id: u.id, name: display(u), class_name: u.class_id ? (byId(db.classes, u.class_id) || {}).name : null, last_login_at: u.last_login_at }));
    const since = int(data.since, 0);
    const ids = new Set(atts.map((x) => x.a.id));
    out.incidents = db.incidents.filter((i) => ids.has(i.attempt_id) && i.id > since).sort((a, b) => b.id - a.id).slice(0, 80).map((i) => { const a = byId(db.attempts, i.attempt_id); return { ...incRow(i), attempt_id: a.id, name: display(byId(db.users, a.user_id)), attempt_status: a.status }; });
    out.quiz = { id: quiz.id, title: quiz.title, level: quiz.level, status: quiz.status, access_code: quiz.access_code, results_released: quiz.results_released, feedback_mode: quiz.feedback_mode, question_count: qs.length, max_exits: quiz.max_exits, exit_action: quiz.exit_action, questions: qs.map((q) => ({ id: q.id, ...qInfo[q.id] })) };
    out.last_incident_id = db.seq.incident;
    return out;
  };
  A.t_attempt_action = (ctx) => {
    const { db, data } = ctx;
    const act = str(data.action, 20);
    if (!['unlock', 'lock', 'warn', 'finish', 'exclude', 'unzero', 'reset'].includes(act)) fail('Action inconnue.');
    const a = byId(db.attempts, data.attempt_id) || fail('Copie introuvable.', 404);
    const quiz = quizOr404(db, a.quiz_id);
    const who = display(byId(db.users, a.user_id)) + ' — ' + quiz.title;
    if (act === 'unlock' && a.status === 'locked') { a.status = 'in_progress'; a.lock_reason = null; a.last_seen_ms = now(); logIncident(db, a, 'teacher', 'Quiz débloqué par la professeure', null, false); }
    if (act === 'lock' && a.status === 'in_progress') { cancelCurrent(db, a); if (a.status === 'in_progress') { a.status = 'locked'; a.lock_reason = 'Mis en pause par la professeure'; } logIncident(db, a, 'teacher', 'Quiz verrouillé par la professeure', null, false); }
    if (act === 'warn') {
      if (a.status === 'finished') fail('Cette copie est déjà terminée.');
      const msg = str(data.message, 300) || 'Attention : ton comportement est surveillé. Reste sur le quiz, sinon ta copie sera annulée.';
      a.warning_text = msg; a.warning_ms = now();
      logIncident(db, a, 'teacher', 'Avertissement envoyé : ' + msg, null, false);
    }
    if (act === 'finish') { finishAttempt(db, a, 'teacher'); logIncident(db, a, 'teacher', 'Copie terminée par la professeure', null, false); }
    if (act === 'exclude') { finishAttempt(db, a, 'excluded'); a.zeroed = true; logIncident(db, a, 'teacher', 'Élève exclu du quiz (note 0/20)', null, false); }
    if (act === 'unzero') { a.zeroed = false; logIncident(db, a, 'teacher', 'Note rétablie par la professeure', null, false); }
    if (act === 'reset') {
      db.attempts = db.attempts.filter((x) => x.id !== a.id);
      db.answers = db.answers.filter((x) => x.attempt_id !== a.id);
      db.incidents = db.incidents.filter((x) => x.attempt_id !== a.id);
      audit(ctx, 'attempt_reset', who);
      return { deleted: true };
    }
    recompute(db, a);
    audit(ctx, 'attempt_' + act, who);
    return { deleted: false, status: a.status, zeroed: a.zeroed };
  };
  A.t_live_broadcast = (ctx) => {
    const { db, data } = ctx;
    const quiz = quizOr404(db, data.quiz_id);
    const msg = str(data.message, 300);
    if (!msg) fail('Écris un message.');
    let n = 0;
    db.attempts.filter((a) => a.quiz_id === quiz.id && !a.is_preview && a.status !== 'finished').forEach((a) => { a.warning_text = msg; a.warning_ms = now(); logIncident(db, a, 'teacher', 'Message à toute la classe : ' + msg, null, false); n++; });
    audit(ctx, 'broadcast', quiz.title + ' : ' + msg);
    return { sent: n };
  };
  A.t_quiz_end_all = (ctx) => {
    const { db, data } = ctx;
    const quiz = quizOr404(db, data.quiz_id);
    let n = 0;
    db.attempts.filter((a) => a.quiz_id === quiz.id && !a.is_preview && a.status !== 'finished').forEach((a) => { finishAttempt(db, a, 'teacher'); logIncident(db, a, 'teacher', 'Quiz terminé pour toute la classe', null, false); recompute(db, a); n++; });
    if (bool(data.close)) { quiz.status = 'closed'; quiz.updated_at = sec(); }
    audit(ctx, 'quiz_end_all', quiz.title + ` (${n} copies)`);
    return { finished: n };
  };
  A.t_quizzes = (ctx) => {
    const { db } = ctx;
    const order = { open: 0, draft: 1, closed: 2, archived: 3 };
    return {
      quizzes: db.quizzes.slice().sort((a, b) => order[a.status] - order[b.status] || b.updated_at - a.updated_at).map((q) => {
        const fin = db.attempts.filter((a) => a.quiz_id === q.id && !a.is_preview && a.status === 'finished');
        fin.forEach((a) => recompute(db, a));
        const notes = fin.filter((a) => a.max_score > 0).map((a) => (a.score / a.max_score) * 20);
        return {
          id: q.id, title: q.title, description: q.description, level: q.level, chapter: q.chapter, status: q.status, access_code: q.access_code, opens_at: q.opens_at, closes_at: q.closes_at,
          feedback_mode: q.feedback_mode, results_released: q.results_released, question_count: quizQuestions(db, q.id).length, finished_count: fin.length,
          running_count: db.attempts.filter((a) => a.quiz_id === q.id && !a.is_preview && a.status !== 'finished').length,
          avg20: notes.length ? round2(notes.reduce((s, x) => s + x, 0) / notes.length) : null,
          classes: quizClassIds(db, q.id).map((id) => (byId(db.classes, id) || {}).name).filter(Boolean).sort(), updated_at: q.updated_at
        };
      })
    };
  };
  function quizForEditor(db, id) {
    const q = clone(quizOr404(db, id));
    q.class_ids = quizClassIds(db, id);
    q.questions = clone(quizQuestions(db, id));
    q.attempt_count = db.attempts.filter((a) => a.quiz_id === id && !a.is_preview).length;
    return q;
  }
  A.t_quiz_get = (ctx) => ({ quiz: quizForEditor(ctx.db, int(ctx.data.quiz_id)), classes: classesList(ctx.db) });
  A.t_quiz_save = (ctx) => {
    const { db, data } = ctx;
    const v = validateQuiz(data);
    let id = int(data.id, 0);
    if (id) {
      const q = quizOr404(db, id);
      const speedChanged = q.speed_bonus !== v.speed_bonus;
      Object.assign(q, v, { updated_at: sec() });
      if (speedChanged) quizQuestions(db, id).forEach((qq) => regrade(db, qq, q.speed_bonus));
      audit(ctx, 'quiz_update', v.title);
    } else {
      id = ++db.seq.quiz;
      db.quizzes.push({ id, ...v, status: 'draft', results_released: false, created_at: sec(), updated_at: sec() });
      audit(ctx, 'quiz_create', v.title);
    }
    db.quiz_classes = db.quiz_classes.filter((x) => x.quiz_id !== id);
    Array.from(new Set((Array.isArray(data.class_ids) ? data.class_ids : []).map(Number))).forEach((cid) => { if (byId(db.classes, cid)) db.quiz_classes.push({ quiz_id: id, class_id: cid }); });
    return { quiz: quizForEditor(db, id) };
  };
  function regrade(db, q, speed) {
    const touched = new Set();
    db.answers.filter((x) => x.question_id === q.id).forEach((x) => {
      touched.add(x.attempt_id);
      if (x.status !== 'answered') return;
      const g = grade(q, x.response, x.time_ms, speed);
      Object.assign(x, { fraction: g.fraction, score: g.score, points: g.points });
    });
    touched.forEach((id) => { const a = byId(db.attempts, id); if (a) recompute(db, a); });
  }
  A.t_quiz_status = (ctx) => {
    const { db, data } = ctx;
    const q = quizOr404(db, data.quiz_id);
    const st = str(data.status, 20);
    if (!['draft', 'open', 'closed', 'archived'].includes(st)) fail('Statut invalide.');
    if (st === 'open' && !quizQuestions(db, q.id).length) fail('Ajoute au moins une question avant d’ouvrir le quiz.');
    q.status = st; q.updated_at = sec();
    audit(ctx, 'quiz_status', q.title + ' → ' + st);
    return { status: st };
  };
  A.t_quiz_release = (ctx) => {
    const q = quizOr404(ctx.db, ctx.data.quiz_id);
    q.results_released = bool(ctx.data.released); q.updated_at = sec();
    audit(ctx, q.results_released ? 'results_released' : 'results_hidden', q.title);
    return { results_released: q.results_released };
  };
  A.t_quiz_delete = (ctx) => {
    const { db } = ctx;
    const q = quizOr404(db, ctx.data.quiz_id);
    const att = db.attempts.filter((a) => a.quiz_id === q.id).map((a) => a.id);
    const qids = quizQuestions(db, q.id).map((x) => x.id);
    db.quizzes = db.quizzes.filter((x) => x.id !== q.id);
    db.questions = db.questions.filter((x) => x.quiz_id !== q.id);
    db.quiz_classes = db.quiz_classes.filter((x) => x.quiz_id !== q.id);
    db.attempts = db.attempts.filter((x) => x.quiz_id !== q.id);
    db.answers = db.answers.filter((x) => !att.includes(x.attempt_id) && !qids.includes(x.question_id));
    db.incidents = db.incidents.filter((x) => !att.includes(x.attempt_id));
    audit(ctx, 'quiz_delete', q.title);
    return { deleted: true };
  };
  A.t_quiz_duplicate = (ctx) => {
    const { db } = ctx;
    const src = quizOr404(db, ctx.data.quiz_id);
    const id = ++db.seq.quiz;
    db.quizzes.push({ ...clone(src), id, title: ('Copie de ' + src.title).slice(0, 200), status: 'draft', results_released: false, created_at: sec(), updated_at: sec() });
    quizQuestions(db, src.id).forEach((q) => db.questions.push({ ...clone(q), id: ++db.seq.question, quiz_id: id }));
    quizClassIds(db, src.id).forEach((cid) => db.quiz_classes.push({ quiz_id: id, class_id: cid }));
    audit(ctx, 'quiz_duplicate', src.title);
    return { id };
  };
  A.t_question_save = (ctx) => {
    const { db, data } = ctx;
    const quiz = quizOr404(db, data.quiz_id);
    const v = validateQuestion(data);
    const id = int(data.id, 0);
    let q;
    if (id) {
      q = db.questions.find((x) => x.id === id && x.quiz_id === quiz.id) || fail('Question introuvable.', 404);
      Object.assign(q, v);
      regrade(db, q, quiz.speed_bonus);
    } else {
      const pos = quizQuestions(db, quiz.id).reduce((m, x) => Math.max(m, x.position), -1) + 1;
      q = { id: ++db.seq.question, quiz_id: quiz.id, position: pos, ...v };
      db.questions.push(q);
    }
    quiz.updated_at = sec();
    return { question: clone(q) };
  };
  A.t_question_delete = (ctx) => {
    const { db } = ctx;
    const q = byId(db.questions, ctx.data.question_id) || fail('Question introuvable.', 404);
    db.questions = db.questions.filter((x) => x.id !== q.id);
    db.answers = db.answers.filter((x) => x.question_id !== q.id);
    db.attempts.filter((a) => a.quiz_id === q.quiz_id).forEach((a) => recompute(db, a));
    return { deleted: true };
  };
  A.t_question_duplicate = (ctx) => {
    const { db } = ctx;
    const q = byId(db.questions, ctx.data.question_id) || fail('Question introuvable.', 404);
    db.questions.filter((x) => x.quiz_id === q.quiz_id && x.position > q.position).forEach((x) => { x.position++; });
    const n = { ...clone(q), id: ++db.seq.question, position: q.position + 1 };
    db.questions.push(n);
    return { question: clone(n) };
  };
  A.t_question_reorder = (ctx) => {
    const { db, data } = ctx;
    const quiz = quizOr404(db, data.quiz_id);
    const ids = (Array.isArray(data.ids) ? data.ids : []).map(Number);
    const existing = quizQuestions(db, quiz.id).map((q) => q.id);
    if (ids.slice().sort((a, b) => a - b).join() !== existing.slice().sort((a, b) => a - b).join()) fail('Liste de questions invalide.');
    ids.forEach((id, pos) => { byId(db.questions, id).position = pos; });
    return { ok: true };
  };
  A.t_import = (ctx) => {
    const { db, data } = ctx;
    const quiz = quizOr404(db, data.quiz_id);
    const [parsed, errors] = parseAiken(str(data.text, 200000));
    const time = Math.max(0, Math.min(3600, int(data.time_limit, 30)));
    const pts = Math.max(0, Math.min(100, parseFloat(data.points) || 1));
    let pos = quizQuestions(db, quiz.id).reduce((m, x) => Math.max(m, x.position), -1) + 1;
    let created = 0;
    parsed.forEach((p, i) => {
      try {
        const v = validateQuestion({ ...p, time_limit: time, points: pts, partial: true });
        db.questions.push({ id: ++db.seq.question, quiz_id: quiz.id, position: pos++, ...v });
        created++;
      } catch (e) { errors.push('Question ' + (i + 1) + ' : ' + e.message); }
    });
    quiz.updated_at = sec();
    return { created, errors };
  };
  A.t_quiz_export_json = (ctx) => {
    const q = quizOr404(ctx.db, ctx.data.quiz_id);
    const exp = { format: 'quiz-ses/1', title: q.title, description: q.description, level: q.level, chapter: q.chapter, questions: quizQuestions(ctx.db, q.id).map((x) => ({ type: x.type, prompt: x.prompt, data: x.data, points: x.points, time_limit: x.time_limit, partial: x.partial, explanation: x.explanation })) };
    return { filename: 'quiz-' + slug(q.title) + '.json', content: JSON.stringify(exp, null, 2) };
  };
  A.t_quiz_import_json = (ctx) => {
    const { db } = ctx;
    let src;
    try { src = JSON.parse(str(ctx.data.json, 2000000)); } catch (e) { src = null; }
    if (!src || src.format !== 'quiz-ses/1' || !Array.isArray(src.questions)) fail('Fichier de quiz invalide.');
    const v = validateQuiz({ title: src.title || 'Quiz importé', description: src.description || '', level: src.level || 'Autre', chapter: src.chapter || '', max_attempts: 1, shuffle_questions: true, shuffle_choices: true, feedback_mode: 'release', show_leaderboard: true, speed_bonus: true, require_fullscreen: true, exit_action: 'lock' });
    const id = ++db.seq.quiz;
    const qs = src.questions.map((q) => validateQuestion({ ...q, image: null }));
    db.quizzes.push({ id, ...v, status: 'draft', results_released: false, created_at: sec(), updated_at: sec() });
    qs.forEach((q, pos) => db.questions.push({ id: ++db.seq.question, quiz_id: id, position: pos, ...q }));
    audit(ctx, 'quiz_import', v.title);
    return { id };
  };
  A.t_upload = (ctx) => {
    const f = ctx.data.file;
    if (typeof f !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(f) || f.length > 1500000) fail('Image invalide ou trop lourde.');
    return { file: f };
  };
  A.t_results = (ctx) => {
    const { db, data } = ctx;
    const quiz = quizOr404(db, data.quiz_id);
    sweep(db, quiz.id);
    const classId = int(data.class_id, 0);
    const qs = quizQuestions(db, quiz.id);
    const atts = db.attempts.filter((a) => a.quiz_id === quiz.id && !a.is_preview).map((a) => ({ a, u: byId(db.users, a.user_id) })).filter((x) => x.u && (!classId || x.u.class_id === classId))
      .sort((x, y) => (x.u.last_name + x.u.first_name).localeCompare(y.u.last_name + y.u.first_name) || x.a.attempt_no - y.a.attempt_no);
    const best = {};
    const finishedIds = new Set();
    const list = atts.map(({ a, u }) => {
      recompute(db, a);
      const n = note20(a.score, a.max_score);
      if (a.status === 'finished') { finishedIds.add(a.id); if (n !== null && (best[u.id] === undefined || n > best[u.id])) best[u.id] = n; }
      return {
        id: a.id, user_id: u.id, name: display(u), first_name: u.first_name, last_name: u.last_name, class_name: u.class_id ? (byId(db.classes, u.class_id) || {}).name : null, attempt_no: a.attempt_no,
        status: a.status, finish_reason: a.finish_reason, score: a.score, max_score: a.max_score, note20: n, points: a.points, zeroed: a.zeroed, exits: a.exits, incidents: a.incidents,
        away_ms: a.away_ms, device: a.device, started_ms: a.started_ms, finished_ms: a.finished_ms, duration_ms: a.finished_ms ? a.finished_ms - a.started_ms : null
      };
    });
    const notes = Object.values(best);
    let stats = null;
    if (notes.length) {
      const mean = notes.reduce((s, x) => s + x, 0) / notes.length;
      const sorted = notes.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const hist = Array(10).fill(0);
      notes.forEach((x) => { hist[Math.min(9, Math.floor(x / 2))]++; });
      stats = {
        count: notes.length, mean: round2(mean), median: round2(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2), min: round2(sorted[0]), max: round2(sorted[sorted.length - 1]),
        stddev: round2(Math.sqrt(notes.reduce((s, x) => s + (x - mean) ** 2, 0) / notes.length)), pass_rate: Math.round((notes.filter((x) => x >= 10).length / notes.length) * 100), histogram: hist
      };
    }
    const questions = qs.map((q, i) => {
      const ans = db.answers.filter((x) => x.question_id === q.id && finishedIds.has(x.attempt_id));
      const answered = ans.filter((x) => x.status === 'answered');
      const times = answered.map((x) => x.time_ms).filter((t) => t !== null);
      const dist = {};
      const wrong = {};
      answered.forEach((x) => {
        const r = x.response || {};
        if (q.type === 'single' && r.choice) dist[r.choice] = (dist[r.choice] || 0) + 1;
        else if (q.type === 'multiple') (r.choices || []).forEach((c) => { dist[c] = (dist[c] || 0) + 1; });
        else if (q.type === 'truefalse' && r.value !== null && r.value !== undefined) { const k = r.value ? 'true' : 'false'; dist[k] = (dist[k] || 0) + 1; }
        else if ((q.type === 'short' || q.type === 'numeric') && x.fraction < 1) { const t = String(r.text || '').trim().slice(0, 60); if (t) wrong[t] = (wrong[t] || 0) + 1; }
      });
      return {
        id: q.id, n: i + 1, type: q.type, prompt: q.prompt, points: q.points, served: ans.length, answered: answered.length,
        timeouts: ans.filter((x) => x.status === 'timeout').length, cancelled: ans.filter((x) => x.status === 'cancelled').length,
        success: ans.length ? Math.round((ans.reduce((s, x) => s + x.fraction, 0) / ans.length) * 100) : null,
        avg_time_ms: times.length ? Math.round(times.reduce((s, x) => s + x, 0) / times.length) : null, distribution: dist,
        wrong_answers: Object.entries(wrong).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([text, count]) => ({ text, count })), correction: correctionOf(q)
      };
    });
    return {
      quiz: { id: quiz.id, title: quiz.title, level: quiz.level, status: quiz.status, results_released: quiz.results_released, feedback_mode: quiz.feedback_mode, show_leaderboard: quiz.show_leaderboard },
      classes: classesList(db), class_id: classId || null, attempts: list, stats, questions, leaderboard: quiz.show_leaderboard ? leaderboardData(db, quiz, null).top : []
    };
  };
  A.t_attempt = (ctx) => {
    const { db } = ctx;
    const a = byId(db.attempts, ctx.data.attempt_id) || fail('Copie introuvable.', 404);
    const u = byId(db.users, a.user_id);
    const quiz = quizOr404(db, a.quiz_id);
    recompute(db, a);
    return {
      attempt: { id: a.id, status: a.status, finish_reason: a.finish_reason, lock_reason: a.lock_reason, attempt_no: a.attempt_no, score: a.score, max_score: a.max_score, note20: note20(a.score, a.max_score), points: a.points, zeroed: a.zeroed, exits: a.exits, incidents: a.incidents, away_ms: a.away_ms, started_ms: a.started_ms, finished_ms: a.finished_ms, device: a.device, ip: a.ip, user_agent: a.user_agent, index: a.current_index, total: a.question_ids.length },
      student: { id: u.id, name: display(u), class_name: u.class_id ? (byId(db.classes, u.class_id) || {}).name : null },
      quiz: { id: quiz.id, title: quiz.title, level: quiz.level },
      items: corrections(db, a),
      incidents: db.incidents.filter((i) => i.attempt_id === a.id).sort((x, y) => x.created_ms - y.created_ms || x.id - y.id).map(incRow)
    };
  };
  A.t_answer_override = (ctx) => {
    const { db, data } = ctx;
    const ans = byId(db.answers, data.answer_id) || fail('Réponse introuvable.', 404);
    const q = byId(db.questions, ans.question_id);
    let v = null;
    if (data.score !== null && data.score !== '' && data.score !== undefined) {
      v = round2(parseFloat(String(data.score).replace(',', '.')));
      if (isNaN(v) || v < 0 || v > q.points) fail('La note doit être comprise entre 0 et ' + q.points + '.');
    }
    ans.override_score = v;
    recompute(db, byId(db.attempts, ans.attempt_id));
    audit(ctx, 'answer_override', 'Copie #' + ans.attempt_id + ' : ' + (v === null ? 'note automatique' : v));
    return { ok: true };
  };
  A.t_export = (ctx) => {
    const { db } = ctx;
    const quiz = quizOr404(db, ctx.data.quiz_id);
    const st = { in_progress: 'En cours', locked: 'Verrouillé', finished: 'Terminé' };
    const rs = { completed: 'Terminé', timeout: 'Temps écoulé', exits: 'Sorties', teacher: 'Arrêté par la professeure', excluded: 'Exclu' };
    const lines = [csvLine(['Nom', 'Prénom', 'Classe', 'Tentative', 'Statut', 'Fin', 'Note /20', 'Score', 'Barème', 'Points', 'Durée (min)', 'Sorties', 'Incidents', 'Temps hors quiz (s)', 'Appareil', 'Début', 'Fin'])];
    db.attempts.filter((a) => a.quiz_id === quiz.id && !a.is_preview).forEach((a) => {
      const u = byId(db.users, a.user_id);
      recompute(db, a);
      const n = note20(a.score, a.max_score);
      lines.push(csvLine([u.last_name.toUpperCase(), u.first_name, u.class_id ? (byId(db.classes, u.class_id) || {}).name : '', a.attempt_no, st[a.status], rs[a.finish_reason] || '', n === null ? '' : String(n).replace('.', ','), String(a.score).replace('.', ','), String(a.max_score).replace('.', ','), a.points, a.finished_ms ? String(round2((a.finished_ms - a.started_ms) / 60000)).replace('.', ',') : '', a.exits, a.incidents, Math.round(a.away_ms / 1000), a.device, dfmt(a.started_ms), a.finished_ms ? dfmt(a.finished_ms) : '']));
    });
    return { filename: 'resultats-' + slug(quiz.title) + '.csv', content: lines.join('\n') };
  };
  A.t_students = (ctx) => {
    const { db } = ctx;
    const order = { pending: 0, active: 1, disabled: 2 };
    return {
      students: db.users.filter((u) => u.role === 'student').map((u) => {
        const fin = db.attempts.filter((a) => a.user_id === u.id && !a.is_preview && a.status === 'finished');
        const notes = fin.filter((a) => a.max_score > 0).map((a) => (a.score / a.max_score) * 20);
        const c = u.class_id ? byId(db.classes, u.class_id) : null;
        return { id: u.id, first_name: u.first_name, last_name: u.last_name, name: display(u), status: u.status, class_id: u.class_id, class_name: c ? c.name : null, created_at: u.created_at, last_login_at: u.last_login_at, must_change_password: !!u.must_change_password, finished: fin.length, avg20: notes.length ? round2(notes.reduce((s, x) => s + x, 0) / notes.length) : null, exits: db.attempts.filter((a) => a.user_id === u.id && !a.is_preview).reduce((s, a) => s + a.exits, 0) };
      }).sort((a, b) => order[a.status] - order[b.status] || (a.class_name || '').localeCompare(b.class_name || '') || a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)),
      classes: classesList(db)
    };
  };
  A.t_student = (ctx) => {
    const { db } = ctx;
    const u = db.users.find((x) => x.id === int(ctx.data.student_id) && x.role === 'student') || fail('Élève introuvable.', 404);
    return {
      student: { ...publicUser(db, u), name: display(u), created_at: u.created_at, last_login_at: u.last_login_at },
      attempts: db.attempts.filter((a) => a.user_id === u.id && !a.is_preview).sort((a, b) => b.started_ms - a.started_ms).map((a) => { recompute(db, a); const q = byId(db.quizzes, a.quiz_id); return { id: a.id, quiz_id: q.id, title: q.title, attempt_no: a.attempt_no, status: a.status, finish_reason: a.finish_reason, note20: note20(a.score, a.max_score), zeroed: a.zeroed, exits: a.exits, incidents: a.incidents, started_ms: a.started_ms, finished_ms: a.finished_ms }; }),
      classes: classesList(db)
    };
  };
  A.t_student_action = (ctx) => {
    const { db, data } = ctx;
    const u = db.users.find((x) => x.id === int(data.student_id) && x.role === 'student') || fail('Élève introuvable.', 404);
    const act = str(data.action, 20);
    const name = display(u);
    if (act === 'validate' || act === 'enable') u.status = 'active';
    else if (act === 'disable') { u.status = 'disabled'; u.session_token = null; }
    else if (act === 'class') { const cid = int(data.class_id, 0); if (cid && !byId(db.classes, cid)) fail('Classe introuvable.'); u.class_id = cid || null; }
    else if (act === 'rename') {
      const f = cleanName(str(data.first_name, 60)); const l = cleanName(str(data.last_name, 60));
      if (!validName(f) || !validName(l)) fail('Prénom ou nom invalide.');
      const key = studentKey(f, l);
      if (db.users.some((x) => x.role === 'student' && x.login_key === key && x.id !== u.id)) fail('Un autre élève porte déjà ce nom.');
      Object.assign(u, { first_name: f, last_name: l, login_key: key });
    } else if (act === 'reset_password') {
      const words = ['pib', 'eco', 'euro', 'marche', 'socio', 'budget', 'bourse', 'credit', 'emploi', 'capital'];
      const temp = words[rnd(words.length)] + '-' + (1000 + rnd(9000));
      Object.assign(u, { password_hash: hashPw(db, temp), must_change_password: true, session_token: null });
      audit(ctx, 'student_password_reset', name);
      return { temp_password: temp };
    } else if (act === 'delete') {
      const att = db.attempts.filter((a) => a.user_id === u.id).map((a) => a.id);
      db.users = db.users.filter((x) => x.id !== u.id);
      db.attempts = db.attempts.filter((a) => a.user_id !== u.id);
      db.answers = db.answers.filter((x) => !att.includes(x.attempt_id));
      db.incidents = db.incidents.filter((x) => !att.includes(x.attempt_id));
      audit(ctx, 'student_delete', name);
      return { deleted: true };
    } else fail('Action inconnue.');
    audit(ctx, 'student_' + act, name);
    return { ok: true };
  };
  A.t_students_bulk = (ctx) => {
    const { db, data } = ctx;
    const ids = (Array.isArray(data.ids) ? data.ids : []).map(Number).filter(Boolean);
    if (!ids.length) fail('Aucun élève sélectionné.');
    const act = str(data.action, 20);
    const targets = db.users.filter((u) => u.role === 'student' && ids.includes(u.id));
    if (act === 'validate') targets.forEach((u) => { u.status = 'active'; });
    else if (act === 'class') { const cid = int(data.class_id, 0); if (cid && !byId(db.classes, cid)) fail('Classe introuvable.'); targets.forEach((u) => { u.class_id = cid || null; }); }
    else if (act === 'delete') targets.forEach((u) => A.t_student_action({ ...ctx, data: { student_id: u.id, action: 'delete' } }));
    else fail('Action inconnue.');
    audit(ctx, 'students_bulk_' + act, ids.length + ' élève(s)');
    return { ok: true, count: ids.length };
  };
  A.t_classes = (ctx) => ({ classes: classesList(ctx.db) });
  A.t_class_save = (ctx) => {
    const { db, data } = ctx;
    const name = str(data.name, 60).replace(/\s+/g, ' ');
    if (!name) fail('Donne un nom à la classe (ex : 2nde 3).');
    const id = int(data.id, 0);
    if (db.classes.some((c) => c.name === name && c.id !== id)) fail('Cette classe existe déjà.');
    let cid = id;
    if (id) (byId(db.classes, id) || fail('Classe introuvable.', 404)).name = name;
    else { cid = ++db.seq.class; db.classes.push({ id: cid, name, created_at: sec() }); }
    audit(ctx, 'class_save', name);
    return { classes: classesList(db), id: cid };
  };
  A.t_class_delete = (ctx) => {
    const { db } = ctx;
    const c = byId(db.classes, ctx.data.class_id) || fail('Classe introuvable.', 404);
    db.classes = db.classes.filter((x) => x.id !== c.id);
    db.quiz_classes = db.quiz_classes.filter((x) => x.class_id !== c.id);
    db.users.forEach((u) => { if (u.class_id === c.id) u.class_id = null; });
    audit(ctx, 'class_delete', c.name);
    return { classes: classesList(db) };
  };
  A.t_settings = (ctx) => ({ settings: { ...ctx.db.settings }, my_ip: '127.0.0.1 (démo)' });
  A.t_settings_save = (ctx) => {
    const { db, data } = ctx;
    const site = str(data.site_name, 60); const teacher = str(data.teacher_name, 60);
    if (!site || !teacher) fail('Le nom du site et le nom de la professeure sont obligatoires.');
    Object.assign(db.settings, { site_name: site, teacher_name: teacher, allow_registration: bool(data.allow_registration), require_validation: bool(data.require_validation) });
    audit(ctx, 'settings_update');
    return { ok: true };
  };
  A.t_audit = (ctx) => ({ entries: ctx.db.audit.slice().sort((a, b) => b.id - a.id).slice(0, 300).map((e) => ({ id: e.id, action: e.action, detail: e.detail, ip: e.ip, created_at: e.created_at })) });
  A.t_my_ip = () => ({ ip: '127.0.0.1 (démo)' });

  /* ---------------- Seed ---------------- */
  function seed() {
    const db = {
      v: 3, pepper: hex(16),
      seq: { user: 0, class: 0, quiz: 0, question: 0, attempt: 0, answer: 0, incident: 0, audit: 0 },
      settings: { site_name: 'Quiz SES', teacher_name: 'Mme Cyrine', allow_registration: true, require_validation: true },
      users: [], classes: [], quizzes: [], quiz_classes: [], questions: [], attempts: [], answers: [], incidents: [], audit: [], throttle: []
    };
    const t0 = sec();
    DEMO.classes.forEach((name) => db.classes.push({ id: ++db.seq.class, name, created_at: t0 }));
    const cls = (name) => db.classes.find((c) => c.name === name).id;
    db.users.push({ id: ++db.seq.user, role: 'teacher', login_key: 'cyrine', first_name: 'Cyrine', last_name: '', password_hash: hashPw(db, 'cyrine2026'), class_id: null, status: 'active', must_change_password: false, session_token: null, created_at: t0, last_login_at: null });

    DEMO.quizzes.forEach((src, qi) => {
      const id = ++db.seq.quiz;
      const openInDemo = qi <= 1;
      db.quizzes.push({
        id, title: src.title, description: src.description, level: src.level, chapter: src.chapter, status: openInDemo ? 'open' : src.status, access_code: src.access_code,
        opens_at: null, closes_at: null, max_attempts: 1, time_limit: 0, shuffle_questions: true, shuffle_choices: true, pool_size: 0, feedback_mode: src.feedback_mode,
        results_released: false, show_leaderboard: !!src.show_leaderboard, speed_bonus: true, require_fullscreen: true, max_exits: src.max_exits, exit_action: src.exit_action,
        allowed_ips: null, created_at: t0 - 86400 * (4 - qi), updated_at: t0 - 3600 * (4 - qi)
      });
      src.questions.forEach((q, pos) => db.questions.push({ id: ++db.seq.question, quiz_id: id, position: pos, type: q.type, prompt: q.prompt, image: null, data: clone(q.data), points: q.points, time_limit: q.time_limit, partial: !!q.partial, explanation: q.explanation || null }));
    });

    const people = [
      ['Emma', 'Leroy', 0.92], ['Hugo', 'Bernard', 0.78], ['Chloé', 'Petit', 0.85], ['Nathan', 'Robert', 0.55], ['Léa', 'Richard', 0.7], ['Lucas', 'Durand', 0.45],
      ['Inès', 'Moreau', 0.88], ['Adam', 'Laurent', 0.6], ['Jade', 'Simon', 0.74], ['Rayan', 'Michel', 0.5], ['Manon', 'Garcia', 0.8], ['Yanis', 'David', 0.65]
    ];
    const tle = cls('Tle SES 2');
    people.forEach(([f, l]) => db.users.push({ id: ++db.seq.user, role: 'student', login_key: studentKey(f, l), first_name: f, last_name: l, password_hash: hashPw(db, 'demo2026'), class_id: tle, status: 'active', must_change_password: false, session_token: null, created_at: t0 - 86400 * 10, last_login_at: t0 - 3600 * (2 + rnd(40)) }));
    [['Sofia', 'Roux'], ['Enzo', 'Fournier']].forEach(([f, l]) => db.users.push({ id: ++db.seq.user, role: 'student', login_key: studentKey(f, l), first_name: f, last_name: l, password_hash: hashPw(db, 'demo2026'), class_id: null, status: 'pending', must_change_password: false, session_token: null, created_at: t0 - 1800, last_login_at: t0 - 1800 }));

    const quiz = db.quizzes[0];
    const qs = quizQuestions(db, quiz.id);
    people.slice(0, 11).forEach(([f, l, skill], k) => {
      const u = db.users.find((x) => x.login_key === studentKey(f, l));
      const start = (t0 - 86400 - 3600 * 3 + k * 95) * 1000;
      const ids = shuffle(qs.map((q) => q.id));
      const orders = {};
      qs.forEach((q) => { orders[q.id] = shuffle(q.data.choices.map((c) => c.id)); });
      const a = {
        id: ++db.seq.attempt, quiz_id: quiz.id, user_id: u.id, attempt_no: 1, is_preview: false, status: 'finished', finish_reason: 'completed', lock_reason: null, question_ids: ids, choice_orders: orders,
        current_index: ids.length, q_started_ms: null, started_ms: start, deadline_ms: null, finished_ms: null, last_seen_ms: start, score: 0, max_score: 0, points: 0, zeroed: false,
        warning_text: null, warning_ms: null, exits: 0, incidents: 0, away_ms: 0, session_token: '', ip: '10.0.3.' + (20 + k), device: k % 3 === 0 ? 'PC Windows' : k % 3 === 1 ? 'iPhone' : 'Android', user_agent: ''
      };
      db.attempts.push(a);
      let t = start;
      const exitAt = f === 'Adam' ? 6 : f === 'Rayan' ? 11 : -1;
      ids.forEach((qid, pos) => {
        const q = byId(db.questions, qid);
        a.current_index = pos;
        const tm = 5000 + rnd(30000);
        t += 2000 + tm;
        if (pos === exitAt) {
          a.status = 'in_progress';
          logIncident(db, a, f === 'Adam' ? 'hidden' : 'blur', f === 'Adam' ? 'Page ou application quittée' : 'Autre fenêtre ou application au premier plan', 9000 + rnd(12000), true, 'c-seed' + a.id);
          db.incidents[db.incidents.length - 1].created_ms = t;
          a.exits = 1;
          db.answers.push({ id: ++db.seq.answer, attempt_id: a.id, question_id: qid, position: pos, response: null, status: 'cancelled', fraction: 0, score: 0, points: 0, override_score: null, time_ms: tm, created_ms: t });
          logIncident(db, a, 'teacher', 'Quiz débloqué par la professeure', null, false);
          db.incidents[db.incidents.length - 1].created_ms = t + 40000;
          t += 45000;
          return;
        }
        if (f === 'Rayan' && pos === 4) { logIncident(db, a, 'paste', 'Collage bloqué', null, false); db.incidents[db.incidents.length - 1].created_ms = t - 3000; }
        const ok = Math.random() < skill;
        const choices = q.data.choices;
        const pick = ok ? choices.find((c) => c.correct) : choices.filter((c) => !c.correct)[rnd(choices.length - 1)];
        const g = grade(q, { choice: pick.id }, tm, true);
        db.answers.push({ id: ++db.seq.answer, attempt_id: a.id, question_id: qid, position: pos, response: { choice: pick.id }, status: 'answered', fraction: g.fraction, score: g.score, points: g.points, override_score: null, time_ms: tm, created_ms: t });
      });
      a.status = 'finished';
      a.current_index = ids.length;
      a.finished_ms = t;
      a.last_seen_ms = t;
      a.session_token = '';
      recompute(db, a);
    });
    // One student currently locked, to show the live view in action.
    const manon = db.users.find((x) => x.first_name === 'Manon');
    const locked = db.attempts.find((a) => a.user_id === manon.id);
    if (locked) {
      const keep = 7;
      const drop = db.answers.filter((x) => x.attempt_id === locked.id && x.position >= keep).map((x) => x.id);
      db.answers = db.answers.filter((x) => !drop.includes(x.id));
      const nowMs = now();
      Object.assign(locked, { status: 'locked', finish_reason: null, lock_reason: LABELS.hidden, current_index: keep, finished_ms: null, started_ms: nowMs - 5 * 60000, last_seen_ms: nowMs - 20000, exits: 1 });
      db.answers.filter((x) => x.attempt_id === locked.id).forEach((x, i) => { x.created_ms = nowMs - 5 * 60000 + (i + 1) * 30000; });
      db.answers.push({ id: ++db.seq.answer, attempt_id: locked.id, question_id: locked.question_ids[keep - 1], position: keep - 1, response: null, status: 'cancelled', fraction: 0, score: 0, points: 0, override_score: null, time_ms: 12000, created_ms: nowMs - 25000 });
      db.answers = db.answers.filter((x, i, arr) => !(x.attempt_id === locked.id && x.position === keep - 1 && x.status !== 'cancelled'));
      logIncident(db, locked, 'hidden', 'Page ou application quittée', 14000, true, 'c-seedlock');
      db.incidents[db.incidents.length - 1].created_ms = nowMs - 25000;
      recompute(db, locked);
    }
    return db;
  }

  /* ---------------- Entry point ---------------- */
  QZ.backend = async function (action, data) {
    let db = load();
    if (!db || db.v !== 3) { db = seed(); save(db); }
    const sess = getSession();
    const ctx = { db, sess, data: data || {}, replaced: false };
    await new Promise((r) => setTimeout(r, 25));
    if (!A[action]) fail('Action inconnue.', 404, 'unknown_action');
    try {
      if (action.startsWith('t_')) requireTeacher(ctx);
      const out = A[action](ctx);
      save(db);
      setSession(sess);
      return clone(out);
    } catch (e) {
      if (ctx.commitOnError) save(db);
      setSession(sess);
      throw e;
    }
  };
  QZ.demoReset = () => {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(SKEY); } catch (e) { /* ignore */ }
    mem = null; memSession = null;
  };
  QZ.demoStorageOk = () => storageOk;
})(window.QZ = window.QZ || {});
