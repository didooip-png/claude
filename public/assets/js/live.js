/* Quiz SES — surveillance en direct : progression de chaque élève, sorties, alertes, actions immédiates. */
(function (QZ) {
  'use strict';
  const { html, icon, mount, $, delegate, fmt } = QZ;

  const WARN_PRESETS = [
    'Reste sur le quiz : la prochaine sortie annulera ta copie.',
    'Range ton téléphone / ton deuxième appareil immédiatement.',
    'Silence, travail individuel uniquement.',
    'Dernier avertissement avant exclusion.',
    'Il reste 5 minutes.'
  ];

  QZ.route('/prof/direct', () => openLive(null));
  QZ.route('/prof/direct/:id', ({ id }) => openLive(+id));

  async function openLive(quizId) {
    const main = QZ.teacherPage('live');
    if (!main) return;
    const ui = {
      quizId, data: null, filter: 'all', since: 0, flash: new Set(), projection: QZ.store.get('liveProjection', false),
      incidents: [], busy: false
    };

    async function load() {
      if (ui.busy) return;
      ui.busy = true;
      try {
        const d = await QZ.call('t_live', { quiz_id: ui.quizId || 0, since: ui.since });
        if (!ui.quizId && d.quiz) ui.quizId = d.quiz.id;
        if (d.quiz && ui.data && ui.data.quiz && ui.data.quiz.id !== d.quiz.id) ui.incidents = [];
        const fresh = d.incidents || [];
        ui.incidents = fresh.concat(ui.incidents).slice(0, 120);
        ui.since = d.last_incident_id || ui.since;
        ui.data = d;
        safeDraw();
      } catch (e) {
        if (e.code !== 'network') QZ.fail(e);
      } finally {
        ui.busy = false;
      }
    }

    const counts = () => {
      const a = ui.data.attempts || [];
      return {
        all: a.length + (ui.data.not_started || []).length,
        running: a.filter((x) => x.status === 'in_progress').length,
        locked: a.filter((x) => x.status === 'locked').length,
        finished: a.filter((x) => x.status === 'finished').length,
        not_started: (ui.data.not_started || []).length,
        suspect: a.filter((x) => x.exits > 0).length
      };
    };

    function dotClass(ans) {
      if (ans.status === 'cancelled') return 'cx';
      if (ans.status === 'timeout') return 'to';
      if (ui.projection) return 'done';
      return ans.fraction >= 1 ? 'ok' : ans.fraction > 0 ? 'part' : 'ko';
    }

    function card(a) {
      const byPos = {};
      a.answers.forEach((x) => { byPos[x.pos] = x; });
      const dots = [];
      for (let i = 0; i < a.total; i++) {
        const x = byPos[i];
        if (x) dots.push(html`<span class="dot ${dotClass(x)}" title="Question ${i + 1}${x.n ? ' (n° ' + x.n + ' du quiz)' : ''} · ${x.status === 'cancelled' ? 'annulée (sortie)' : x.status === 'timeout' ? 'temps écoulé' : ui.projection ? 'répondue' : x.fraction >= 1 ? 'juste' : x.fraction > 0 ? 'partiel' : 'faux'}${x.time_ms !== null ? ' · ' + fmt.dur(x.time_ms) : ''}"></span>`);
        else if (i === a.index && a.status === 'in_progress') dots.push(html`<span class="dot cur" title="Question en cours"></span>`);
        else dots.push(html`<span class="dot" title="Question ${i + 1} à venir"></span>`);
      }
      const qPct = a.q_limit_ms && a.q_elapsed_ms !== null ? Math.min(100, (a.q_elapsed_ms / a.q_limit_ms) * 100) : 0;
      const stCls = a.status === 'locked' ? 'st-locked' : '';
      const flash = ui.flash.has(a.id) ? 'st-flash' : '';
      const avgTime = (() => { const t = a.answers.filter((x) => x.status === 'answered' && x.time_ms !== null); return t.length ? t.reduce((s, x) => s + x.time_ms, 0) / t.length : null; })();
      return html`<article class="scard ${stCls} ${flash}" data-card="${a.id}">
        <div class="scard-head">
          <span class="online ${a.online ? 'on' : ''}" title="${a.online ? 'Connecté' : 'Hors ligne depuis ' + fmt.dur(a.last_seen_ago_ms)}"></span>
          <div class="grow"><div class="name">${a.name}</div><div class="sub">${QZ.deviceIcon(a.device)}${a.device || ''}${a.class_name ? ' · ' + a.class_name : ''}${a.attempt_no > 1 ? ' · tentative ' + a.attempt_no : ''}</div></div>
          ${QZ.statusPill(a.status, a.finish_reason, a.zeroed)}
        </div>
        ${a.status === 'locked' ? html`<div class="error-box small">${icon('lock', 'icon-sm')} ${a.lock_reason || 'Verrouillé'}</div>` : ''}
        <div class="dots">${dots}</div>
        ${a.status === 'in_progress' && a.current_q ? html`<div class="stack-sm"><div class="row-between small"><span>Question ${a.index + 1}/${a.total}</span><span class="num">${fmt.dur(a.q_elapsed_ms)}${a.q_limit_ms ? ' / ' + fmt.dur(a.q_limit_ms) : ''}</span></div><div class="qbar ${qPct > 80 ? 'hurry' : ''}"><i style="width:${qPct}%"></i></div></div>` : ''}
        <div class="scard-stats">
          <span class="${a.exits ? 'bad' : ''}">${icon('shieldx', 'icon-sm')}${fmt.plural(a.exits, 'sortie', 'sorties')}</span>
          ${a.away_ms ? html`<span class="bad">${icon('clock', 'icon-sm')}${fmt.dur(a.away_ms)} hors quiz</span>` : ''}
          <span>${icon('alert', 'icon-sm')}${a.incidents}</span>
          ${avgTime !== null ? html`<span>${icon('clock', 'icon-sm')}moy. ${fmt.dur(avgTime)}</span>` : ''}
          ${a.status === 'finished' && !ui.projection ? html`<span class="note ${fmt.noteClass(a.zeroed ? 0 : a.note20)}">${a.zeroed ? '0' : fmt.note(a.note20)}/20</span>` : ''}
          ${a.warning_pending ? html`<span class="pill pill-warn">avertissement non lu</span>` : ''}
        </div>
        <div class="scard-actions">
          ${a.status === 'locked' ? html`<button class="btn btn-sm btn-good" data-a="unlock" data-id="${a.id}">${icon('unlock', 'icon-sm')}Débloquer</button>` : ''}
          ${a.status !== 'finished' ? html`<button class="btn btn-sm btn-warn" data-a="warn" data-id="${a.id}">${icon('msg', 'icon-sm')}Avertir</button>` : ''}
          ${a.status === 'in_progress' ? html`<button class="btn btn-sm" data-a="lock" data-id="${a.id}" title="Met le quiz en pause (la question en cours est annulée)">${icon('pause', 'icon-sm')}Pause</button>` : ''}
          ${a.status !== 'finished' ? html`<button class="btn btn-sm btn-danger" data-a="exclude" data-id="${a.id}">${icon('ban', 'icon-sm')}Exclure</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-a="more" data-id="${a.id}" aria-label="Plus">${icon('menu', 'icon-sm')}</button>
        </div>
      </article>`;
    }

    /* Never rebuild the page under the teacher's finger or while a dropdown is open. */
    function safeDraw() {
      const ae = document.activeElement;
      if (ui.down || (ae && main.contains(ae) && ae.tagName === 'SELECT')) { ui.dirty = true; return; }
      ui.dirty = false;
      draw();
    }
    const onDown = () => { ui.down = true; };
    const onUp = () => { ui.down = false; if (ui.dirty) setTimeout(safeDraw, 50); };
    main.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    QZ.onCleanup(() => { document.removeEventListener('pointerup', onUp); document.removeEventListener('pointercancel', onUp); });

    function draw() {
      const d = ui.data;
      if (!d.quiz) {
        mount(main, html`<div class="page-head"><div><h1>En direct</h1><p class="sub">Aucun quiz ouvert.</p></div></div>
          <div class="card empty">${icon('live')}<p>Ouvre un quiz pour suivre tes élèves en direct.</p><button class="btn btn-primary" data-go="/prof/quiz">Mes quiz</button></div>`);
        return;
      }
      const q = d.quiz;
      const c = counts();
      let list = d.attempts;
      if (ui.filter === 'running') list = list.filter((a) => a.status === 'in_progress');
      if (ui.filter === 'locked') list = list.filter((a) => a.status === 'locked');
      if (ui.filter === 'finished') list = list.filter((a) => a.status === 'finished');
      if (ui.filter === 'suspect') list = list.filter((a) => a.exits > 0);
      list = list.slice().sort((x, y) => (y.status === 'locked') - (x.status === 'locked') || y.exits - x.exits || x.name.localeCompare(y.name));
      const showNotStarted = ui.filter === 'all' || ui.filter === 'not_started';
      const scroll = window.scrollY;
      mount(main, html`
        <div class="page-head">
          <div><h1>En direct</h1><p class="sub row" style="gap:8px"><span class="pill pill-bad pill-live"><span class="dot"></span>Actualisé toutes les 2 s</span>${QZ.quizStatusPill(q.status)}</p></div>
          <div class="row">
            <select class="select" id="lv-quiz" style="width:auto;max-width:320px">${d.quizzes.map((x) => html`<option value="${x.id}" ${x.id === q.id ? 'selected' : ''}>${x.title}${x.running ? ' — ' + x.running + ' en cours' : ''}${x.status === 'closed' ? ' (fermé)' : ''}</option>`)}</select>
          </div>
        </div>
        <div class="card row-between">
          <div class="row">
            <div><div class="section-title">Code d’accès</div>${q.access_code ? html`<div class="code-display">${q.access_code}</div>` : html`<div class="muted">aucun</div>`}</div>
            <div><div class="section-title">Questions</div><div class="note" style="font-size:1.6rem">${q.question_count}</div></div>
            <div><div class="section-title">Règle de sortie</div><div class="small"><b>${q.exit_action === 'log' ? 'Signalement seul' : q.exit_action === 'submit' ? 'Copie terminée' : 'Verrouillage'}</b> ${q.exit_action !== 'log' ? (q.max_exits ? 'après ' + q.max_exits + ' sortie(s) tolérée(s)' : 'dès la 1re sortie') : ''}</div></div>
          </div>
          <div class="row">
            <label class="switch" title="Masque les bonnes/mauvaises réponses et les notes pour projeter l’écran au tableau"><input type="checkbox" id="lv-proj" ${ui.projection ? 'checked' : ''}><span class="track"></span><span class="txt"><b>Mode projection</b></span></label>
            <button class="btn btn-sm" data-broadcast>${icon('msg', 'icon-sm')}Message à tous</button>
            ${q.status === 'open' ? html`<button class="btn btn-sm" data-close-quiz>${icon('stop', 'icon-sm')}Fermer</button>` : html`<button class="btn btn-sm btn-primary" data-open-quiz>${icon('play', 'icon-sm')}Ouvrir</button>`}
            <button class="btn btn-sm btn-danger" data-end-all>${icon('flag', 'icon-sm')}Terminer pour tous</button>
            <button class="btn btn-sm" data-go="/prof/resultats/${q.id}">${icon('bars', 'icon-sm')}Résultats</button>
          </div>
        </div>
        <div class="chips-bar">${[['all', 'Tous', c.all], ['running', 'En cours', c.running], ['locked', 'Verrouillés', c.locked], ['suspect', 'Avec sorties', c.suspect], ['finished', 'Terminés', c.finished], ['not_started', 'Pas commencé', c.not_started]].map(([k, l, n]) => html`<button class="chip-filter ${ui.filter === k ? 'active' : ''}" data-filter="${k}" ${k === 'locked' && n ? 'style="border-color:var(--bad);color:var(--bad)"' : ''}>${l} <b>${n}</b></button>`)}</div>
        <div class="live-layout">
          <div class="stack">
            ${ui.filter !== 'not_started' ? (list.length ? html`<div class="live-cards">${list.map(card)}</div>` : html`<div class="card empty">${icon('users')}<p>${d.attempts.length ? 'Aucun élève dans ce filtre.' : 'Aucun élève n’a encore commencé ce quiz.'}</p></div>`) : ''}
            ${showNotStarted && d.not_started.length ? html`<section class="card-flat stack-sm"><div class="row-between"><h3>Pas encore commencé (${d.not_started.length})</h3><span class="small muted">élèves actifs${q.status !== 'open' ? ' · le quiz n’est pas ouvert' : ''}</span></div>
              <div class="row" style="gap:6px">${d.not_started.map((s) => html`<span class="pill">${s.name}${s.class_name ? ' · ' + s.class_name : ''}</span>`)}</div></section>` : ''}
          </div>
          <aside class="card stack-sm" style="position:sticky;top:16px">
            <div class="row-between"><h3>${icon('alert')} Journal en direct</h3><label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" id="lv-sound" ${QZ.store.get('alertSound', true) ? 'checked' : ''}>${icon('sound', 'icon-sm')}Son</label></div>
            <div class="feed">${ui.incidents.length ? ui.incidents.map((i) => html`<div class="feed-item ${i.counted ? 'counted' : ''}">${i.type === 'teacher' ? html`<span style="color:var(--accent)">${icon('user')}</span>` : i.counted ? icon('shieldx') : html`<span style="color:var(--muted)">${icon('info')}</span>`}<div class="grow"><b>${i.name}</b> — ${i.type === 'teacher' ? i.detail : i.label}${i.type !== 'teacher' && i.detail ? html`<div class="small muted">${i.detail}</div>` : ''}${i.duration_ms ? html`<div class="small">Absent ${fmt.dur(i.duration_ms)}</div>` : ''}<div class="t">${fmt.time(i.created_ms)}${i.question_index !== null ? ' · question ' + (i.question_index + 1) : ''}</div></div></div>`) : html`<p class="muted small">Les sorties, tentatives de copier-coller, captures et extensions d’IA apparaîtront ici instantanément.</p>`}</div>
          </aside>
        </div>`);
      window.scrollTo(0, scroll);
      $('#lv-quiz', main).addEventListener('change', (e) => { QZ.go('/prof/direct/' + e.target.value); });
      $('#lv-quiz', main).addEventListener('blur', () => { if (ui.dirty) safeDraw(); });
      $('#lv-proj', main).addEventListener('change', (e) => { ui.projection = e.target.checked; QZ.store.set('liveProjection', ui.projection); draw(); });
      $('#lv-sound', main).addEventListener('change', (e) => { QZ.store.set('alertSound', e.target.checked); if (e.target.checked) { QZ.unlockAudio(); QZ.beep('warn'); } });
    }

    async function action(kind, id) {
      const a = ui.data.attempts.find((x) => x.id === id);
      if (!a) return;
      const run = async (act, extra = {}) => {
        await QZ.call('t_attempt_action', { attempt_id: id, action: act, ...extra });
        await load();
      };
      try {
        if (kind === 'unlock') { await run('unlock'); QZ.toast(a.name + ' est débloqué', 'good'); }
        if (kind === 'lock') { await run('lock'); QZ.toast(a.name + ' est en pause'); }
        if (kind === 'warn') {
          const msg = await QZ.promptText({ title: 'Avertir ' + a.name, label: 'Message affiché en plein écran sur son appareil', presets: WARN_PRESETS, value: WARN_PRESETS[0], multiline: true, confirmLabel: 'Envoyer' });
          if (msg === null) return;
          await run('warn', { message: msg });
          QZ.toast('Avertissement envoyé à ' + a.name, 'good');
        }
        if (kind === 'exclude') {
          if (!(await QZ.confirm({ title: 'Exclure ' + a.name + ' ?', message: 'Sa copie est arrêtée immédiatement et notée 0/20. Tu pourras rétablir sa note plus tard depuis sa copie.', confirmLabel: 'Exclure (0/20)', danger: true }))) return;
          await run('exclude');
          QZ.toast(a.name + ' est exclu du quiz');
        }
        if (kind === 'more') {
          QZ.modal({
            title: a.name,
            body: html`<div class="row">${QZ.statusPill(a.status, a.finish_reason, a.zeroed)}<span class="small muted">IP ${a.ip || '—'} · ${a.device || ''}</span></div>`,
            actions: [
              { label: 'Voir la copie et la chronologie', icon: 'doc', onClick: () => QZ.go('/prof/copie/' + id) },
              ...(a.status !== 'finished' ? [{ label: 'Terminer sa copie (garder les points)', icon: 'flag', onClick: async () => { await run('finish'); QZ.toast('Copie terminée'); } }] : []),
              ...(a.zeroed ? [{ label: 'Rétablir sa note', icon: 'refresh', onClick: async () => { await run('unzero'); } }] : []),
              {
                label: 'Réinitialiser (il pourra recommencer)', icon: 'trash', kind: 'danger', close: false, onClick: async (m) => {
                  if (!(await QZ.confirm({ title: 'Réinitialiser la copie de ' + a.name + ' ?', message: 'Sa copie est supprimée : il pourra repasser le quiz depuis le début.', confirmLabel: 'Réinitialiser', danger: true }))) return false;
                  m.close();
                  await run('reset');
                }
              }
            ]
          });
        }
      } catch (e) { QZ.fail(e); }
    }

    delegate(main, 'click', '[data-a]', (e, t) => action(t.dataset.a, +t.dataset.id));
    delegate(main, 'click', '[data-filter]', (e, t) => { ui.filter = t.dataset.filter; draw(); });
    delegate(main, 'click', '[data-broadcast]', async () => {
      const msg = await QZ.promptText({ title: 'Message à toute la classe', label: 'Affiché en plein écran sur tous les appareils en cours de quiz', presets: WARN_PRESETS, value: 'Il reste 5 minutes.', multiline: true, confirmLabel: 'Envoyer à tous' });
      if (!msg) return;
      try { const r = await QZ.call('t_live_broadcast', { quiz_id: ui.quizId, message: msg }); QZ.toast('Message envoyé à ' + fmt.plural(r.sent, 'élève', 'élèves'), 'good'); load(); } catch (e) { QZ.fail(e); }
    });
    delegate(main, 'click', '[data-close-quiz]', async () => {
      if (!(await QZ.confirm({ title: 'Fermer le quiz ?', message: 'Plus personne ne pourra le commencer. Les élèves déjà en cours peuvent terminer.', confirmLabel: 'Fermer' }))) return;
      try { await QZ.call('t_quiz_status', { quiz_id: ui.quizId, status: 'closed' }); load(); } catch (e) { QZ.fail(e); }
    });
    delegate(main, 'click', '[data-open-quiz]', async () => {
      try { await QZ.call('t_quiz_status', { quiz_id: ui.quizId, status: 'open' }); QZ.toast('Quiz ouvert aux élèves', 'good'); load(); } catch (e) { QZ.fail(e); }
    });
    delegate(main, 'click', '[data-end-all]', async () => {
      if (!(await QZ.confirm({ title: 'Terminer le quiz pour tous ?', message: 'Toutes les copies en cours sont rendues maintenant (les questions non faites valent 0) et le quiz est fermé.', confirmLabel: 'Terminer pour tous', danger: true }))) return;
      try { const r = await QZ.call('t_quiz_end_all', { quiz_id: ui.quizId, close: true }); QZ.toast(fmt.plural(r.finished, 'copie rendue', 'copies rendues'), 'good'); load(); } catch (e) { QZ.fail(e); }
    });
    const onAlert = (e) => {
      const a = e.detail;
      if (!ui.data || !ui.data.quiz || a.quiz_id !== ui.data.quiz.id) return;
      ui.flash.add(a.attempt_id);
      setTimeout(() => { ui.flash.delete(a.attempt_id); }, 3500);
      load();
    };
    window.addEventListener('qz-alert', onAlert);
    QZ.onCleanup(() => window.removeEventListener('qz-alert', onAlert));
    QZ.every(2000, load);
    QZ.unlockAudio();
    await load();
  }
})(window.QZ = window.QZ || {});
