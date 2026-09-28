/* Quiz SES — espace professeure : navigation, alertes temps réel, tableau de bord, quiz, élèves, paramètres. */
(function (QZ) {
  'use strict';
  const { html, icon, mount, $, $$, delegate, fmt } = QZ;

  const NAV = [
    { id: 'home', path: '/prof', label: 'Tableau de bord', short: 'Accueil', icon: 'home' },
    { id: 'quiz', path: '/prof/quiz', label: 'Mes quiz', short: 'Quiz', icon: 'list' },
    { id: 'live', path: '/prof/direct', label: 'En direct', short: 'Direct', icon: 'live' },
    { id: 'students', path: '/prof/eleves', label: 'Élèves', short: 'Élèves', icon: 'users' },
    { id: 'settings', path: '/prof/parametres', label: 'Paramètres', short: 'Réglages', icon: 'gear' }
  ];

  /* ---------------- Real-time alerts (all teacher pages) ---------------- */
  const AL = { since: null, timer: null, live: 0, locked: 0, pending: 0 };
  QZ.alertCounts = AL;
  async function pollAlerts() {
    if (!QZ.state.user || QZ.state.user.role !== 'teacher') return QZ.stopTeacherAlerts();
    let d;
    try { d = await QZ.call('t_alerts', AL.since === null ? {} : { since: AL.since }); } catch (e) { return; }
    AL.since = d.last_id;
    AL.live = d.live; AL.locked = d.locked; AL.pending = d.pending;
    updateBadges();
    d.alerts.forEach(notify);
  }
  function notify(a) {
    window.dispatchEvent(new CustomEvent('qz-alert', { detail: a }));
    if (QZ.store.get('alertSound', true)) QZ.beep('alert');
    const locked = a.attempt_status === 'locked';
    QZ.toast(a.name + ' — ' + a.label, 'alert', {
      sub: a.quiz + (locked ? ' · quiz verrouillé' : '') + (a.detail ? ' · ' + a.detail : ''),
      action: { label: 'Voir', onClick: () => QZ.go('/prof/direct/' + a.quiz_id) },
      duration: 10000
    });
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
        new Notification('Triche possible : ' + a.name, { body: a.label + ' — ' + a.quiz, tag: 'qz-' + a.id });
      }
    } catch (e) { /* ignore */ }
  }
  function updateBadges() {
    $$('[data-badge="live"]').forEach((el) => {
      el.innerHTML = AL.locked ? `<span class="badge">${AL.locked}</span>` : AL.live ? '<span class="live-dot"></span>' : '';
    });
    $$('[data-badge="pending"]').forEach((el) => { el.innerHTML = AL.pending ? `<span class="badge">${AL.pending}</span>` : ''; });
  }
  QZ.startTeacherAlerts = () => { if (AL.timer) return; pollAlerts(); AL.timer = setInterval(pollAlerts, 4000); };
  QZ.stopTeacherAlerts = () => { clearInterval(AL.timer); AL.timer = null; AL.since = null; };

  /* ---------------- Shell ---------------- */
  QZ.teacherPage = function (active) {
    const u = QZ.state.user;
    if (!u || u.role !== 'teacher') { QZ.go(QZ.home(), { replace: true }); return null; }
    const s = QZ.state.settings;
    const badge = (id) => (id === 'live' ? html`<span data-badge="live"></span>` : id === 'students' ? html`<span data-badge="pending"></span>` : '');
    const root = QZ.root();
    mount(root, html`<div class="shell">
      <aside class="side">
        <div class="brand-mark" style="font-family:var(--font-display);font-weight:800;padding:4px 6px">${QZ.brandLogo()}<span>${s.site_name}</span></div>
        <nav>${NAV.map((n) => html`<a class="nav-link ${active === n.id ? 'active' : ''}" href="#${n.path}" data-go="${n.path}">${icon(n.icon)}<span>${n.label}</span>${badge(n.id)}</a>`)}</nav>
        <div class="side-foot">
          <div class="who"><span class="avatar">${fmt.initials(u.first_name)}</span><div class="grow"><b>${s.teacher_name}</b><div class="small muted">Professeure de SES</div></div></div>
          <button class="btn btn-ghost btn-sm" data-logout style="justify-content:flex-start">${icon('logout', 'icon-sm')}Se déconnecter</button>
        </div>
      </aside>
      <div style="min-width:0">
        <header class="topbar"><div class="brand-mark" style="font-family:var(--font-display);font-weight:800">${QZ.brandLogo()}<span>${s.site_name}</span></div><button class="btn btn-ghost btn-sm" data-logout>${icon('logout', 'icon-sm')}</button></header>
        <main class="main" id="tmain"><div class="loading"><div class="spinner"></div></div></main>
      </div>
      <nav class="bottom-nav">${NAV.map((n) => html`<a class="${active === n.id ? 'active' : ''}" href="#${n.path}" data-go="${n.path}">${icon(n.icon)}<span>${n.short}</span>${badge(n.id)}</a>`)}</nav>
    </div>`);
    delegate(root, 'click', '[data-go]', (e, t) => { e.preventDefault(); QZ.go(t.dataset.go); });
    delegate(root, 'click', '[data-logout]', () => QZ.logout());
    QZ.startTeacherAlerts();
    updateBadges();
    return $('#tmain', root);
  };

  /* ---------------- Dashboard ---------------- */
  QZ.route('/prof', async () => {
    const main = QZ.teacherPage('home');
    if (!main) return;
    let d;
    try { d = await QZ.call('t_overview'); } catch (e) { return QZ.fail(e); }
    const s = d.stats;
    const draw = () => mount(main, html`
      <div class="page-head"><div><h1>Bonjour ${QZ.state.user.first_name}</h1><p class="sub">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
        <div class="row"><button class="btn" data-go="/prof/direct">${icon('live', 'icon-sm')}Surveiller en direct</button><button class="btn btn-primary" data-new>${icon('plus', 'icon-sm')}Nouveau quiz</button></div></div>
      <div class="stats">
        <div class="stat"><span class="v">${s.students}</span><span class="k">Élèves actifs</span></div>
        <div class="stat ${s.pending ? 'alert' : ''}"><span class="v">${s.pending}</span><span class="k">Comptes à valider</span></div>
        <div class="stat"><span class="v">${s.quizzes_open}</span><span class="k">Quiz ouverts / ${s.quizzes_total}</span></div>
        <div class="stat"><span class="v">${s.live}</span><span class="k">Copies en cours</span></div>
        <div class="stat ${s.locked ? 'alert' : ''}"><span class="v">${s.locked}</span><span class="k">Copies verrouillées</span></div>
        <div class="stat"><span class="v">${s.finished_today}</span><span class="k">Copies rendues aujourd’hui</span></div>
      </div>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
        <section class="card">
          <div class="card-head"><h2>Comptes à valider</h2>${d.pending_students.length ? html`<button class="btn btn-sm btn-good" data-validate-all>${icon('check', 'icon-sm')}Tout valider</button>` : ''}</div>
          ${d.pending_students.length ? html`<div class="stack-sm">${d.pending_students.map((p) => html`<div class="row-between"><span><b>${p.name}</b> <span class="small muted">${fmt.dateS(p.created_at)}</span></span><span class="row"><button class="btn btn-sm" data-validate="${p.id}">Valider</button><button class="btn btn-sm btn-ghost" data-refuse="${p.id}" aria-label="Refuser">${icon('x', 'icon-sm')}</button></span></div>`)}</div>` : html`<p class="muted">Aucun compte en attente.</p>`}
        </section>
        <section class="card">
          <div class="card-head"><h2>Dernières alertes</h2><button class="btn btn-sm btn-ghost" data-go="/prof/direct">Direct</button></div>
          ${d.alerts.length ? html`<div class="feed">${d.alerts.map((a) => html`<div class="feed-item counted">${icon('alert')}<div class="grow"><b>${a.name}</b> — ${a.label}<div class="t">${a.quiz} · ${fmt.date(a.created_ms)}</div></div></div>`)}</div>` : html`<p class="muted">Aucune triche détectée pour l’instant.</p>`}
        </section>
        <section class="card">
          <div class="card-head"><h2>Dernières copies</h2></div>
          ${d.recent.length ? html`<div class="stack-sm">${d.recent.map((r) => html`<a class="row-between" href="#/prof/copie/${r.attempt_id}" data-go="/prof/copie/${r.attempt_id}" style="color:inherit;text-decoration:none;padding:6px 0;border-bottom:1px solid var(--line)"><span><b>${r.name}</b><div class="small muted">${r.quiz} · ${fmt.date(r.finished_ms)}</div></span><span class="row">${r.exits ? html`<span class="pill pill-bad">${r.exits} sortie${r.exits > 1 ? 's' : ''}</span>` : ''}<span class="note ${fmt.noteClass(r.zeroed ? 0 : r.note20)}">${r.zeroed ? '0' : fmt.note(r.note20)}</span></span></a>`)}</div>` : html`<p class="muted">Aucune copie rendue pour le moment.</p>`}
        </section>
      </div>`);
    draw();
    delegate(main, 'click', '[data-new]', () => QZ.go('/prof/quiz/nouveau'));
    delegate(main, 'click', '[data-validate]', async (e, t) => { try { await QZ.call('t_student_action', { student_id: +t.dataset.validate, action: 'validate' }); QZ.toast('Compte validé', 'good'); QZ.go('/prof', { replace: true }); } catch (err) { QZ.fail(err); } });
    delegate(main, 'click', '[data-refuse]', async (e, t) => {
      if (!(await QZ.confirm({ title: 'Refuser ce compte ?', message: 'Le compte sera supprimé définitivement.', confirmLabel: 'Supprimer', danger: true }))) return;
      try { await QZ.call('t_student_action', { student_id: +t.dataset.refuse, action: 'delete' }); QZ.go('/prof', { replace: true }); } catch (err) { QZ.fail(err); }
    });
    delegate(main, 'click', '[data-validate-all]', async () => {
      try { await QZ.call('t_students_bulk', { action: 'validate', ids: d.pending_students.map((p) => p.id) }); QZ.toast('Comptes validés', 'good'); QZ.go('/prof', { replace: true }); } catch (err) { QZ.fail(err); }
    });
  });

  /* ---------------- Quizzes list ---------------- */
  QZ.route('/prof/quiz', async () => {
    const main = QZ.teacherPage('quiz');
    if (!main) return;
    let filter = QZ.store.get('quizFilter', 'all');
    let d;
    const load = async () => { d = await QZ.call('t_quizzes'); draw(); };
    const draw = () => {
      const list = d.quizzes.filter((q) => filter === 'all' ? q.status !== 'archived' : q.status === filter);
      const count = (st) => d.quizzes.filter((q) => (st === 'all' ? q.status !== 'archived' : q.status === st)).length;
      mount(main, html`
        <div class="page-head"><div><h1>Mes quiz</h1><p class="sub">${fmt.plural(d.quizzes.length, 'quiz', 'quiz')}</p></div>
          <div class="row"><button class="btn" data-import>${icon('upload', 'icon-sm')}Importer</button><button class="btn btn-primary" data-new>${icon('plus', 'icon-sm')}Nouveau quiz</button></div></div>
        <div class="chips-bar">${[['all', 'Tous'], ['open', 'Ouverts'], ['draft', 'Brouillons'], ['closed', 'Fermés'], ['archived', 'Archivés']].map(([k, l]) => html`<button class="chip-filter ${filter === k ? 'active' : ''}" data-filter="${k}">${l} <b>${count(k)}</b></button>`)}</div>
        ${list.length ? html`<div class="qcards">${list.map((q) => html`<article class="qcard">
          <div class="qcard-top lvl-${q.level}"><div class="row-between"><span class="pill">${q.level || 'SES'}</span>${q.running_count ? html`<span class="pill" style="background:#e21b3c">${q.running_count} en cours</span>` : ''}</div><h3>${q.title}</h3></div>
          <div class="qcard-body">
            <div class="row">${QZ.quizStatusPill(q.status)}${q.access_code ? html`<span class="pill pill-accent">${icon('lock', 'icon-sm')}${q.access_code}</span>` : ''}${q.results_released ? html`<span class="pill pill-good">Résultats publiés</span>` : ''}</div>
            <div class="qcard-meta"><span>${icon('list', 'icon-sm')}${fmt.plural(q.question_count, 'question', 'questions')}</span><span>${icon('users', 'icon-sm')}${fmt.plural(q.finished_count, 'copie', 'copies')}</span>${q.avg20 !== null ? html`<span>${icon('bars', 'icon-sm')}moy. ${fmt.note(q.avg20)}/20</span>` : ''}</div>
            ${q.classes.length ? html`<p class="small muted">Classes : ${q.classes.join(', ')}</p>` : ''}
            <div class="qcard-foot">
              <div class="row" style="gap:6px"><button class="btn btn-sm" data-edit="${q.id}">${icon('edit', 'icon-sm')}Modifier</button><button class="btn btn-sm" data-results="${q.id}">${icon('bars', 'icon-sm')}Résultats</button></div>
              <div class="row" style="gap:6px"><button class="btn btn-sm ${q.status === 'open' ? 'btn-primary' : ''}" data-live="${q.id}">${icon('live', 'icon-sm')}Direct</button><button class="btn btn-sm btn-ghost btn-icon" data-more="${q.id}" aria-label="Plus d’actions">${icon('menu', 'icon-sm')}</button></div>
            </div>
          </div></article>`)}</div>` : html`<div class="card empty">${icon('list')}<p>Aucun quiz dans cette catégorie.</p><button class="btn btn-primary" data-new>${icon('plus', 'icon-sm')}Créer un quiz</button></div>`}`);
    };
    try { await load(); } catch (e) { return QZ.fail(e); }
    delegate(main, 'click', '[data-filter]', (e, t) => { filter = t.dataset.filter; QZ.store.set('quizFilter', filter); draw(); });
    delegate(main, 'click', '[data-new]', () => QZ.go('/prof/quiz/nouveau'));
    delegate(main, 'click', '[data-edit]', (e, t) => QZ.go('/prof/quiz/' + t.dataset.edit));
    delegate(main, 'click', '[data-results]', (e, t) => QZ.go('/prof/resultats/' + t.dataset.results));
    delegate(main, 'click', '[data-live]', (e, t) => QZ.go('/prof/direct/' + t.dataset.live));
    delegate(main, 'click', '[data-import]', () => importQuizFile(load));
    delegate(main, 'click', '[data-more]', (e, t) => {
      const q = d.quizzes.find((x) => String(x.id) === t.dataset.more);
      QZ.quizMenu(q, load);
    });
  });

  QZ.quizMenu = function (q, reload) {
    const setStatus = (status) => async () => { await QZ.call('t_quiz_status', { quiz_id: q.id, status }); QZ.toast('Statut mis à jour', 'good'); reload(); };
    const acts = [];
    if (q.status !== 'open') acts.push({ label: 'Ouvrir aux élèves', icon: 'play', kind: 'primary', onClick: setStatus('open') });
    if (q.status === 'open') acts.push({ label: 'Fermer le quiz', icon: 'stop', onClick: setStatus('closed') });
    acts.push({ label: 'Dupliquer', icon: 'copy', onClick: async () => { const r = await QZ.call('t_quiz_duplicate', { quiz_id: q.id }); QZ.toast('Quiz dupliqué', 'good'); QZ.go('/prof/quiz/' + r.id); } });
    acts.push({ label: 'Exporter (fichier)', icon: 'download', onClick: () => QZ.download('t_quiz_export_json', { quiz_id: q.id }, 'Export du quiz') });
    if (q.status !== 'archived') acts.push({ label: 'Archiver', icon: 'doc', onClick: setStatus('archived') });
    else acts.push({ label: 'Désarchiver', icon: 'doc', onClick: setStatus('closed') });
    acts.push({
      label: 'Supprimer', icon: 'trash', kind: 'danger', close: false,
      onClick: async (m) => {
        if (!(await QZ.confirm({ title: 'Supprimer « ' + q.title + ' » ?', message: 'Les questions et toutes les copies des élèves seront supprimées définitivement.', confirmLabel: 'Supprimer', danger: true }))) return false;
        await QZ.call('t_quiz_delete', { quiz_id: q.id });
        m.close();
        QZ.toast('Quiz supprimé');
        reload();
      }
    });
    QZ.modal({ title: q.title, body: html`<div class="row">${QZ.quizStatusPill(q.status)}<span class="muted small">${fmt.plural(q.question_count, 'question', 'questions')}</span></div>`, actions: acts });
  };

  function importQuizFile(reload) {
    QZ.modal({
      title: 'Importer un quiz',
      body: html`<p class="muted">Choisis un fichier de quiz exporté depuis ce site (format .json). Il sera ajouté en brouillon.</p>
        <input type="file" id="imp-file" accept=".json,application/json" class="input">
        <div class="field"><label for="imp-json">…ou colle son contenu</label><textarea class="textarea" id="imp-json" rows="6" placeholder='{"format":"quiz-ses/1", …}'></textarea></div>`,
      actions: [{ label: 'Annuler' }, {
        label: 'Importer', kind: 'primary', onClick: async (m) => {
          const f = $('#imp-file', m.el).files[0];
          const text = f ? await f.text() : $('#imp-json', m.el).value;
          if (!text.trim()) throw new Error('Choisis un fichier.');
          const r = await QZ.call('t_quiz_import_json', { json: text });
          QZ.toast('Quiz importé', 'good');
          QZ.go('/prof/quiz/' + r.id);
        }
      }]
    });
  }

  /* ---------------- Students ---------------- */
  QZ.route('/prof/eleves', async () => {
    const main = QZ.teacherPage('students');
    if (!main) return;
    let d;
    let settings;
    const ui = { q: '', cls: 'all', st: 'all', sel: new Set() };
    const load = async () => {
      [d, settings] = await Promise.all([QZ.call('t_students'), QZ.call('t_settings')]);
      draw();
    };
    const visible = () => d.students.filter((s) => {
      if (ui.st !== 'all' && s.status !== ui.st) return false;
      if (ui.cls === 'none' && s.class_id !== null) return false;
      if (ui.cls !== 'all' && ui.cls !== 'none' && String(s.class_id) !== ui.cls) return false;
      if (ui.q && !(s.first_name + ' ' + s.last_name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(ui.q)) return false;
      return true;
    });
    const statusPill = (s) => s.status === 'pending' ? html`<span class="pill pill-warn">À valider</span>` : s.status === 'disabled' ? html`<span class="pill pill-bad">Désactivé</span>` : html`<span class="pill pill-good">Actif</span>`;
    const draw = () => {
      const list = visible();
      const pending = d.students.filter((s) => s.status === 'pending').length;
      const st = settings.settings;
      mount(main, html`
        <div class="page-head"><div><h1>Élèves</h1><p class="sub">${fmt.plural(d.students.length, 'compte', 'comptes')}${pending ? ' · ' + pending + ' à valider' : ''}</p></div>
          <div class="row"><button class="btn" data-classes>${icon('school', 'icon-sm')}Classes (${d.classes.length})</button>${pending ? html`<button class="btn btn-good" data-validate-all>${icon('check', 'icon-sm')}Valider les ${pending} comptes</button>` : ''}</div></div>
        <div class="card-flat form-grid">
          <label class="switch"><input type="checkbox" id="s-reg" ${st.allow_registration ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Inscriptions ouvertes</b><span class="hint">Ferme-les une fois toutes tes classes inscrites : plus personne ne pourra créer de compte.</span></span></label>
          <label class="switch"><input type="checkbox" id="s-val" ${st.require_validation ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Validation des nouveaux comptes</b><span class="hint">Un élève ne peut passer de quiz qu’après ta validation.</span></span></label>
        </div>
        <div class="row">
          <div style="position:relative" class="grow"><input class="input" id="s-q" placeholder="Rechercher un élève…" value="${ui.q}" style="padding-left:40px"><span style="position:absolute;left:12px;top:12px;color:var(--muted)">${icon('search', 'icon-sm')}</span></div>
          <select class="select" id="s-cls" style="width:auto"><option value="all">Toutes les classes</option><option value="none" ${ui.cls === 'none' ? 'selected' : ''}>Sans classe</option>${d.classes.map((c) => html`<option value="${c.id}" ${ui.cls === String(c.id) ? 'selected' : ''}>${c.name}</option>`)}</select>
          <select class="select" id="s-st" style="width:auto">${[['all', 'Tous les statuts'], ['pending', 'À valider'], ['active', 'Actifs'], ['disabled', 'Désactivés']].map(([k, l]) => html`<option value="${k}" ${ui.st === k ? 'selected' : ''}>${l}</option>`)}</select>
        </div>
        ${ui.sel.size ? html`<div class="card-flat row"><b>${ui.sel.size} sélectionné(s)</b><button class="btn btn-sm" data-bulk="validate">Valider</button><button class="btn btn-sm" data-bulk="class">Changer de classe</button><button class="btn btn-sm btn-danger" data-bulk="delete">Supprimer</button><button class="btn btn-sm btn-ghost" data-bulk="clear">Désélectionner</button></div>` : ''}
        ${list.length ? html`<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th style="width:36px"><input type="checkbox" id="s-all" aria-label="Tout sélectionner"></th><th>Élève</th><th>Classe</th><th>Statut</th><th class="num">Copies</th><th class="num">Moyenne</th><th class="num">Sorties</th><th>Dernière connexion</th><th></th></tr></thead>
          <tbody>${list.map((s) => html`<tr>
            <td><input type="checkbox" data-sel="${s.id}" ${ui.sel.has(s.id) ? 'checked' : ''} aria-label="Sélectionner"></td>
            <td><a href="#/prof/eleve/${s.id}" data-go="/prof/eleve/${s.id}"><b>${s.last_name.toUpperCase()}</b> ${s.first_name}</a>${s.must_change_password ? html`<div class="small muted">mot de passe provisoire</div>` : ''}</td>
            <td><select class="select" data-class="${s.id}" style="min-height:34px;padding:4px 8px;width:auto;font-size:.88rem"><option value="0">—</option>${d.classes.map((c) => html`<option value="${c.id}" ${s.class_id === c.id ? 'selected' : ''}>${c.name}</option>`)}</select></td>
            <td>${statusPill(s)}</td>
            <td class="num">${s.finished}</td>
            <td class="num"><span class="note ${fmt.noteClass(s.avg20)}">${fmt.note(s.avg20)}</span></td>
            <td class="num">${s.exits ? html`<span class="pill pill-bad">${s.exits}</span>` : '0'}</td>
            <td class="nowrap small">${fmt.dateS(s.last_login_at)}</td>
            <td class="nowrap">${s.status === 'pending' ? html`<button class="btn btn-sm btn-good" data-act="validate" data-id="${s.id}">Valider</button>` : ''}<button class="btn btn-sm btn-ghost btn-icon" data-menu="${s.id}" aria-label="Actions">${icon('menu', 'icon-sm')}</button></td>
          </tr>`)}</tbody></table></div>` : html`<div class="card empty">${icon('users')}<p>${d.students.length ? 'Aucun élève ne correspond.' : 'Aucun élève inscrit. Donne l’adresse du site à tes classes : ils créent leur compte avec prénom, nom et mot de passe.'}</p></div>`}`);
      const qInput = $('#s-q', main);
      qInput.addEventListener('input', () => { ui.q = qInput.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); const pos = qInput.selectionStart; draw(); const n = $('#s-q', main); n.focus(); n.setSelectionRange(pos, pos); });
      $('#s-cls', main).addEventListener('change', (e) => { ui.cls = e.target.value; draw(); });
      $('#s-st', main).addEventListener('change', (e) => { ui.st = e.target.value; draw(); });
      const all = $('#s-all', main);
      if (all) all.addEventListener('change', () => { list.forEach((s) => (all.checked ? ui.sel.add(s.id) : ui.sel.delete(s.id))); draw(); });
      const saveSetting = async () => {
        try {
          await QZ.call('t_settings_save', { ...settings.settings, allow_registration: $('#s-reg', main).checked, require_validation: $('#s-val', main).checked });
          settings.settings.allow_registration = $('#s-reg', main).checked;
          settings.settings.require_validation = $('#s-val', main).checked;
          QZ.state.settings.allow_registration = settings.settings.allow_registration;
          QZ.toast('Réglage enregistré', 'good');
        } catch (e) { QZ.fail(e); }
      };
      $('#s-reg', main).addEventListener('change', saveSetting);
      $('#s-val', main).addEventListener('change', saveSetting);
    };
    try { await load(); } catch (e) { return QZ.fail(e); }
    delegate(main, 'change', '[data-sel]', (e, t) => { const id = +t.dataset.sel; if (t.checked) ui.sel.add(id); else ui.sel.delete(id); draw(); });
    delegate(main, 'change', '[data-class]', async (e, t) => {
      try { await QZ.call('t_student_action', { student_id: +t.dataset.class, action: 'class', class_id: +t.value }); QZ.toast('Classe mise à jour', 'good'); const s = d.students.find((x) => x.id === +t.dataset.class); s.class_id = +t.value || null; } catch (err) { QZ.fail(err); }
    });
    delegate(main, 'click', '[data-act="validate"]', async (e, t) => { try { await QZ.call('t_student_action', { student_id: +t.dataset.id, action: 'validate' }); await load(); } catch (err) { QZ.fail(err); } });
    delegate(main, 'click', '[data-validate-all]', async () => {
      try { await QZ.call('t_students_bulk', { action: 'validate', ids: d.students.filter((s) => s.status === 'pending').map((s) => s.id) }); QZ.toast('Comptes validés', 'good'); await load(); } catch (err) { QZ.fail(err); }
    });
    delegate(main, 'click', '[data-menu]', (e, t) => QZ.studentMenu(d.students.find((s) => s.id === +t.dataset.menu), load));
    delegate(main, 'click', '[data-classes]', () => QZ.classesModal(load));
    delegate(main, 'click', '[data-bulk]', async (e, t) => {
      const act = t.dataset.bulk;
      const ids = Array.from(ui.sel);
      try {
        if (act === 'clear') { ui.sel.clear(); return draw(); }
        if (act === 'delete' && !(await QZ.confirm({ title: 'Supprimer ' + ids.length + ' élève(s) ?', message: 'Leurs comptes et toutes leurs copies seront supprimés définitivement.', confirmLabel: 'Supprimer', danger: true }))) return;
        if (act === 'class') {
          const cid = await pickClass(d.classes);
          if (cid === null) return;
          await QZ.call('t_students_bulk', { action: 'class', ids, class_id: cid });
        } else {
          await QZ.call('t_students_bulk', { action: act, ids });
        }
        ui.sel.clear();
        QZ.toast('Modification enregistrée', 'good');
        await load();
      } catch (err) { QZ.fail(err); }
    });
  });

  function pickClass(classes) {
    return new Promise((resolve) => {
      let done = false;
      const m = QZ.modal({
        title: 'Choisir la classe',
        body: html`<select class="select" id="pc"><option value="0">Sans classe</option>${classes.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>`,
        actions: [{ label: 'Annuler' }, { label: 'Appliquer', kind: 'primary', onClick: (mm) => { done = true; resolve(+$('#pc', mm.el).value); } }]
      });
      m.onClose = () => { if (!done) resolve(null); };
    });
  }

  QZ.studentMenu = function (s, reload) {
    const act = (action, extra = {}) => QZ.call('t_student_action', { student_id: s.id, action, ...extra });
    QZ.modal({
      title: s.first_name + ' ' + s.last_name.toUpperCase(),
      body: html`<div class="row">${s.class_name ? html`<span class="pill">${s.class_name}</span>` : ''}<span class="small muted">Inscrit le ${fmt.dateS(s.created_at)}</span></div>`,
      actions: [
        { label: 'Voir ses copies', icon: 'doc', onClick: () => QZ.go('/prof/eleve/' + s.id) },
        {
          label: 'Réinitialiser le mot de passe', icon: 'key', onClick: async () => {
            const r = await act('reset_password');
            QZ.modal({
              title: 'Mot de passe provisoire',
              body: html`<p>Donne ce mot de passe à <b>${s.first_name}</b>. Il devra en choisir un nouveau à sa prochaine connexion.</p><div class="code-display" style="text-align:center;user-select:all">${r.temp_password}</div>`,
              actions: [{ label: 'Compris', kind: 'primary' }]
            });
            reload();
          }
        },
        {
          label: 'Corriger le nom', icon: 'edit', onClick: () => {
            QZ.modal({
              title: 'Corriger le nom',
              body: html`<div class="form-grid"><div class="field"><label for="rn-f">Prénom</label><input class="input" id="rn-f" value="${s.first_name}"></div><div class="field"><label for="rn-l">Nom</label><input class="input" id="rn-l" value="${s.last_name}"></div></div>`,
              actions: [{ label: 'Annuler' }, { label: 'Enregistrer', kind: 'primary', onClick: async (m) => { await act('rename', { first_name: $('#rn-f', m.el).value, last_name: $('#rn-l', m.el).value }); QZ.toast('Nom corrigé', 'good'); reload(); } }]
            });
          }
        },
        s.status === 'disabled'
          ? { label: 'Réactiver le compte', icon: 'unlock', onClick: async () => { await act('enable'); reload(); } }
          : { label: 'Désactiver le compte', icon: 'lock', onClick: async () => { await act('disable'); QZ.toast('Compte désactivé'); reload(); } },
        {
          label: 'Supprimer', icon: 'trash', kind: 'danger', close: false, onClick: async (m) => {
            if (!(await QZ.confirm({ title: 'Supprimer ce compte ?', message: 'Le compte et toutes les copies de ' + s.first_name + ' seront supprimés.', confirmLabel: 'Supprimer', danger: true }))) return false;
            await act('delete');
            m.close();
            reload();
          }
        }
      ]
    });
  };

  QZ.classesModal = function (reload) {
    const m = QZ.modal({
      title: 'Classes',
      body: html`<div id="cls-body"><div class="spinner"></div></div>`,
      actions: [{ label: 'Fermer', onClick: () => reload && reload() }]
    });
    const body = $('#cls-body', m.el);
    const draw = (classes) => {
      mount(body, html`<p class="muted small">Crée tes classes (ex : 2nde 3, 1ère SES 1) pour trier les élèves, filtrer les résultats et réserver un quiz à certaines classes.</p>
        <form class="row" id="cls-add"><input class="input grow" id="cls-name" placeholder="Nom de la classe" maxlength="60" style="width:auto"><button class="btn btn-primary" type="submit">${icon('plus', 'icon-sm')}Ajouter</button></form>
        <div class="stack-sm">${classes.length ? classes.map((c) => html`<div class="row-between card-flat" style="padding:10px 12px"><span><b>${c.name}</b> <span class="small muted">${fmt.plural(c.students, 'élève', 'élèves')}</span></span><span class="row"><button class="btn btn-sm btn-ghost btn-icon" data-rn="${c.id}" data-name="${c.name}" aria-label="Renommer">${icon('edit', 'icon-sm')}</button><button class="btn btn-sm btn-ghost btn-icon" data-del="${c.id}" data-name="${c.name}" aria-label="Supprimer">${icon('trash', 'icon-sm')}</button></span></div>`) : html`<p class="muted">Aucune classe pour l’instant.</p>`}</div>`);
      $('#cls-add', body).addEventListener('submit', async (e) => {
        e.preventDefault();
        try { const r = await QZ.call('t_class_save', { name: $('#cls-name', body).value }); draw(r.classes); } catch (err) { QZ.fail(err); }
      });
    };
    QZ.call('t_classes').then((r) => draw(r.classes)).catch(QZ.fail);
    delegate(body, 'click', '[data-rn]', async (e, t) => {
      const name = await QZ.promptText({ title: 'Renommer la classe', label: 'Nom', value: t.dataset.name });
      if (!name) return;
      try { const r = await QZ.call('t_class_save', { id: +t.dataset.rn, name }); draw(r.classes); } catch (err) { QZ.fail(err); }
    });
    delegate(body, 'click', '[data-del]', async (e, t) => {
      if (!(await QZ.confirm({ title: 'Supprimer « ' + t.dataset.name + ' » ?', message: 'Les élèves ne sont pas supprimés : ils deviennent « sans classe ».', confirmLabel: 'Supprimer', danger: true }))) return;
      try { const r = await QZ.call('t_class_delete', { class_id: +t.dataset.del }); draw(r.classes); } catch (err) { QZ.fail(err); }
    });
  };

  QZ.route('/prof/eleve/:id', async ({ id }) => {
    const main = QZ.teacherPage('students');
    if (!main) return;
    let d;
    try { d = await QZ.call('t_student', { student_id: +id }); } catch (e) { return QZ.fail(e); }
    const s = d.student;
    const done = d.attempts.filter((a) => a.status === 'finished' && !a.zeroed && a.note20 !== null);
    const avg = done.length ? done.reduce((x, a) => x + a.note20, 0) / done.length : null;
    mount(main, html`
      <div><button class="btn btn-ghost btn-sm" data-go="/prof/eleves">${icon('back', 'icon-sm')}Élèves</button></div>
      <div class="page-head"><div class="row"><span class="avatar" style="width:52px;height:52px;font-size:1.1rem">${fmt.initials(s.name)}</span><div><h1>${s.name}</h1><p class="sub">${s.class_name || 'Sans classe'} · inscrit le ${fmt.dateS(s.created_at)} · dernière connexion ${fmt.dateS(s.last_login_at)}</p></div></div>
        <button class="btn" data-menu>${icon('menu', 'icon-sm')}Actions</button></div>
      <div class="stats">
        <div class="stat"><span class="v">${d.attempts.length}</span><span class="k">Copies</span></div>
        <div class="stat"><span class="v note ${fmt.noteClass(avg)}">${fmt.note(avg)}</span><span class="k">Moyenne /20</span></div>
        <div class="stat ${d.attempts.some((a) => a.exits) ? 'alert' : ''}"><span class="v">${d.attempts.reduce((x, a) => x + a.exits, 0)}</span><span class="k">Sorties détectées</span></div>
      </div>
      ${d.attempts.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Quiz</th><th>Date</th><th>Statut</th><th class="num">Sorties</th><th class="num">Note</th></tr></thead>
        <tbody>${d.attempts.map((a) => html`<tr class="clickable" data-go="/prof/copie/${a.id}"><td><b>${a.title}</b>${a.attempt_no > 1 ? html` <span class="small muted">tentative ${a.attempt_no}</span>` : ''}</td><td class="nowrap">${fmt.date(a.started_ms)}</td><td>${QZ.statusPill(a.status, a.finish_reason, a.zeroed)}</td><td class="num">${a.exits ? html`<span class="pill pill-bad">${a.exits}</span>` : '0'}</td><td class="num"><span class="note ${fmt.noteClass(a.zeroed ? 0 : a.note20)}">${a.zeroed ? '0' : fmt.note(a.note20)}</span></td></tr>`)}</tbody></table></div>` : html`<div class="card empty">${icon('doc')}<p>Aucune copie pour cet élève.</p></div>`}`);
    delegate(main, 'click', '[data-menu]', () => QZ.studentMenu({ ...s, first_name: s.first_name, last_name: s.last_name }, () => QZ.go('/prof/eleve/' + id, { replace: true })));
  });

  /* ---------------- Settings ---------------- */
  QZ.route('/prof/parametres', async () => {
    const main = QZ.teacherPage('settings');
    if (!main) return;
    let s;
    let audit;
    try { [s, audit] = await Promise.all([QZ.call('t_settings'), QZ.call('t_audit')]); } catch (e) { return QZ.fail(e); }
    const st = s.settings;
    const LABELS = {
      login: 'Connexion', login_failed: 'Connexion refusée', password_changed: 'Mot de passe modifié', quiz_create: 'Quiz créé', quiz_update: 'Quiz modifié', quiz_delete: 'Quiz supprimé',
      quiz_status: 'Statut de quiz', quiz_duplicate: 'Quiz dupliqué', quiz_import: 'Quiz importé', results_released: 'Résultats publiés', results_hidden: 'Résultats masqués',
      attempt_unlock: 'Copie débloquée', attempt_lock: 'Copie verrouillée', attempt_warn: 'Avertissement', attempt_finish: 'Copie terminée', attempt_exclude: 'Élève exclu', attempt_unzero: 'Note rétablie', attempt_reset: 'Copie réinitialisée',
      broadcast: 'Message à la classe', quiz_end_all: 'Fin du quiz pour tous', answer_override: 'Points modifiés', student_password_reset: 'Mot de passe élève réinitialisé',
      student_delete: 'Élève supprimé', student_validate: 'Élève validé', student_disable: 'Élève désactivé', student_enable: 'Élève réactivé', student_class: 'Classe d’un élève', student_rename: 'Nom corrigé',
      class_save: 'Classe enregistrée', class_delete: 'Classe supprimée', settings_update: 'Paramètres modifiés'
    };
    mount(main, html`
      <div class="page-head"><div><h1>Paramètres</h1><p class="sub">Réglages du site et sécurité de ton compte.</p></div></div>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr));align-items:start">
        <form class="card stack" id="set-form">
          <h2>Site</h2>
          <div class="field"><label for="st-site">Nom du site</label><input class="input" id="st-site" value="${st.site_name}" maxlength="60"></div>
          <div class="field"><label for="st-teacher">Ton nom affiché aux élèves</label><input class="input" id="st-teacher" value="${st.teacher_name}" maxlength="60"></div>
          <label class="switch"><input type="checkbox" id="st-reg" ${st.allow_registration ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Inscriptions ouvertes</b><span class="hint">Les élèves peuvent créer leur compte.</span></span></label>
          <label class="switch"><input type="checkbox" id="st-val" ${st.require_validation ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Valider chaque nouveau compte</b><span class="hint">Empêche les faux comptes et les doublons.</span></span></label>
          <button class="btn btn-primary" type="submit">Enregistrer</button>
        </form>
        <section class="card stack">
          <h2>Sécurité et alertes</h2>
          <button class="btn" data-go="/mot-de-passe">${icon('key', 'icon-sm')}Changer mon mot de passe</button>
          <label class="switch"><input type="checkbox" id="st-sound" ${QZ.store.get('alertSound', true) ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Alerte sonore</b><span class="hint">Un bip retentit quand un élève sort du quiz ou triche.</span></span></label>
          <button class="btn" data-notif>${icon('bell', 'icon-sm')}Activer les notifications du navigateur</button>
          <div class="info-box">Ton adresse IP actuelle : <b class="num">${s.my_ip}</b><br><span class="small">Dans un quiz, tu peux n’autoriser que l’adresse du lycée : il ne pourra être passé qu’en classe.</span></div>
        </section>
      </div>
      <section class="stack">
        <h2>Journal d’activité</h2>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Action</th><th>Détail</th><th>IP</th></tr></thead>
        <tbody>${audit.entries.length ? audit.entries.map((a) => html`<tr><td class="nowrap small">${fmt.dateS(a.created_at)}</td><td class="nowrap">${a.action === 'login_failed' ? html`<span class="pill pill-bad">${LABELS[a.action]}</span>` : LABELS[a.action] || a.action}</td><td>${a.detail || ''}</td><td class="small muted num">${a.ip || ''}</td></tr>`) : html`<tr><td colspan="4" class="muted">Aucune activité.</td></tr>`}</tbody></table></div>
      </section>`);
    $('#set-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = { site_name: $('#st-site').value, teacher_name: $('#st-teacher').value, allow_registration: $('#st-reg').checked, require_validation: $('#st-val').checked };
        await QZ.call('t_settings_save', data);
        Object.assign(QZ.state.settings, data);
        QZ.toast('Paramètres enregistrés', 'good');
        QZ.go('/prof/parametres', { replace: true });
      } catch (err) { QZ.fail(err); }
    });
    $('#st-sound', main).addEventListener('change', (e) => { QZ.store.set('alertSound', e.target.checked); if (e.target.checked) { QZ.unlockAudio(); QZ.beep('warn'); } });
    delegate(main, 'click', '[data-notif]', async () => {
      if (!('Notification' in window)) return QZ.toast('Ton navigateur ne gère pas les notifications.', 'bad');
      try { const p = await Notification.requestPermission(); QZ.toast(p === 'granted' ? 'Notifications activées' : 'Notifications refusées', p === 'granted' ? 'good' : 'bad'); } catch (e) { QZ.toast('Notifications indisponibles ici.', 'bad'); }
    });
  });
})(window.QZ = window.QZ || {});
