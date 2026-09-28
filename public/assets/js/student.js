/* Quiz SES — espace élève : tableau de bord, consignes, résultats, classement. */
(function (QZ) {
  'use strict';
  const { html, icon, shape, mount, $, delegate, fmt } = QZ;

  QZ.isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  QZ.isMobile = () => QZ.isIOS() || /Android/.test(navigator.userAgent);

  function studentShell(content, active = 'quiz') {
    const u = QZ.state.user;
    const name = u.first_name + ' ' + u.last_name;
    return html`<div style="min-height:100%">
      <header class="topbar" style="display:flex;position:sticky;top:env(safe-area-inset-top,0px)">
        <div class="brand-mark" style="font-family:var(--font-display);font-weight:800">${QZ.brandLogo()}<span>${QZ.state.settings.site_name}</span></div>
        <div class="row">
          <a class="btn btn-sm ${active === 'quiz' ? 'btn-primary' : 'btn-ghost'}" href="#/eleve" data-go="/eleve">${icon('list', 'icon-sm')}Mes quiz</a>
          <button class="btn btn-ghost btn-sm" data-menu aria-label="Mon compte"><span class="avatar" style="width:28px;height:28px;font-size:.75rem">${fmt.initials(name)}</span></button>
        </div>
      </header>
      <main class="main" style="max-width:1100px;margin:0 auto;padding-bottom:60px">${content}</main>
    </div>`;
  }

  function bindShell(root) {
    delegate(root, 'click', '[data-go]', (e, t) => { e.preventDefault(); QZ.go(t.dataset.go); });
    delegate(root, 'click', '[data-menu]', () => {
      const u = QZ.state.user;
      QZ.modal({
        title: u.first_name + ' ' + u.last_name,
        body: html`<p class="muted">${u.class_name ? 'Classe : ' + u.class_name : 'Classe non renseignée'}</p>`,
        actions: [
          { label: 'Changer de mot de passe', icon: 'key', onClick: () => QZ.go('/mot-de-passe') },
          { label: 'Se déconnecter', icon: 'logout', kind: 'danger', onClick: () => QZ.logout() }
        ]
      });
    });
  }

  function levelDeco() {
    return html`<div class="deco" aria-hidden="true">${shape(0)}${shape(1)}${shape(2)}${shape(3)}</div>`;
  }

  function quizCard(q) {
    let action;
    if (q.running) {
      action = html`<button class="btn btn-primary" data-start="${q.id}">${icon('play', 'icon-sm')}Reprendre</button>`;
    } else if (q.window === 'not_yet') {
      action = html`<span class="pill pill-warn">${icon('clock', 'icon-sm')}Ouvre le ${fmt.dateS(q.opens_at)}</span>`;
    } else if (q.window === 'ended') {
      action = html`<span class="pill">Terminé</span>`;
    } else if (q.attempts_used >= q.max_attempts) {
      action = q.last && q.last.visible
        ? html`<button class="btn" data-result="${q.last.attempt_id}">Ma correction</button>`
        : html`<span class="pill pill-good">${icon('check', 'icon-sm')}Fait</span>`;
    } else {
      action = html`<button class="btn btn-primary" data-start="${q.id}">${icon('play', 'icon-sm')}${q.attempts_used ? 'Nouvelle tentative' : 'Commencer'}</button>`;
    }
    return html`<article class="qcard">
      <div class="qcard-top lvl-${q.level}">${levelDeco()}<span class="pill">${q.level || 'SES'}</span><h3>${q.title}</h3></div>
      <div class="qcard-body">
        ${q.chapter ? html`<p class="small muted">${q.chapter}</p>` : ''}
        <div class="qcard-meta">
          <span>${icon('list', 'icon-sm')}${fmt.plural(q.question_count, 'question', 'questions')}</span>
          ${q.time_limit ? html`<span>${icon('clock', 'icon-sm')}${fmt.secs(q.time_limit)}</span>` : ''}
          ${q.needs_code ? html`<span>${icon('lock', 'icon-sm')}Code requis</span>` : ''}
          ${q.closes_at ? html`<span>${icon('flag', 'icon-sm')}Jusqu’au ${fmt.dateS(q.closes_at)}</span>` : ''}
        </div>
        <div class="qcard-foot">
          ${q.last && q.last.visible && q.last.note20 !== null ? html`<span class="note ${fmt.noteClass(q.last.note20)}" style="font-size:1.3rem">${fmt.note(q.last.note20)}<small class="muted" style="font-size:.7em">/20</small></span>` : html`<span></span>`}
          ${action}
        </div>
      </div>
    </article>`;
  }

  QZ.route('/eleve', async () => {
    const u = QZ.state.user;
    if (!u || u.role !== 'student') return QZ.go(QZ.home(), { replace: true });
    const root = QZ.root();
    mount(root, studentShell(html`<div class="loading"><div class="spinner"></div></div>`));
    bindShell(root);
    let d;
    try { d = await QZ.call('student_dashboard'); } catch (e) { return QZ.fail(e); }
    const main = $('.main', root);
    if (d.pending) {
      mount(main, html`<div class="card stack" style="max-width:620px;margin:40px auto;text-align:center;align-items:center">
        <span class="avatar" style="width:64px;height:64px;background:var(--warn)">${icon('clock', 'icon-lg')}</span>
        <h1>Compte en attente</h1>
        <p class="muted">Bonjour ${u.first_name} ! ${QZ.state.settings.teacher_name} doit valider ton compte avant que tu puisses passer les quiz. En général, c’est fait en début de cours.</p>
        <button class="btn btn-primary" data-reload>${icon('refresh', 'icon-sm')}Vérifier à nouveau</button>
      </div>`);
      delegate(main, 'click', '[data-reload]', async () => {
        try { await QZ.refreshSession(); } catch (e) { /* ignore */ }
        QZ.go('/eleve', { replace: true });
      });
      return;
    }
    const running = d.quizzes.filter((q) => q.running);
    const todo = d.quizzes;
    mount(main, html`
      <div class="page-head"><div><h1>Bonjour ${u.first_name}</h1><p class="sub">${todo.length ? 'Voici tes quiz disponibles.' : 'Aucun quiz n’est ouvert pour le moment.'}</p></div></div>
      ${running.length ? html`<div class="warn-box row">${icon('alert')}<span class="grow">Tu as un quiz en cours : « ${running[0].title} ». Reprends-le maintenant.</span></div>` : ''}
      ${todo.length ? html`<div class="qcards">${todo.map(quizCard)}</div>` : html`<div class="card empty">${icon('list')}<p>Quand ${QZ.state.settings.teacher_name} ouvrira un quiz, il apparaîtra ici.</p><button class="btn" data-reload>${icon('refresh', 'icon-sm')}Actualiser</button></div>`}
      <section class="stack">
        <h2>Mes résultats</h2>
        ${d.history.length ? html`<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Quiz</th><th>Date</th><th class="num">Note</th><th></th></tr></thead>
          <tbody>${d.history.map((h) => html`<tr>
            <td><b>${h.title}</b><div class="small muted">${h.level}</div></td>
            <td class="nowrap">${fmt.date(h.finished_ms)}</td>
            <td class="num">${h.visible ? html`<span class="note ${fmt.noteClass(h.note20)}">${h.zeroed ? '0' : fmt.note(h.note20)}</span><span class="muted">/20</span>` : html`<span class="pill">En attente</span>`}</td>
            <td class="num">${h.visible ? html`<button class="btn btn-sm" data-result="${h.attempt_id}">Correction</button>` : ''}</td>
          </tr>`)}</tbody></table></div>` : html`<p class="muted">Tes notes apparaîtront ici après chaque quiz.</p>`}
      </section>`);
    delegate(main, 'click', '[data-start]', (e, t) => QZ.go('/eleve/quiz/' + t.dataset.start));
    delegate(main, 'click', '[data-result]', (e, t) => QZ.go('/eleve/resultat/' + t.dataset.result));
    delegate(main, 'click', '[data-reload]', () => QZ.go('/eleve', { replace: true }));
  });

  /* ---------- Start screen: rules + commitment + access code ---------- */
  QZ.route('/eleve/quiz/:id', async ({ id }) => {
    const u = QZ.state.user;
    if (!u || u.role !== 'student') return QZ.go(QZ.home(), { replace: true });
    QZ.loading();
    let d;
    try { d = await QZ.call('student_dashboard'); } catch (e) { return QZ.fail(e); }
    const q = (d.quizzes || []).find((x) => String(x.id) === String(id));
    if (!q) { QZ.toast('Ce quiz n’est pas disponible.', 'bad'); return QZ.go('/eleve', { replace: true }); }
    const ios = QZ.isIOS();
    const mobile = QZ.isMobile();
    const needFs = q.require_fullscreen && !mobile && !!document.documentElement.requestFullscreen;
    const exitRule = q.exit_action === 'log'
      ? 'Chaque sortie de l’écran est enregistrée et signalée à ta professeure.'
      : q.max_exits > 0
        ? `Si tu quittes le quiz, la question en cours est annulée (0 point). Au-delà de ${q.max_exits} sortie${q.max_exits > 1 ? 's' : ''}, ton quiz est ${q.exit_action === 'submit' ? 'terminé' : 'verrouillé'}.`
        : `Si tu quittes le quiz, même une seconde, la question en cours est annulée (0 point) et ton quiz est ${q.exit_action === 'submit' ? 'terminé' : 'verrouillé'} immédiatement.`;
    const root = QZ.root();
    mount(root, html`<div class="game" data-qz style="overflow-y:auto">
      <div class="game-top"><button class="btn-game ghost" data-back style="min-height:44px;padding:0 14px">${icon('back')}Retour</button><span class="game-chip">${q.level}</span></div>
      <div class="game-center" style="justify-content:flex-start;padding-top:18px">
        <div class="start-card">
          <h2 style="text-align:center">${q.title}</h2>
          <p style="text-align:center;opacity:.85">${fmt.plural(q.question_count, 'question', 'questions')} · une à la fois · chronométrées${q.time_limit ? ' · durée totale ' + fmt.secs(q.time_limit) : ''}</p>
          <ul class="rules">
            <li>${icon('shieldx')}<span>${exitRule}</span></li>
            <li>${icon('eye')}<span>${QZ.state.settings.teacher_name} voit en direct ta progression, tes sorties et tout comportement suspect (autre appli, capture, copier-coller, extensions d’IA…).</span></li>
            <li>${icon('clock')}<span>Chaque question a son propre chrono. Pas de retour en arrière possible.</span></li>
            ${ios ? html`<li>${icon('phone')}<span><b>Sur iPhone :</b> active le mode Concentration « Ne pas déranger » pour ne pas être sorti par une notification. Mieux encore, active l’<b>Accès guidé</b> (Réglages → Accessibilité → Accès guidé), puis triple-clic sur le bouton latéral : tu ne pourras plus quitter le quiz par erreur.</span></li>` : ''}
            ${!ios && mobile ? html`<li>${icon('phone')}<span><b>Sur Android :</b> active « Ne pas déranger » et épingle l’écran (Paramètres → Sécurité → Épinglage d’application) pour ne pas sortir par erreur.</span></li>` : ''}
            ${needFs ? html`<li>${icon('laptop')}<span>Le quiz s’ouvre en <b>plein écran</b>. Quitter le plein écran compte comme une sortie.</span></li>` : ''}
          </ul>
          ${q.running ? '' : q.needs_code ? html`<div class="field"><label for="acc-code" style="color:#fff">Code d’accès donné par ${QZ.state.settings.teacher_name}</label><input class="input input-code" id="acc-code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" inputmode="text"></div>` : ''}
          <label class="check"><input type="checkbox" id="engage"><span>Je m’engage à répondre seul(e), sans aide, sans autre appareil et sans quitter le quiz.</span></label>
          <div class="error-box" hidden></div>
          <button class="btn-game" id="go" style="align-self:center" disabled>${icon('play')}${q.running ? 'Reprendre le quiz' : 'Commencer le quiz'}</button>
        </div>
      </div>
    </div>`);
    const go = $('#go', root);
    $('#engage', root).addEventListener('change', (e) => { go.disabled = !e.target.checked; });
    delegate(root, 'click', '[data-back]', () => QZ.go('/eleve'));
    go.addEventListener('click', async () => {
      go.disabled = true;
      QZ.unlockAudio();
      if (needFs) {
        try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { /* refused: the player will insist */ }
      }
      const err = $('.error-box', root);
      err.hidden = true;
      try {
        const s = await QZ.call('quiz_start', {
          quiz_id: q.id,
          code: $('#acc-code', root) ? $('#acc-code', root).value : '',
          webdriver: !!navigator.webdriver,
          multiscreen: !!(window.screen && window.screen.isExtended),
          device_hint: /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1 ? 'ipad' : ''
        });
        QZ.go('/eleve/passer/' + s.attempt_id);
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
        go.disabled = false;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      }
    });
  });

  QZ.route('/eleve/passer/:id', ({ id }) => {
    if (!QZ.state.user || QZ.state.user.role !== 'student') return QZ.go(QZ.home(), { replace: true });
    QZ.player(+id, { preview: false });
  });

  /* ---------- Correction review (shared with the teacher view) ---------- */
  QZ.reviewItem = function (it, { teacher = false } = {}) {
    const q = it.question;
    const c = it.correction;
    const r = it.response || {};
    const cls = it.status !== 'answered' ? 'bad' : it.fraction >= 1 ? 'good' : it.fraction > 0 ? 'part' : 'bad';
    let body = '';
    if (q.type === 'single' || q.type === 'multiple') {
      const correct = new Set(c.choices.filter((x) => x.correct).map((x) => x.id));
      const picked = new Set(q.type === 'single' ? (r.choice ? [r.choice] : []) : (r.choices || []));
      body = html`<div class="stack-sm">${q.choices.map((ch) => {
        const isC = correct.has(ch.id);
        const isP = picked.has(ch.id);
        return html`<div class="opt ${isC ? 'right' : isP ? 'picked-wrong' : ''}">${isC ? icon('check') : isP ? icon('x') : html`<span class="icon"></span>`}<span class="grow">${ch.text}${isP ? html` <b>(${teacher ? 'réponse de l’élève' : 'ta réponse'})</b>` : ''}</span></div>`;
      })}</div>`;
    } else if (q.type === 'truefalse') {
      const lbl = (v) => (v === true ? 'Vrai' : v === false ? 'Faux' : '—');
      body = html`<div class="stack-sm"><div class="opt ${r.value === c.value ? 'right' : 'picked-wrong'}">${teacher ? 'Réponse de l’élève' : 'Ta réponse'} : <b>${lbl(r.value)}</b></div><div class="opt right">${icon('check')}Bonne réponse : <b>${lbl(c.value)}</b></div></div>`;
    } else if (q.type === 'short') {
      body = html`<div class="stack-sm"><div class="opt ${it.fraction >= 1 ? 'right' : 'picked-wrong'}">${teacher ? 'Réponse de l’élève' : 'Ta réponse'} : <b>${r.text || '—'}</b></div><div class="opt right">${icon('check')}<span>Réponse${c.answers.length > 1 ? 's acceptées' : ' attendue'} : <b>${c.answers.join(' · ')}</b></span></div></div>`;
    } else if (q.type === 'numeric') {
      body = html`<div class="stack-sm"><div class="opt ${it.fraction >= 1 ? 'right' : 'picked-wrong'}">${teacher ? 'Réponse de l’élève' : 'Ta réponse'} : <b>${r.text || '—'}</b></div><div class="opt right">${icon('check')}Bonne réponse : <b>${fmt.num(c.value, 4)} ${c.unit}</b>${c.tolerance ? html` <span class="small">(± ${fmt.num(c.tolerance, 4)})</span>` : ''}</div></div>`;
    } else if (q.type === 'ordering') {
      const byId = Object.fromEntries(q.items.map((i) => [i.id, i.text]));
      const given = r.order || [];
      body = html`<div class="form-grid">
        <div class="stack-sm"><span class="label">${teacher ? 'Ordre de l’élève' : 'Ton ordre'}</span>${given.length ? given.map((id, i) => html`<div class="opt ${c.items[i] && c.items[i].id === id ? 'right' : 'picked-wrong'}"><b>${i + 1}.</b> ${byId[id] || '?'}</div>`) : html`<div class="opt">—</div>`}</div>
        <div class="stack-sm"><span class="label">Bon ordre</span>${c.items.map((x, i) => html`<div class="opt right"><b>${i + 1}.</b> ${x.text}</div>`)}</div>
      </div>`;
    }
    const statusNote = it.status === 'timeout' ? html`<span class="pill pill-warn">${icon('clock', 'icon-sm')}Temps écoulé</span>`
      : it.status === 'cancelled' ? html`<span class="pill pill-bad">${icon('shieldx', 'icon-sm')}Annulée (sortie du quiz)</span>`
        : it.status === 'unanswered' ? html`<span class="pill">Non posée</span>` : '';
    return html`<article class="answer-review ${cls}">
      <div class="row-between"><span class="section-title">Question ${it.position + 1} · ${QZ.TYPE_LABELS[q.type]}</span>
        <span class="row">${statusNote}${teacher && it.time_ms !== undefined && it.time_ms !== null ? html`<span class="pill">${icon('clock', 'icon-sm')}${fmt.dur(it.time_ms)}</span>` : ''}<span class="pill ${cls === 'good' ? 'pill-good' : cls === 'part' ? 'pill-warn' : 'pill-bad'} num">${fmt.num(it.score)} / ${fmt.num(it.max)} pt${it.overridden ? ' (corrigé)' : ''}</span></span></div>
      <p class="qt">${QZ.nl2br(q.prompt)}</p>
      ${q.image ? html`<img src="${QZ.imgUrl(q.image)}" alt="" style="max-height:220px;border-radius:12px;align-self:flex-start">` : ''}
      ${body}
      ${it.explanation ? html`<div class="expl">${icon('info', 'icon-sm')} ${it.explanation}</div>` : ''}
      ${teacher && it.answer_id ? html`<div class="row"><button class="btn btn-sm" data-override="${it.answer_id}" data-max="${it.max}" data-cur="${it.score}">${icon('edit', 'icon-sm')}Modifier les points</button></div>` : ''}
    </article>`;
  };

  QZ.route('/eleve/resultat/:id', async ({ id }) => {
    const u = QZ.state.user;
    if (!u || u.role !== 'student') return QZ.go(QZ.home(), { replace: true });
    const root = QZ.root();
    mount(root, studentShell(html`<div class="loading"><div class="spinner"></div></div>`, 'res'));
    bindShell(root);
    const main = $('.main', root);
    let d;
    try { d = await QZ.call('attempt_result', { attempt_id: +id }); } catch (e) {
      mount(main, html`<div class="card empty">${icon('lock')}<p>${e.message}</p><button class="btn" data-go="/eleve">Retour</button></div>`);
      return;
    }
    const a = d.attempt;
    const good = d.items.filter((i) => i.fraction >= 1).length;
    mount(main, html`
      <div><button class="btn btn-ghost btn-sm" data-go="/eleve">${icon('back', 'icon-sm')}Mes quiz</button></div>
      <div class="card result-hero">
        <div class="big-note ${fmt.noteClass(a.zeroed ? 0 : a.note20)}">${a.zeroed ? '0' : fmt.note(a.note20)}<small>/20</small></div>
        <div class="stack-sm grow">
          <h1>${d.quiz.title}</h1>
          <p class="muted">${good} bonne${good > 1 ? 's' : ''} réponse${good > 1 ? 's' : ''} sur ${d.items.length} · ${fmt.num(a.score)} / ${fmt.num(a.max_score)} points · ${fmt.num(a.points, 0)} points Kahoot</p>
          ${a.zeroed ? html`<div class="error-box">Tu as été exclu de ce quiz par ta professeure : ta note est 0/20.</div>` : ''}
          ${a.exits ? html`<div class="warn-box">${fmt.plural(a.exits, 'sortie détectée', 'sorties détectées')} pendant le quiz.</div>` : ''}
        </div>
        ${d.quiz.show_leaderboard ? html`<button class="btn btn-primary" data-go="/eleve/classement/${d.quiz.id}">${icon('trophy', 'icon-sm')}Classement${d.rank ? ' · ' + d.rank + (d.rank === 1 ? 'er' : 'e') : ''}</button>` : ''}
      </div>
      <h2>Correction</h2>
      <div class="stack">${d.items.map((it) => QZ.reviewItem(it))}</div>`);
  });

  QZ.route('/eleve/classement/:id', async ({ id }) => {
    const u = QZ.state.user;
    if (!u || u.role !== 'student') return QZ.go(QZ.home(), { replace: true });
    const root = QZ.root();
    mount(root, studentShell(html`<div class="loading"><div class="spinner"></div></div>`, 'res'));
    bindShell(root);
    const main = $('.main', root);
    let d;
    try { d = await QZ.call('leaderboard', { quiz_id: +id }); } catch (e) {
      mount(main, html`<div class="card empty">${icon('trophy')}<p>${e.message}</p><button class="btn" data-go="/eleve">Retour</button></div>`);
      return;
    }
    mount(main, QZ.leaderboardView(d, html`<button class="btn btn-ghost btn-sm" data-go="/eleve">${icon('back', 'icon-sm')}Mes quiz</button>`));
  });

  QZ.leaderboardView = function (d, backBtn) {
    const top = d.top;
    const pod = [top[1], top[0], top[2]];
    return html`<div>${backBtn}</div>
      <div class="game" style="position:relative;inset:auto;border-radius:24px;min-height:auto;padding:28px 16px;z-index:auto">
        <div class="stack" style="align-items:center;text-align:center">
          <h1 style="color:#fff">${icon('trophy', 'icon-lg')} ${d.quiz.title}</h1>
          <p style="opacity:.85">${d.participants} participant${d.participants > 1 ? 's' : ''}${d.my_rank ? ' · ta place : ' + d.my_rank + (d.my_rank === 1 ? 'er' : 'e') : ''}</p>
          <div class="podium">${pod.map((p, i) => p ? html`<div class="p p${[2, 1, 3][i]}"><span class="medal">${[2, 1, 3][i]}</span><span style="font-size:.85rem">${p.name}</span><span class="num" style="font-size:.8rem;opacity:.9">${fmt.num(p.points, 0)}</span></div>` : '')}</div>
        </div>
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Élève</th><th class="num">Points</th></tr></thead>
      <tbody>${top.map((p) => html`<tr style="${p.me ? 'background:var(--accent-soft);font-weight:800' : ''}"><td class="num">${p.rank}</td><td>${p.name}${p.me ? ' (toi)' : ''}</td><td class="num">${fmt.num(p.points, 0)}</td></tr>`)}</tbody></table></div>`;
  };
})(window.QZ = window.QZ || {});
