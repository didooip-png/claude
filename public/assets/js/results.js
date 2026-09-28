/* Quiz SES — résultats d’un quiz, analyse des questions, copie détaillée d’un élève. */
(function (QZ) {
  'use strict';
  const { html, icon, mount, $, delegate, fmt } = QZ;

  QZ.route('/prof/resultats/:id', async ({ id }) => {
    const main = QZ.teacherPage('quiz');
    if (!main) return;
    const ui = { classId: 0, tab: 'students', sort: 'name', dir: 1, d: null };
    const load = async () => { ui.d = await QZ.call('t_results', { quiz_id: +id, class_id: ui.classId }); draw(); };

    const sorted = () => {
      const k = ui.sort;
      const val = (a) => k === 'name' ? a.last_name + ' ' + a.first_name : k === 'class' ? a.class_name || '' : k === 'note' ? (a.zeroed ? 0 : a.note20 ?? -1) : k === 'points' ? a.points : k === 'duration' ? a.duration_ms ?? 1e12 : k === 'exits' ? a.exits : a.status;
      return ui.d.attempts.slice().sort((x, y) => { const a = val(x); const b = val(y); return (a > b ? 1 : a < b ? -1 : 0) * ui.dir; });
    };
    const th = (k, label, cls = '') => html`<th class="sortable ${cls}" data-sort="${k}">${label}${ui.sort === k ? (ui.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;

    function histogram(s) {
      const max = Math.max(1, ...s.histogram);
      return html`<div class="hist" role="img" aria-label="Répartition des notes">${s.histogram.map((n, i) => html`<div class="col ${i < 5 ? 'low' : i < 7 ? 'mid' : 'high'}"><span class="cnt">${n || ''}</span><div class="bar" style="height:${(n / max) * 100}%"></div><span class="lbl">${i * 2}–${i * 2 + 2}</span></div>`)}</div>`;
    }

    function questionStats(qs) {
      return html`<div class="qa">${qs.map((q) => {
        const labels = {};
        let correctIds = new Set();
        if (q.correction.choices) { q.correction.choices.forEach((c) => { labels[c.id] = c.text; }); correctIds = new Set(q.correction.choices.filter((c) => c.correct).map((c) => c.id)); }
        if (q.type === 'truefalse') { labels.true = 'Vrai'; labels.false = 'Faux'; correctIds = new Set([q.correction.value ? 'true' : 'false']); }
        const totalAns = Math.max(1, q.answered);
        const color = q.success === null ? 'var(--muted)' : q.success >= 70 ? 'var(--good)' : q.success >= 40 ? 'var(--warn)' : 'var(--bad)';
        return html`<div class="qa-item">
          <div class="row-between"><span class="section-title">Question ${q.n} · ${QZ.TYPE_LABELS[q.type]}</span>
            <span class="row small"><span>${icon('clock', 'icon-sm')} ${fmt.dur(q.avg_time_ms)}</span>${q.timeouts ? html`<span class="pill pill-warn">${q.timeouts} hors délai</span>` : ''}${q.cancelled ? html`<span class="pill pill-bad">${q.cancelled} annulée${q.cancelled > 1 ? 's' : ''}</span>` : ''}</span></div>
          <b>${q.prompt}</b>
          <div class="row"><div class="meter grow"><i style="width:${q.success ?? 0}%;background:${color}"></i></div><b class="num" style="color:${color}">${q.success === null ? '—' : q.success + ' %'}</b><span class="small muted">de réussite (${q.served} élève${q.served > 1 ? 's' : ''})</span></div>
          ${Object.keys(labels).length ? html`<div class="dist">${Object.keys(labels).map((cid) => { const n = q.distribution[cid] || 0; return html`<div class="r ${correctIds.has(cid) ? 'correct' : ''}"><span>${correctIds.has(cid) ? icon('check', 'icon-sm') : ''} ${labels[cid]}</span><div class="meter"><i style="width:${(n / totalAns) * 100}%;background:${correctIds.has(cid) ? 'var(--good)' : 'var(--ink-2)'}"></i></div><span class="num small">${n}</span></div>`; })}</div>` : ''}
          ${q.wrong_answers.length ? html`<div class="small"><span class="muted">Réponses fausses fréquentes :</span> ${q.wrong_answers.map((w) => html`<span class="pill" style="margin:2px">${w.text} × ${w.count}</span>`)}</div>` : ''}
        </div>`;
      })}</div>`;
    }

    function draw() {
      const d = ui.d;
      const q = d.quiz;
      const s = d.stats;
      const running = d.attempts.filter((a) => a.status !== 'finished').length;
      mount(main, html`
        <div><button class="btn btn-ghost btn-sm" data-go="/prof/quiz">${icon('back', 'icon-sm')}Mes quiz</button></div>
        <div class="page-head">
          <div><h1>${q.title}</h1><p class="sub row" style="gap:8px">${QZ.quizStatusPill(q.status)}<span>${q.level}</span>${running ? html`<span class="pill pill-info pill-live"><span class="dot"></span>${running} en cours</span>` : ''}</p></div>
          <div class="row">
            <select class="select" id="rs-class" style="width:auto"><option value="0">Toutes les classes</option>${d.classes.map((c) => html`<option value="${c.id}" ${ui.classId === c.id ? 'selected' : ''}>${c.name}</option>`)}</select>
            <button class="btn" data-export>${icon('download', 'icon-sm')}Export Excel (CSV)</button>
            <button class="btn" data-go="/prof/direct/${q.id}">${icon('live', 'icon-sm')}Direct</button>
            <button class="btn ${q.results_released ? '' : 'btn-primary'}" data-release="${q.results_released ? 0 : 1}">${icon(q.results_released ? 'eyeoff' : 'eye', 'icon-sm')}${q.results_released ? 'Masquer les résultats' : 'Publier les résultats'}</button>
          </div>
        </div>
        ${q.feedback_mode === 'release' && !q.results_released ? html`<div class="info-box">Les élèves ne voient ni leur note ni la correction tant que tu n’as pas cliqué sur « Publier les résultats ».</div>` : ''}
        ${s ? html`<div class="stats">
          <div class="stat"><span class="v">${s.count}</span><span class="k">Élèves notés</span></div>
          <div class="stat"><span class="v note ${fmt.noteClass(s.mean)}">${fmt.note(s.mean)}</span><span class="k">Moyenne /20</span></div>
          <div class="stat"><span class="v">${fmt.note(s.median)}</span><span class="k">Médiane</span></div>
          <div class="stat"><span class="v">${fmt.note(s.min)} – ${fmt.note(s.max)}</span><span class="k">Min – max</span></div>
          <div class="stat"><span class="v">${fmt.note(s.stddev)}</span><span class="k">Écart-type</span></div>
          <div class="stat"><span class="v">${s.pass_rate} %</span><span class="k">Notes ≥ 10</span></div>
        </div>
        <div class="card"><div class="card-head"><h2>Répartition des notes</h2></div>${histogram(s)}</div>` : html`<div class="card empty">${icon('bars')}<p>Aucune copie terminée pour l’instant.</p></div>`}
        <div class="tabs" style="max-width:680px;overflow-x:auto">${[['students', 'Élèves', 'users'], ['questions', 'Analyse des questions', 'chart'], ['board', 'Classement', 'trophy']].map(([k, l, ic]) => html`<button class="tab ${ui.tab === k ? 'active' : ''}" data-tab="${k}">${icon(ic, 'icon-sm')}${l}</button>`)}</div>
        ${ui.tab === 'students' ? (d.attempts.length ? html`<div class="tbl-wrap"><table class="tbl">
          <thead><tr>${th('name', 'Élève')}${th('class', 'Classe')}${th('status', 'Statut')}${th('note', 'Note /20', 'num')}${th('points', 'Points', 'num')}${th('duration', 'Durée', 'num')}${th('exits', 'Sorties', 'num')}<th>Appareil</th></tr></thead>
          <tbody>${sorted().map((a) => html`<tr class="clickable" data-go="/prof/copie/${a.id}">
            <td><b>${a.last_name.toUpperCase()}</b> ${a.first_name}${a.attempt_no > 1 ? html` <span class="small muted">(${a.attempt_no})</span>` : ''}</td>
            <td>${a.class_name || '—'}</td>
            <td>${QZ.statusPill(a.status, a.finish_reason, a.zeroed)}</td>
            <td class="num"><span class="note ${fmt.noteClass(a.zeroed ? 0 : a.note20)}">${a.status === 'finished' ? (a.zeroed ? '0' : fmt.note(a.note20)) : '—'}</span></td>
            <td class="num">${fmt.num(a.points, 0)}</td>
            <td class="num">${fmt.dur(a.duration_ms)}</td>
            <td class="num">${a.exits ? html`<span class="pill pill-bad">${a.exits}</span>` : '0'}${a.away_ms ? html`<div class="small muted">${fmt.dur(a.away_ms)}</div>` : ''}</td>
            <td class="small">${QZ.deviceIcon(a.device)} ${a.device || ''}</td></tr>`)}</tbody></table></div>` : html`<div class="card empty">${icon('users')}<p>Aucune copie.</p></div>`) : ''}
        ${ui.tab === 'questions' ? (d.questions.length ? questionStats(d.questions) : html`<div class="card empty"><p>Pas de question.</p></div>`) : ''}
        ${ui.tab === 'board' ? (d.leaderboard.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Élève</th><th class="num">Points</th></tr></thead><tbody>${d.leaderboard.map((p) => html`<tr><td class="num">${p.rank}</td><td>${p.name}</td><td class="num">${fmt.num(p.points, 0)}</td></tr>`)}</tbody></table></div>` : html`<div class="card empty">${icon('trophy')}<p>${q.show_leaderboard ? 'Pas encore de classement.' : 'Le classement est désactivé pour ce quiz.'}</p></div>`) : ''}`);
      $('#rs-class', main).addEventListener('change', (e) => { ui.classId = +e.target.value; load().catch(QZ.fail); });
    }

    try { await load(); } catch (e) { return QZ.fail(e); }
    delegate(main, 'click', '[data-tab]', (e, t) => { ui.tab = t.dataset.tab; draw(); });
    delegate(main, 'click', '[data-sort]', (e, t) => { if (ui.sort === t.dataset.sort) ui.dir = -ui.dir; else { ui.sort = t.dataset.sort; ui.dir = t.dataset.sort === 'note' || t.dataset.sort === 'exits' ? -1 : 1; } draw(); });
    delegate(main, 'click', '[data-export]', () => QZ.download('t_export', { quiz_id: +id }, 'Export des résultats (CSV)').catch(QZ.fail));
    delegate(main, 'click', '[data-release]', async (e, t) => {
      const on = t.dataset.release === '1';
      if (on && ui.d.attempts.some((a) => a.status !== 'finished')) {
        if (!(await QZ.confirm({ title: 'Des élèves n’ont pas fini', message: 'Publier maintenant permet à ceux qui ont fini de voir la correction pendant que d’autres composent encore. Continuer ?', confirmLabel: 'Publier quand même', danger: true }))) return;
      }
      try { await QZ.call('t_quiz_release', { quiz_id: +id, released: on }); QZ.toast(on ? 'Résultats publiés : les élèves voient leur note et la correction' : 'Résultats masqués', 'good'); await load(); } catch (err) { QZ.fail(err); }
    });
  });

  QZ.route('/prof/copie/:id', async ({ id }) => {
    const main = QZ.teacherPage('quiz');
    if (!main) return;
    let d;
    const load = async () => { d = await QZ.call('t_attempt', { attempt_id: +id }); draw(); };
    function draw() {
      const a = d.attempt;
      const dur = a.finished_ms ? a.finished_ms - a.started_ms : null;
      mount(main, html`
        <div><button class="btn btn-ghost btn-sm" data-go="/prof/resultats/${d.quiz.id}">${icon('back', 'icon-sm')}Résultats du quiz</button></div>
        <div class="card result-hero">
          <div class="big-note ${fmt.noteClass(a.zeroed ? 0 : a.note20)}">${a.status === 'finished' ? (a.zeroed ? '0' : fmt.note(a.note20)) : '—'}<small>/20</small></div>
          <div class="stack-sm grow">
            <h1>${d.student.name}</h1>
            <p class="muted">${d.quiz.title}${d.student.class_name ? ' · ' + d.student.class_name : ''}${a.attempt_no > 1 ? ' · tentative ' + a.attempt_no : ''}</p>
            <div class="row">${QZ.statusPill(a.status, a.finish_reason, a.zeroed)}<span class="pill">${fmt.num(a.score)} / ${fmt.num(a.max_score)} pts</span><span class="pill">${fmt.num(a.points, 0)} pts Kahoot</span></div>
          </div>
          <div class="row">
            ${a.status === 'locked' ? html`<button class="btn btn-good" data-a="unlock">${icon('unlock', 'icon-sm')}Débloquer</button>` : ''}
            ${a.status !== 'finished' ? html`<button class="btn" data-a="finish">${icon('flag', 'icon-sm')}Terminer</button>` : ''}
            ${!a.zeroed ? html`<button class="btn btn-danger" data-a="exclude">${icon('ban', 'icon-sm')}Mettre 0/20</button>` : html`<button class="btn" data-a="unzero">${icon('refresh', 'icon-sm')}Rétablir la note</button>`}
            <button class="btn btn-ghost" data-a="reset">${icon('trash', 'icon-sm')}Réinitialiser</button>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><span class="v">${fmt.dur(dur)}</span><span class="k">Durée</span></div>
          <div class="stat ${a.exits ? 'alert' : ''}"><span class="v">${a.exits}</span><span class="k">Sorties du quiz</span></div>
          <div class="stat ${a.away_ms ? 'alert' : ''}"><span class="v">${fmt.dur(a.away_ms)}</span><span class="k">Temps hors du quiz</span></div>
          <div class="stat"><span class="v">${a.incidents}</span><span class="k">Évènements</span></div>
        </div>
        <div class="editor-layout">
          <section class="stack"><h2>Réponses</h2>${d.items.map((it) => QZ.reviewItem(it, { teacher: true }))}</section>
          <aside class="card stack-sm" style="position:sticky;top:16px">
            <h3>Chronologie</h3>
            <p class="small muted">${QZ.deviceIcon(a.device)} ${a.device || ''} · IP ${a.ip || '—'}<br>Début ${fmt.date(a.started_ms)}${a.finished_ms ? ' · fin ' + fmt.time(a.finished_ms) : ''}</p>
            <div class="timeline">
              <div class="ev"><b>${fmt.time(a.started_ms)}</b> — Début du quiz</div>
              ${d.incidents.map((i) => html`<div class="ev ${i.counted ? 'counted' : ''} ${i.type === 'teacher' ? 'teacher' : ''}"><b>${fmt.time(i.created_ms)}</b> — ${i.type === 'teacher' ? i.detail : i.label}${i.question_index !== null ? html` <span class="small muted">(question ${i.question_index + 1})</span>` : ''}${i.type !== 'teacher' && i.detail ? html`<div class="small muted">${i.detail}</div>` : ''}${i.duration_ms ? html`<div class="small" style="color:var(--bad)">Absent ${fmt.dur(i.duration_ms)}</div>` : ''}</div>`)}
              ${a.finished_ms ? html`<div class="ev"><b>${fmt.time(a.finished_ms)}</b> — Fin</div>` : ''}
            </div>
          </aside>
        </div>`);
    }
    try { await load(); } catch (e) { return QZ.fail(e); }
    delegate(main, 'click', '[data-a]', async (e, t) => {
      const act = t.dataset.a;
      try {
        if (act === 'exclude' && !(await QZ.confirm({ title: 'Mettre 0/20 ?', message: 'La copie est terminée (si elle ne l’est pas) et notée 0/20. Tu pourras rétablir la note.', confirmLabel: 'Mettre 0/20', danger: true }))) return;
        if (act === 'reset') {
          if (!(await QZ.confirm({ title: 'Réinitialiser la copie ?', message: 'Elle est supprimée définitivement : l’élève pourra repasser le quiz.', confirmLabel: 'Réinitialiser', danger: true }))) return;
          await QZ.call('t_attempt_action', { attempt_id: +id, action: 'reset' });
          QZ.toast('Copie réinitialisée');
          return QZ.go('/prof/resultats/' + d.quiz.id, { replace: true });
        }
        await QZ.call('t_attempt_action', { attempt_id: +id, action: act });
        await load();
      } catch (err) { QZ.fail(err); }
    });
    delegate(main, 'click', '[data-override]', async (e, t) => {
      const max = +t.dataset.max;
      QZ.modal({
        title: 'Modifier les points',
        body: html`<p class="muted small">Utile pour une réponse courte juste mais mal orthographiée. La note est recalculée.</p><div class="field"><label for="ov-v">Points (sur ${fmt.num(max)})</label><input class="input" id="ov-v" type="number" min="0" max="${max}" step="0.25" value="${t.dataset.cur}"></div>`,
        actions: [
          { label: 'Note automatique', onClick: async () => { await QZ.call('t_answer_override', { answer_id: +t.dataset.override, score: null }); await load(); } },
          { label: 'Enregistrer', kind: 'primary', onClick: async (m) => { await QZ.call('t_answer_override', { answer_id: +t.dataset.override, score: $('#ov-v', m.el).value }); QZ.toast('Points modifiés', 'good'); await load(); } }
        ]
      });
    });
  });
})(window.QZ = window.QZ || {});
