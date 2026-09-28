/* Quiz SES — éditeur de quiz et de questions. */
(function (QZ) {
  'use strict';
  const { html, icon, shape, mount, $, $$, delegate, fmt } = QZ;

  const LEVELS = ['Seconde', 'Première', 'Terminale', 'Autre'];
  const TIMES = [[10, '10 s'], [15, '15 s'], [20, '20 s'], [30, '30 s'], [40, '40 s'], [45, '45 s'], [60, '1 min'], [90, '1 min 30'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [0, 'Sans limite']];
  const TYPE_ICONS = { single: 'check', multiple: 'list', truefalse: 'refresh', short: 'edit', numeric: 'bars', ordering: 'grip' };
  const TYPE_HELP = {
    single: 'Une seule bonne réponse (style Kahoot).',
    multiple: 'Plusieurs bonnes réponses à cocher.',
    truefalse: 'L’élève choisit Vrai ou Faux.',
    short: 'L’élève tape un mot ou une expression.',
    numeric: 'L’élève calcule un nombre (taux, indice, élasticité…).',
    ordering: 'L’élève remet des éléments dans le bon ordre.'
  };
  const pad = (n) => String(n).padStart(2, '0');
  const toLocal = (s) => { if (!s) return ''; const d = new Date(s * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fromLocal = (v) => (v ? Math.floor(new Date(v).getTime() / 1000) : 0);
  const rid = () => Math.random().toString(36).slice(2, 8);

  function defaultsFor(type, prev) {
    const prevChoices = prev && prev.data && prev.data.choices;
    switch (type) {
      case 'single': {
        const ch = prevChoices ? prevChoices.map((c) => ({ ...c })) : [0, 1, 2, 3].map(() => ({ id: 'c' + rid(), text: '', correct: false }));
        let seen = false;
        ch.forEach((c) => { if (c.correct && !seen) seen = true; else c.correct = false; });
        if (!seen && ch.length) ch[0].correct = true;
        return { choices: ch };
      }
      case 'multiple': return { choices: prevChoices ? prevChoices.map((c) => ({ ...c })) : [0, 1, 2, 3].map(() => ({ id: 'c' + rid(), text: '', correct: false })) };
      case 'truefalse': return { answer: true };
      case 'short': return { answers: [''], tolerance: true };
      case 'numeric': return { value: '', tolerance: 0, unit: '' };
      case 'ordering': return { items: [0, 1, 2, 3].map(() => ({ id: 'i' + rid(), text: '' })) };
    }
    return {};
  }

  function answerSummary(q) {
    const d = q.data;
    switch (q.type) {
      case 'single':
      case 'multiple': return d.choices.filter((c) => c.correct).map((c) => c.text).join(' · ');
      case 'truefalse': return d.answer ? 'Vrai' : 'Faux';
      case 'short': return d.answers.join(' · ');
      case 'numeric': return fmt.num(d.value, 4) + (d.unit ? ' ' + d.unit : '') + (d.tolerance ? ' (± ' + fmt.num(d.tolerance, 4) + ')' : '');
      case 'ordering': return d.items.map((i, k) => (k + 1) + '. ' + i.text).join('  ');
    }
    return '';
  }

  QZ.route('/prof/quiz/:id', async ({ id }) => {
    const main = QZ.teacherPage('quiz');
    if (!main) return;
    const isNew = id === 'nouveau';
    let quiz;
    let classes = [];
    let myIp = '';
    try {
      const [cl, st] = await Promise.all([QZ.call('t_classes'), QZ.call('t_settings')]);
      classes = cl.classes;
      myIp = st.my_ip;
      if (!isNew) quiz = (await QZ.call('t_quiz_get', { quiz_id: +id })).quiz;
    } catch (e) { return QZ.fail(e); }
    if (isNew) {
      quiz = {
        id: 0, title: '', description: '', level: 'Terminale', chapter: '', status: 'draft', access_code: '', opens_at: null, closes_at: null,
        max_attempts: 1, time_limit: 0, shuffle_questions: true, shuffle_choices: true, pool_size: 0, feedback_mode: 'release', results_released: false,
        show_leaderboard: true, speed_bonus: true, require_fullscreen: true, max_exits: 0, exit_action: 'lock', allowed_ips: '', class_ids: [], questions: [], attempt_count: 0
      };
    }

    const settingsForm = () => html`<form class="stack" id="qs-form" novalidate>
      <details class="settings" open><summary>${icon('doc')}Informations</summary><div class="inner">
        <div class="field"><label for="qs-title">Titre du quiz</label><input class="input" id="qs-title" value="${quiz.title}" maxlength="200" placeholder="Ex : La croissance économique" required></div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="qs-level">Niveau</label><select class="select" id="qs-level">${LEVELS.map((l) => html`<option ${quiz.level === l ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div class="field"><label for="qs-attempts">Tentatives par élève</label><input class="input" id="qs-attempts" type="number" min="1" max="20" value="${quiz.max_attempts}"></div>
        </div>
        <div class="field"><label for="qs-chapter">Chapitre / question du programme</label><input class="input" id="qs-chapter" value="${quiz.chapter}" maxlength="200"></div>
        <div class="field"><label for="qs-desc">Description (visible par les élèves)</label><textarea class="textarea" id="qs-desc" rows="2" maxlength="2000">${quiz.description || ''}</textarea></div>
      </div></details>
      <details class="settings" ${isNew ? '' : 'open'}><summary>${icon('shieldx')}Anti-triche</summary><div class="inner">
        <div class="field"><label for="qs-exit">Quand un élève quitte le quiz (autre appli, onglet, capture…)</label>
          <select class="select" id="qs-exit">
            <option value="lock" ${quiz.exit_action === 'lock' ? 'selected' : ''}>Verrouiller le quiz jusqu’à ce que je le débloque (recommandé)</option>
            <option value="submit" ${quiz.exit_action === 'submit' ? 'selected' : ''}>Terminer sa copie immédiatement</option>
            <option value="log" ${quiz.exit_action === 'log' ? 'selected' : ''}>Seulement me le signaler (entraînement)</option>
          </select><span class="hint">Dans les deux premiers cas, la question en cours est aussi annulée (0 point) : revenir avec la réponse de ChatGPT ne sert à rien.</span></div>
        <div class="field"><label for="qs-maxexits">Sorties tolérées avant la sanction</label><select class="select" id="qs-maxexits">${[0, 1, 2, 3, 5].map((n) => html`<option value="${n}" ${quiz.max_exits === n ? 'selected' : ''}>${n === 0 ? 'Aucune (sanction dès la 1re sortie)' : n + ' sortie' + (n > 1 ? 's' : '')}</option>`)}</select></div>
        <label class="switch"><input type="checkbox" id="qs-fs" ${quiz.require_fullscreen ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Plein écran obligatoire sur ordinateur</b><span class="hint">Sortir du plein écran compte comme une sortie.</span></span></label>
        <label class="switch"><input type="checkbox" id="qs-shq" ${quiz.shuffle_questions ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Mélanger l’ordre des questions</b><span class="hint">Chaque élève a un ordre différent : impossible de copier sur le voisin.</span></span></label>
        <label class="switch"><input type="checkbox" id="qs-shc" ${quiz.shuffle_choices ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Mélanger les réponses</b><span class="hint">« C’est la B » ne veut plus rien dire.</span></span></label>
        <div class="field"><label for="qs-pool">Tirer au hasard un nombre de questions</label><input class="input" id="qs-pool" type="number" min="0" max="500" value="${quiz.pool_size || ''}" placeholder="Toutes (${quiz.questions.length})"><span class="hint">Ex : 15 questions tirées parmi 20, différentes pour chaque élève.</span></div>
        <div class="field"><label for="qs-ips">Réservé au réseau du lycée (adresses IP)</label><div class="row"><input class="input grow" id="qs-ips" value="${quiz.allowed_ips || ''}" placeholder="Laisser vide = partout" style="width:auto"><button type="button" class="btn btn-sm" data-myip>Mon IP actuelle</button></div><span class="hint">Si tu es connectée au Wi-Fi du lycée, clique sur « Mon IP actuelle » : le quiz ne pourra être passé qu’en classe (${myIp}).</span></div>
      </div></details>
      <details class="settings" ${isNew ? '' : ''}><summary>${icon('key')}Accès</summary><div class="inner">
        <div class="field"><label for="qs-code">Code d’accès (à donner en classe)</label><div class="row"><input class="input input-code grow" id="qs-code" value="${quiz.access_code || ''}" maxlength="12" autocomplete="off" style="width:auto"><button type="button" class="btn btn-sm" data-gencode>${icon('refresh', 'icon-sm')}Générer</button></div><span class="hint">Seuls les élèves présents qui voient le code au tableau peuvent commencer.</span></div>
        ${classes.length ? html`<div class="field"><span class="label">Réservé aux classes</span><div class="row">${classes.map((c) => html`<label class="check" style="background:var(--surface-2);padding:6px 10px;border-radius:10px"><input type="checkbox" data-class="${c.id}" ${quiz.class_ids.includes(c.id) ? 'checked' : ''}><span>${c.name}</span></label>`)}</div><span class="hint">Aucune case cochée = toutes les classes.</span></div>` : ''}
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="qs-open">Ouverture automatique</label><input class="input" id="qs-open" type="datetime-local" value="${toLocal(quiz.opens_at)}"></div>
          <div class="field"><label for="qs-close">Fermeture automatique</label><input class="input" id="qs-close" type="datetime-local" value="${toLocal(quiz.closes_at)}"></div>
        </div>
        <div class="field"><label for="qs-total">Durée totale maximale (minutes)</label><input class="input" id="qs-total" type="number" min="0" max="360" value="${quiz.time_limit ? Math.round(quiz.time_limit / 60) : ''}" placeholder="Pas de limite globale"><span class="hint">En plus du chrono de chaque question.</span></div>
      </div></details>
      <details class="settings"><summary>${icon('trophy')}Résultats et style Kahoot</summary><div class="inner">
        <div class="field"><label for="qs-fb">Correction visible par les élèves</label>
          <select class="select" id="qs-fb">
            <option value="release" ${quiz.feedback_mode === 'release' ? 'selected' : ''}>Quand je publie les résultats (recommandé contre la triche)</option>
            <option value="end" ${quiz.feedback_mode === 'end' ? 'selected' : ''}>À la fin du quiz</option>
            <option value="immediate" ${quiz.feedback_mode === 'immediate' ? 'selected' : ''}>Après chaque question (mode Kahoot, révisions)</option>
          </select></div>
        <label class="switch"><input type="checkbox" id="qs-lb" ${quiz.show_leaderboard ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Classement (podium)</b><span class="hint">Visible par les élèves quand la correction l’est.</span></span></label>
        <label class="switch"><input type="checkbox" id="qs-speed" ${quiz.speed_bonus ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Points de rapidité</b><span class="hint">Comme Kahoot : répondre vite rapporte plus de points au classement (la note /20 ne change pas).</span></span></label>
      </div></details>
      <button class="btn btn-primary btn-lg" type="submit">${isNew ? 'Créer le quiz' : 'Enregistrer les réglages'}</button>
    </form>`;

    const questionList = () => html`
      <div class="row-between"><h2>Questions (${quiz.questions.length})</h2>
        <div class="row"><button class="btn btn-sm" data-import>${icon('upload', 'icon-sm')}Coller des questions</button><button class="btn btn-sm btn-primary" data-addq>${icon('plus', 'icon-sm')}Ajouter</button></div></div>
      ${quiz.questions.length ? html`<div class="qlist">${quiz.questions.map((q, i) => html`<div class="qitem">
        <span class="n">${i + 1}</span>
        <div class="body">
          <div class="row" style="gap:6px"><span class="pill pill-accent">${icon(TYPE_ICONS[q.type], 'icon-sm')}${QZ.TYPE_LABELS[q.type]}</span><span class="pill">${fmt.num(q.points)} pt</span><span class="pill">${icon('clock', 'icon-sm')}${q.time_limit ? fmt.secs(q.time_limit) : 'sans limite'}</span>${q.image ? html`<span class="pill">${icon('image', 'icon-sm')}image</span>` : ''}</div>
          <div class="prompt">${q.prompt}</div>
          <div class="small" style="color:var(--good)">${icon('check', 'icon-sm')} ${answerSummary(q)}</div>
        </div>
        <div class="tools">
          <button class="btn btn-ghost btn-icon btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Monter">${icon('up', 'icon-sm')}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-down="${i}" ${i === quiz.questions.length - 1 ? 'disabled' : ''} aria-label="Descendre">${icon('down', 'icon-sm')}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-dup="${q.id}" aria-label="Dupliquer">${icon('copy', 'icon-sm')}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-editq="${i}" aria-label="Modifier">${icon('edit', 'icon-sm')}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-delq="${q.id}" aria-label="Supprimer">${icon('trash', 'icon-sm')}</button>
        </div></div>`)}</div>` : html`<div class="card empty">${icon('list')}<p>Pas encore de question. Ajoute-en une, ou colle directement tout un quiz (format « 1. Question / A. … / ✓ B — explication »).</p></div>`}`;

    const draw = () => {
      const total = quiz.questions.reduce((s, q) => s + q.points, 0);
      mount(main, html`
        <div><button class="btn btn-ghost btn-sm" data-go="/prof/quiz">${icon('back', 'icon-sm')}Mes quiz</button></div>
        <div class="page-head">
          <div><h1>${isNew ? 'Nouveau quiz' : quiz.title}</h1>${isNew ? '' : html`<p class="sub row" style="gap:8px">${QZ.quizStatusPill(quiz.status)}<span>${fmt.plural(quiz.questions.length, 'question', 'questions')} · ${fmt.num(total)} points</span>${quiz.access_code ? html`<span class="pill pill-accent">${icon('lock', 'icon-sm')}${quiz.access_code}</span>` : ''}</p>`}</div>
          ${isNew ? '' : html`<div class="row">
            <button class="btn" data-preview ${quiz.questions.length ? '' : 'disabled'}>${icon('eye', 'icon-sm')}Tester</button>
            <button class="btn" data-go="/prof/direct/${quiz.id}">${icon('live', 'icon-sm')}Direct</button>
            <button class="btn" data-go="/prof/resultats/${quiz.id}">${icon('bars', 'icon-sm')}Résultats</button>
            ${quiz.status === 'open' ? html`<button class="btn btn-warn" data-status="closed">${icon('stop', 'icon-sm')}Fermer</button>` : html`<button class="btn btn-primary" data-status="open" ${quiz.questions.length ? '' : 'disabled'}>${icon('play', 'icon-sm')}Ouvrir aux élèves</button>`}
            <button class="btn btn-ghost btn-icon" data-more aria-label="Plus">${icon('menu')}</button></div>`}
        </div>
        ${quiz.attempt_count ? html`<div class="warn-box">${fmt.plural(quiz.attempt_count, 'copie existe', 'copies existent')} déjà pour ce quiz : si tu corriges une question, les notes sont recalculées automatiquement.</div>` : ''}
        ${isNew ? html`<div class="card" style="max-width:720px">${settingsForm()}</div>` : html`<div class="editor-layout"><section class="stack" id="qcol">${questionList()}</section><aside>${settingsForm()}</aside></div>`}`);
      bindForm();
    };

    function readForm() {
      return {
        id: quiz.id || 0,
        title: $('#qs-title').value,
        level: $('#qs-level').value,
        chapter: $('#qs-chapter').value,
        description: $('#qs-desc').value,
        max_attempts: +$('#qs-attempts').value || 1,
        exit_action: $('#qs-exit').value,
        max_exits: +$('#qs-maxexits').value,
        require_fullscreen: $('#qs-fs').checked,
        shuffle_questions: $('#qs-shq').checked,
        shuffle_choices: $('#qs-shc').checked,
        pool_size: +$('#qs-pool').value || 0,
        allowed_ips: $('#qs-ips').value,
        access_code: $('#qs-code').value,
        class_ids: $$('[data-class]', main).filter((c) => c.checked).map((c) => +c.dataset.class),
        opens_at: fromLocal($('#qs-open').value),
        closes_at: fromLocal($('#qs-close').value),
        time_limit: (+$('#qs-total').value || 0) * 60,
        feedback_mode: $('#qs-fb').value,
        show_leaderboard: $('#qs-lb').checked,
        speed_bonus: $('#qs-speed').checked
      };
    }

    function bindForm() {
      const f = $('#qs-form', main);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = f.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          const r = await QZ.call('t_quiz_save', readForm());
          if (isNew) { QZ.toast('Quiz créé : ajoute tes questions', 'good'); return QZ.go('/prof/quiz/' + r.quiz.id, { replace: true }); }
          quiz = r.quiz;
          QZ.toast('Réglages enregistrés', 'good');
          draw();
        } catch (err) { QZ.fail(err); btn.disabled = false; }
      });
    }

    async function reloadQuiz() {
      quiz = (await QZ.call('t_quiz_get', { quiz_id: quiz.id })).quiz;
      draw();
    }

    draw();

    delegate(main, 'click', '[data-gencode]', () => { $('#qs-code').value = String(Math.floor(100000 + Math.random() * 900000)); });
    delegate(main, 'click', '[data-myip]', () => { const el = $('#qs-ips'); el.value = el.value ? el.value + ', ' + myIp : myIp; });
    delegate(main, 'click', '[data-addq]', () => openQuestion(null));
    delegate(main, 'click', '[data-editq]', (e, t) => openQuestion(quiz.questions[+t.dataset.editq]));
    delegate(main, 'click', '[data-import]', () => openImport());
    delegate(main, 'click', '[data-more]', () => QZ.quizMenu({ ...quiz, question_count: quiz.questions.length }, () => QZ.go('/prof/quiz', { replace: true })));
    delegate(main, 'click', '[data-status]', async (e, t) => {
      try {
        if (t.dataset.status === 'open') {
          const warn = !quiz.access_code ? 'Aucun code d’accès : tous les élèves peuvent le commencer, même hors de la classe.' : 'Les élèves pourront le commencer avec le code ' + quiz.access_code + '.';
          if (!(await QZ.confirm({ title: 'Ouvrir « ' + quiz.title + ' » ?', message: warn, confirmLabel: 'Ouvrir' }))) return;
        }
        await QZ.call('t_quiz_status', { quiz_id: quiz.id, status: t.dataset.status });
        QZ.toast(t.dataset.status === 'open' ? 'Quiz ouvert aux élèves' : 'Quiz fermé', 'good');
        await reloadQuiz();
      } catch (err) { QZ.fail(err); }
    });
    delegate(main, 'click', '[data-preview]', async () => {
      try {
        if (document.documentElement.requestFullscreen && quiz.require_fullscreen && !QZ.isMobile()) await document.documentElement.requestFullscreen().catch(() => {});
        const s = await QZ.call('quiz_start', { quiz_id: quiz.id });
        QZ.go('/prof/apercu/' + s.attempt_id);
      } catch (err) { QZ.fail(err); }
    });
    delegate(main, 'click', '[data-up],[data-down]', async (e, t) => {
      const i = +(t.dataset.up ?? t.dataset.down);
      const j = t.dataset.up !== undefined ? i - 1 : i + 1;
      const qs = quiz.questions.slice();
      [qs[i], qs[j]] = [qs[j], qs[i]];
      try { await QZ.call('t_question_reorder', { quiz_id: quiz.id, ids: qs.map((q) => q.id) }); quiz.questions = qs; draw(); } catch (err) { QZ.fail(err); }
    });
    delegate(main, 'click', '[data-dup]', async (e, t) => { try { await QZ.call('t_question_duplicate', { question_id: +t.dataset.dup }); await reloadQuiz(); QZ.toast('Question dupliquée', 'good'); } catch (err) { QZ.fail(err); } });
    delegate(main, 'click', '[data-delq]', async (e, t) => {
      if (!(await QZ.confirm({ title: 'Supprimer cette question ?', message: quiz.attempt_count ? 'Les réponses des élèves à cette question seront supprimées et les notes recalculées.' : 'Cette action est définitive.', confirmLabel: 'Supprimer', danger: true }))) return;
      try { await QZ.call('t_question_delete', { question_id: +t.dataset.delq }); await reloadQuiz(); } catch (err) { QZ.fail(err); }
    });

    /* ---------- Paste import ---------- */
    function openImport() {
      QZ.modal({
        title: 'Coller des questions',
        wide: true,
        body: html`<p class="muted small">Colle tout un quiz d’un coup. Deux formats sont reconnus automatiquement :</p>
          <div class="form-grid">
            <pre class="card-flat small" style="margin:0;white-space:pre-wrap">1. Qu’est-ce que la PGF ?
• A. La quantité de travail
• B. Le résidu de croissance…
• C. Le taux de chômage
✓ B — Explication affichée dans la correction.</pre>
            <pre class="card-flat small" style="margin:0;white-space:pre-wrap">Le PIB mesure :
A. la production
B. le patrimoine
ANSWER: A

Sources de croissance ?
A) le travail
B) le capital
C) le chômage
ANSWER: A, B</pre>
          </div>
          <textarea class="textarea" id="imp-text" rows="12" placeholder="Colle tes questions ici…"></textarea>
          <div class="form-grid">
            <div class="field"><label for="imp-time">Temps par question</label><select class="select" id="imp-time">${TIMES.map(([v, l]) => html`<option value="${v}" ${v === 30 ? 'selected' : ''}>${l}</option>`)}</select></div>
            <div class="field"><label for="imp-pts">Points par question</label><input class="input" id="imp-pts" type="number" min="0" step="0.5" value="1"></div>
          </div>`,
        actions: [{ label: 'Annuler' }, {
          label: 'Importer', kind: 'primary', onClick: async (m) => {
            const r = await QZ.call('t_import', { quiz_id: quiz.id, text: $('#imp-text', m.el).value, time_limit: +$('#imp-time', m.el).value, points: +$('#imp-pts', m.el).value });
            await reloadQuiz();
            if (r.errors.length) {
              QZ.modal({ title: fmt.plural(r.created, 'question importée', 'questions importées'), body: html`<p>Certaines questions n’ont pas pu être lues :</p><ul class="small">${r.errors.map((e) => html`<li>${e}</li>`)}</ul>` });
            } else {
              QZ.toast(fmt.plural(r.created, 'question importée', 'questions importées'), 'good');
            }
          }
        }]
      });
    }

    /* ---------- Question editor ---------- */
    function openQuestion(existing) {
      const q = existing ? JSON.parse(JSON.stringify(existing)) : { id: 0, type: 'single', prompt: '', image: null, points: 1, time_limit: 30, partial: true, explanation: '', data: defaultsFor('single') };
      if (q.type === 'numeric') q.data.value = q.data.value === '' ? '' : String(q.data.value).replace('.', ',');
      let m;
      const body = () => html`
        <div class="type-picker">${Object.keys(QZ.TYPE_LABELS).map((t) => html`<button type="button" class="type-opt ${q.type === t ? 'active' : ''}" data-type="${t}">${icon(TYPE_ICONS[t])}${QZ.TYPE_LABELS[t]}</button>`)}</div>
        <p class="hint">${TYPE_HELP[q.type]}</p>
        <div class="field"><label for="qe-prompt">Énoncé</label><textarea class="textarea" id="qe-prompt" rows="3" maxlength="5000" placeholder="Ex : Qu’est-ce que la productivité globale des facteurs ?">${q.prompt}</textarea></div>
        <div class="img-drop">${q.image ? html`<img src="${QZ.imgUrl(q.image)}" alt="Document de la question"><button type="button" class="btn btn-sm" data-rmimg>${icon('trash', 'icon-sm')}Retirer</button>` : html`<span class="muted small">${icon('image', 'icon-sm')} Document (graphique, tableau statistique…) — facultatif</span>`}<label class="btn btn-sm">${icon('upload', 'icon-sm')}${q.image ? 'Remplacer' : 'Ajouter une image'}<input type="file" accept="image/*" id="qe-img" hidden></label></div>
        <div id="qe-answers">${answersEditor()}</div>
        <div class="form-grid">
          <div class="field"><label for="qe-points">Points</label><input class="input" id="qe-points" type="number" min="0" max="100" step="0.25" value="${q.points}"></div>
          <div class="field"><label for="qe-time">Temps pour répondre</label><select class="select" id="qe-time">${TIMES.map(([v, l]) => html`<option value="${v}" ${q.time_limit === v ? 'selected' : ''}>${l}</option>`)}${TIMES.some(([v]) => v === q.time_limit) ? '' : html`<option value="${q.time_limit}" selected>${fmt.secs(q.time_limit)}</option>`}</select></div>
        </div>
        ${q.type === 'multiple' || q.type === 'ordering' ? html`<label class="switch"><input type="checkbox" id="qe-partial" ${q.partial ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Points partiels</b><span class="hint">${q.type === 'multiple' ? 'Chaque bonne case rapporte, chaque mauvaise case retire.' : 'Points proportionnels aux éléments bien placés.'}</span></span></label>` : ''}
        <div class="field"><label for="qe-expl">Explication (affichée dans la correction)</label><textarea class="textarea" id="qe-expl" rows="2" maxlength="3000">${q.explanation || ''}</textarea></div>
        <div class="error-box" hidden></div>`;

      function answersEditor() {
        const d = q.data;
        if (q.type === 'single' || q.type === 'multiple') {
          return html`<div class="stack-sm"><span class="label">Propositions — ${q.type === 'single' ? 'marque LA bonne réponse' : 'marque toutes les bonnes réponses'}</span>
            ${d.choices.map((c, i) => html`<div class="choice-row"><span class="shape-sq" style="background:var(--t-${['red', 'blue', 'yellow', 'green', 'purple', 'teal'][i % 6]})">${shape(i)}</span>
              <input class="input" data-ctext="${i}" value="${c.text}" maxlength="500" placeholder="Réponse ${String.fromCharCode(65 + i)}">
              <span class="row" style="gap:4px;flex-wrap:nowrap"><button type="button" class="correct-toggle ${c.correct ? 'on' : ''}" data-cok="${i}">${icon(c.correct ? 'check' : 'x', 'icon-sm')}${c.correct ? 'Juste' : 'Faux'}</button>${d.choices.length > 2 ? html`<button type="button" class="btn btn-ghost btn-icon btn-sm" data-crm="${i}" aria-label="Retirer">${icon('trash', 'icon-sm')}</button>` : ''}</span></div>`)}
            ${d.choices.length < 8 ? html`<button type="button" class="btn btn-sm" data-cadd style="align-self:flex-start">${icon('plus', 'icon-sm')}Ajouter une proposition</button>` : ''}</div>`;
        }
        if (q.type === 'truefalse') {
          return html`<div class="stack-sm"><span class="label">Bonne réponse</span><div class="row">
            <button type="button" class="btn btn-lg ${d.answer ? 'btn-primary' : ''}" data-tf="1" style="flex:1">${icon('check')}Vrai</button>
            <button type="button" class="btn btn-lg ${!d.answer ? 'btn-primary' : ''}" data-tf="0" style="flex:1">${icon('x')}Faux</button></div></div>`;
        }
        if (q.type === 'short') {
          return html`<div class="stack-sm"><span class="label">Réponses acceptées</span>
            ${d.answers.map((a, i) => html`<div class="row"><input class="input grow" data-atext="${i}" value="${a}" maxlength="200" placeholder="${i === 0 ? 'Ex : Schumpeter' : 'Autre formulation acceptée'}" style="width:auto">${d.answers.length > 1 ? html`<button type="button" class="btn btn-ghost btn-icon btn-sm" data-arm="${i}" aria-label="Retirer">${icon('trash', 'icon-sm')}</button>` : ''}</div>`)}
            <button type="button" class="btn btn-sm" data-aadd style="align-self:flex-start">${icon('plus', 'icon-sm')}Autre formulation</button>
            <label class="check"><input type="checkbox" id="qe-tol" ${d.tolerance ? 'checked' : ''}><span>Tolérer une faute de frappe (1 lettre, 2 pour les mots longs)</span></label>
            <p class="hint">Les majuscules, accents, la ponctuation et les articles (le, la, les, l’, un, une, des) sont ignorés.</p></div>`;
        }
        if (q.type === 'numeric') {
          return html`<div class="form-grid">
            <div class="field"><label for="qe-val">Valeur attendue</label><input class="input" id="qe-val" value="${d.value}" inputmode="decimal" placeholder="Ex : -2,5"></div>
            <div class="field"><label for="qe-tolv">Marge d’erreur acceptée (±)</label><input class="input" id="qe-tolv" value="${String(d.tolerance).replace('.', ',')}" inputmode="decimal"></div>
            <div class="field"><label for="qe-unit">Unité affichée</label><input class="input" id="qe-unit" value="${d.unit || ''}" maxlength="20" placeholder="%, €, points…"></div></div>
            <p class="hint">L’élève peut écrire 2,5 ou 2.5, avec ou sans l’unité.</p>`;
        }
        if (q.type === 'ordering') {
          return html`<div class="stack-sm"><span class="label">Éléments dans le BON ordre (ils seront mélangés pour l’élève)</span>
            ${d.items.map((it, i) => html`<div class="row" style="flex-wrap:nowrap"><span class="pill num">${i + 1}</span><input class="input grow" data-itext="${i}" value="${it.text}" maxlength="300" style="width:auto">
              <button type="button" class="btn btn-ghost btn-icon btn-sm" data-iup="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Monter">${icon('up', 'icon-sm')}</button>
              ${d.items.length > 2 ? html`<button type="button" class="btn btn-ghost btn-icon btn-sm" data-irm="${i}" aria-label="Retirer">${icon('trash', 'icon-sm')}</button>` : ''}</div>`)}
            ${d.items.length < 10 ? html`<button type="button" class="btn btn-sm" data-iadd style="align-self:flex-start">${icon('plus', 'icon-sm')}Ajouter un élément</button>` : ''}</div>`;
        }
        return '';
      }

      function syncFromInputs() {
        const el = m.el;
        q.prompt = $('#qe-prompt', el).value;
        q.points = parseFloat(String($('#qe-points', el).value).replace(',', '.')) || 0;
        q.time_limit = +$('#qe-time', el).value;
        q.explanation = $('#qe-expl', el).value;
        const p = $('#qe-partial', el);
        if (p) q.partial = p.checked;
        const d = q.data;
        $$('[data-ctext]', el).forEach((i) => { d.choices[+i.dataset.ctext].text = i.value; });
        $$('[data-atext]', el).forEach((i) => { d.answers[+i.dataset.atext] = i.value; });
        $$('[data-itext]', el).forEach((i) => { d.items[+i.dataset.itext].text = i.value; });
        if ($('#qe-tol', el)) d.tolerance = $('#qe-tol', el).checked;
        if ($('#qe-val', el)) { d.value = $('#qe-val', el).value; d.tolerance = $('#qe-tolv', el).value; d.unit = $('#qe-unit', el).value; }
      }
      function redraw() {
        const scroll = m.el.querySelector('.modal').scrollTop;
        mount($('.modal-body', m.el), body());
        m.el.querySelector('.modal').scrollTop = scroll;
      }

      m = QZ.modal({
        title: existing ? 'Modifier la question' : 'Nouvelle question',
        wide: true,
        body: body(),
        actions: [{ label: 'Annuler' }, {
          label: existing ? 'Enregistrer' : 'Ajouter la question', kind: 'primary', close: false, onClick: async (mm) => {
            syncFromInputs();
            const payload = JSON.parse(JSON.stringify(q));
            payload.quiz_id = quiz.id;
            if (payload.type === 'numeric') {
              payload.data.value = String(payload.data.value).replace(/\s/g, '').replace(',', '.').replace('−', '-');
              payload.data.tolerance = String(payload.data.tolerance || '0').replace(',', '.');
            }
            if (payload.type === 'short') payload.data.answers = payload.data.answers.filter((a) => a.trim());
            try {
              await QZ.call('t_question_save', payload);
            } catch (err) {
              const box = $('.error-box', mm.el);
              box.textContent = err.message;
              box.hidden = false;
              return false;
            }
            mm.close();
            QZ.toast(existing ? 'Question enregistrée' : 'Question ajoutée', 'good');
            await reloadQuiz();
          }
        }]
      });
      const el = m.el;
      delegate(el, 'click', '[data-type]', (e, t) => { syncFromInputs(); const prev = { ...q }; q.type = t.dataset.type; q.data = defaultsFor(q.type, prev); redraw(); });
      delegate(el, 'click', '[data-cok]', (e, t) => {
        syncFromInputs();
        const i = +t.dataset.cok;
        if (q.type === 'single') q.data.choices.forEach((c, k) => { c.correct = k === i; });
        else q.data.choices[i].correct = !q.data.choices[i].correct;
        redraw();
      });
      delegate(el, 'click', '[data-crm]', (e, t) => { syncFromInputs(); q.data.choices.splice(+t.dataset.crm, 1); if (q.type === 'single' && !q.data.choices.some((c) => c.correct)) q.data.choices[0].correct = true; redraw(); });
      delegate(el, 'click', '[data-cadd]', () => { syncFromInputs(); q.data.choices.push({ id: 'c' + rid(), text: '', correct: false }); redraw(); const ins = $$('[data-ctext]', el); ins[ins.length - 1].focus(); });
      delegate(el, 'click', '[data-tf]', (e, t) => { syncFromInputs(); q.data.answer = t.dataset.tf === '1'; redraw(); });
      delegate(el, 'click', '[data-aadd]', () => { syncFromInputs(); q.data.answers.push(''); redraw(); });
      delegate(el, 'click', '[data-arm]', (e, t) => { syncFromInputs(); q.data.answers.splice(+t.dataset.arm, 1); redraw(); });
      delegate(el, 'click', '[data-iadd]', () => { syncFromInputs(); q.data.items.push({ id: 'i' + rid(), text: '' }); redraw(); });
      delegate(el, 'click', '[data-irm]', (e, t) => { syncFromInputs(); q.data.items.splice(+t.dataset.irm, 1); redraw(); });
      delegate(el, 'click', '[data-iup]', (e, t) => { syncFromInputs(); const i = +t.dataset.iup; const it = q.data.items; [it[i - 1], it[i]] = [it[i], it[i - 1]]; redraw(); });
      delegate(el, 'click', '[data-rmimg]', () => { syncFromInputs(); q.image = null; redraw(); });
      delegate(el, 'change', '#qe-img', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        syncFromInputs();
        if (file.size > 6 * 1024 * 1024) return QZ.toast('Image trop lourde (6 Mo maximum).', 'bad');
        try {
          const up = QZ.backend ? await QZ.upload(await resizeToDataUrl(file)) : await QZ.upload(file);
          q.image = up.file;
          redraw();
        } catch (err) { QZ.fail(err); }
      });
    }
  });

  /* Demo mode stores images inline: shrink them first. */
  function resizeToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Image illisible.'));
      img.src = url;
    });
  }

  QZ.route('/prof/apercu/:id', ({ id }) => {
    if (!QZ.state.user || QZ.state.user.role !== 'teacher') return QZ.go(QZ.home(), { replace: true });
    QZ.stopTeacherAlerts();
    QZ.onCleanup(() => QZ.startTeacherAlerts());
    QZ.player(+id, { preview: true });
  });
})(window.QZ = window.QZ || {});
