/* Quiz SES — lecteur de quiz (style Kahoot) avec surveillance anti-triche.
 * The server is the authority (timers, answers, locks). The browser detects and reports:
 * leaving the app/tab, losing focus, leaving fullscreen, copy/paste, screenshots keys,
 * injected AI extensions, devtools and tampering with browser APIs. */
(function (QZ) {
  'use strict';
  const { html, icon, shape, mount, $, fmt } = QZ;

  const HEARTBEAT_MS = 2000;
  const BLUR_GRACE_MS = 1000;
  const AI_RE = /gpt|openai|chatgpt|claude|anthropic|gemini|bard|copilot|sider|merlin|monica|maxai|harpa|perplexity|\bpoe\b|deepseek|mistral|grok|wiseone|glasp|superpower|quillbot|brainly|photomath|socratic|chegg|quizlet|gauth|studyx|answer\s?ai|homework|tutor|solver|aitopia|chatbot|llm/i;
  const NATIVE = /\{\s*\[native code\]\s*\}\s*$/;

  function isNative(fn) {
    try { return typeof fn === 'function' && NATIVE.test(Function.prototype.toString.call(fn)); } catch (e) { return false; }
  }
  function getterOf(proto, prop) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    return d && d.get;
  }
  function tamperCheck() {
    const bad = [];
    const checks = [
      ['addEventListener', EventTarget.prototype.addEventListener],
      ['hasFocus', Document.prototype.hasFocus],
      ['visibilityState', getterOf(Document.prototype, 'visibilityState')],
      ['hidden', getterOf(Document.prototype, 'hidden')],
      ['requestFullscreen', Element.prototype.requestFullscreen || Element.prototype.webkitRequestFullscreen],
      ['sendBeacon', Navigator.prototype.sendBeacon]
    ];
    checks.forEach(([n, f]) => { if (f && !isNative(f)) bad.push(n); });
    ['hasFocus', 'visibilityState', 'hidden', 'onvisibilitychange', 'onblur'].forEach((p) => {
      if (Object.prototype.hasOwnProperty.call(document, p)) bad.push('document.' + p);
    });
    if (Object.prototype.hasOwnProperty.call(window, 'onblur') && window.onblur !== null && typeof window.onblur !== 'function') bad.push('window.onblur');
    return bad;
  }
  function describeNode(n) {
    const tag = (n.tagName || '').toLowerCase();
    const id = n.id ? '#' + n.id : '';
    const cls = typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const src = n.src || n.href || '';
    return (tag + id + cls + (src ? ' ' + String(src).slice(0, 80) : '')).slice(0, 190);
  }
  function isForeign(n) {
    if (n.nodeType !== 1) return false;
    if (QZ.trusted && QZ.trusted.has(n)) return false;
    if (n.hasAttribute && n.hasAttribute('data-qz')) return false;
    if (n.id === 'app') return false;
    const tag = n.tagName.toLowerCase();
    if (/^(script|style|link|meta|noscript|title)$/.test(tag)) {
      const src = n.src || n.href || '';
      return /^(chrome|moz|safari-web|ms-browser)-extension:/.test(src) || (tag === 'style' && AI_RE.test(n.textContent.slice(0, 2000)));
    }
    if (n.classList && (n.classList.contains('toasts') || n.classList.contains('modal-back') || n.classList.contains('demo-banner'))) return false;
    return true;
  }

  QZ.player = function (attemptId, { preview = false } = {}) {
    const root = QZ.root();
    const teacherName = QZ.state.settings.teacher_name;
    const S = {
      state: null, phase: 'loading', answer: null, busy: false, finished: false,
      qTimer: null, qDeadline: 0, qLimit: 0, gTimer: null, gDeadline: null,
      away: null, blurTimer: null, lastWarn: null, destroyed: false, wakeLock: null,
      reported: new Set(), fsEntered: false, fsUnavailable: false, feedbackTimer: null, lastIndexShown: -1, seq: 0
    };
    const offs = [];
    const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); offs.push(() => t.removeEventListener(type, fn, opt)); };
    const mobile = QZ.isMobile();

    /* ---------------- Shell ---------------- */
    const u = QZ.state.user;
    const wm = (u.first_name + ' ' + (u.last_name || '').toUpperCase()).trim() + ' · ' + fmt.time(Date.now()).slice(0, 5);
    mount(root, html`<div class="game" data-qz id="game">
      <div class="watermark" aria-hidden="true">${Array.from({ length: 60 }, () => html`<span>${wm}</span>`)}</div>
      <div class="game-top">
        <span class="game-chip" id="g-count">…</span>
        <span class="row" style="gap:6px">
          <span class="game-chip" id="g-global" hidden>${icon('clock', 'icon-sm')}<span></span></span>
          <span class="game-chip" id="g-points" hidden>${icon('trophy', 'icon-sm')}<span></span></span>
          <span class="game-chip" id="g-exits" hidden>${icon('shieldx', 'icon-sm')}<span></span></span>
          ${preview ? html`<span class="game-chip" style="background:#d89e00;color:#1c1631">Aperçu</span><button class="btn-game ghost" data-quit style="min-height:36px;padding:0 12px;font-size:.85rem">Quitter</button>` : ''}
        </span>
      </div>
      <div class="game-progress"><i id="g-bar" style="width:0%"></i></div>
      <div class="game-stage" id="stage"><div class="game-center"><div class="spinner" style="border-color:rgba(255,255,255,.2);border-top-color:#fff"></div></div></div>
    </div>`);
    const stage = $('#stage', root);
    const game = $('#game', root);

    /* ---------------- Overlays ---------------- */
    function overlay(kind, content) {
      let el = document.getElementById('ov-' + kind);
      if (!content) { if (el) el.remove(); return null; }
      if (!el) { el = document.createElement('div'); el.id = 'ov-' + kind; el.setAttribute('data-qz', ''); el.className = 'game-overlay ' + kind; document.body.appendChild(el); }
      mount(el, content);
      return el;
    }
    function banner(text) {
      let el = document.getElementById('g-banner');
      if (!el) { el = document.createElement('div'); el.id = 'g-banner'; el.className = 'game-banner'; el.setAttribute('data-qz', ''); document.body.appendChild(el); }
      el.textContent = text;
      clearTimeout(banner.t);
      banner.t = setTimeout(() => el.remove(), 6000);
    }

    /* ---------------- Rendering ---------------- */
    function updateTop() {
      const st = S.state;
      if (!st) return;
      $('#g-count', root).textContent = st.status === 'finished' ? 'Terminé' : `Question ${Math.min(st.index + 1, st.total)} / ${st.total}`;
      $('#g-bar', root).style.width = Math.round((Math.min(st.index, st.total) / Math.max(1, st.total)) * 100) + '%';
      const pts = $('#g-points', root);
      if (st.points !== null && st.points !== undefined) { pts.hidden = false; pts.querySelector('span').textContent = fmt.num(st.points, 0) + ' pts'; }
      const ex = $('#g-exits', root);
      if (st.exits > 0) {
        ex.hidden = false;
        ex.classList.add('warn');
        ex.querySelector('span').textContent = st.quiz.exit_action === 'log' ? st.exits + ' sortie' + (st.exits > 1 ? 's' : '') : `Sorties ${st.exits}/${st.quiz.max_exits}`;
      }
      if (st.deadline_remaining_ms !== null && st.deadline_remaining_ms !== undefined && st.status !== 'finished') {
        S.gDeadline = performance.now() + st.deadline_remaining_ms;
        $('#g-global', root).hidden = false;
      }
    }

    function tickGlobal() {
      if (S.gDeadline === null) return;
      const left = Math.max(0, S.gDeadline - performance.now());
      const el = $('#g-global span', root);
      if (el) el.textContent = fmt.dur(left).replace(' min ', ':').replace(' s', '');
      if (left <= 0 && !S.finished && !S.busy) { S.gDeadline = null; refresh(false); }
    }

    function renderQuestion(q) {
      S.phase = 'question';
      S.answer = null;
      S.lastIndexShown = S.state.index;
      const limit = q.time_limit || 0;
      S.qLimit = limit * 1000;
      S.qDeadline = q.remaining_ms !== null && q.remaining_ms !== undefined ? performance.now() + q.remaining_ms : 0;
      const circ = 2 * Math.PI * 28;
      let area;
      if (q.type === 'single' || q.type === 'multiple') {
        area = html`<div class="tiles n${q.choices.length}" id="tiles">${q.choices.map((c, i) => html`<button class="tile c${i}" data-choice="${c.id}"><span class="shape">${shape(i)}</span><span>${c.text}</span></button>`)}</div>
          ${q.type === 'multiple' ? html`<p class="qhint">Plusieurs réponses possibles</p><div class="game-actions"><button class="btn-game" id="submit" disabled>${icon('check')}Valider</button></div>` : ''}`;
      } else if (q.type === 'truefalse') {
        area = html`<div class="tiles" id="tiles"><button class="tile c1" data-tf="true"><span class="shape">${shape(1)}</span><span>Vrai</span></button><button class="tile c0" data-tf="false"><span class="shape">${shape(0)}</span><span>Faux</span></button></div>`;
      } else if (q.type === 'short' || q.type === 'numeric') {
        area = html`<form class="game-input" id="txtform" autocomplete="off">
          <div class="row" style="justify-content:center;width:100%"><input id="txt" ${q.type === 'numeric' ? html`inputmode="decimal"` : ''} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="200" placeholder="${q.type === 'numeric' ? 'Ta réponse (nombre)' : 'Ta réponse'}" style="flex:1">${q.unit ? html`<span class="unit">${q.unit}</span>` : ''}</div>
          <button class="btn-game" type="submit" id="submit">${icon('send')}Valider</button></form>`;
      } else if (q.type === 'ordering') {
        area = html`<ol class="order-list" id="olist">${q.items.map((it, i) => html`<li class="order-item" data-id="${it.id}"><span class="n">${i + 1}</span><span class="t">${it.text}</span><button type="button" data-mv="-1" aria-label="Monter">${icon('up')}</button><button type="button" data-mv="1" aria-label="Descendre">${icon('down')}</button></li>`)}</ol>
          <div class="game-actions"><button class="btn-game" id="submit">${icon('check')}Valider l’ordre</button></div>`;
      }
      mount(stage, html`
        <div class="qbox">
          ${limit ? html`<div class="timer" id="timer"><svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="28"/><circle class="fg" cx="32" cy="32" r="28" stroke-dasharray="${circ}" stroke-dashoffset="0"/></svg><b>${limit}</b></div>` : ''}
          <div class="qtext">${QZ.nl2br(q.prompt)}</div>
        </div>
        ${q.image ? html`<div class="qmedia"><img src="${QZ.imgUrl(q.image)}" alt="Document" draggable="false"></div>` : ''}
        ${area}`);
      updateTop();
      bindAnswer(q);
      if (limit) {
        clearInterval(S.qTimer);
        const fg = $('#timer .fg', stage);
        const num = $('#timer b', stage);
        const tm = $('#timer', stage);
        const tick = () => {
          const left = Math.max(0, S.qDeadline - performance.now());
          const frac = S.qLimit ? left / S.qLimit : 0;
          if (fg) fg.style.strokeDashoffset = String(circ * (1 - frac));
          if (num) num.textContent = String(Math.ceil(left / 1000));
          if (tm) tm.classList.toggle('hurry', left < 5500);
          if (left <= 0) { clearInterval(S.qTimer); if (S.phase === 'question') submit(null); }
        };
        tick();
        S.qTimer = setInterval(tick, 200);
      }
      const first = $('#txt', stage);
      if (first && !mobile) first.focus();
    }

    function bindAnswer(q) {
      const tiles = $('#tiles', stage);
      if (q.type === 'single') {
        tiles.addEventListener('click', (e) => {
          const t = e.target.closest('[data-choice]');
          if (!t || S.phase !== 'question') return;
          t.classList.add('selected');
          tiles.classList.add('dim');
          submit({ choice: t.dataset.choice });
        });
      } else if (q.type === 'truefalse') {
        tiles.addEventListener('click', (e) => {
          const t = e.target.closest('[data-tf]');
          if (!t || S.phase !== 'question') return;
          t.classList.add('selected');
          tiles.classList.add('dim');
          submit({ value: t.dataset.tf === 'true' });
        });
      } else if (q.type === 'multiple') {
        const sel = new Set();
        const btn = $('#submit', stage);
        tiles.addEventListener('click', (e) => {
          const t = e.target.closest('[data-choice]');
          if (!t || S.phase !== 'question') return;
          const id = t.dataset.choice;
          if (sel.has(id)) sel.delete(id); else sel.add(id);
          t.classList.toggle('selected', sel.has(id));
          btn.disabled = sel.size === 0;
        });
        btn.addEventListener('click', () => { if (sel.size && S.phase === 'question') submit({ choices: Array.from(sel) }); });
      } else if (q.type === 'short' || q.type === 'numeric') {
        const input = $('#txt', stage);
        input.addEventListener('beforeinput', (e) => {
          if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop' || e.inputType === 'insertFromYank') {
            e.preventDefault();
            report('paste', 'Collage bloqué dans la réponse');
          } else if (e.inputType === 'insertText' && e.data && e.data.length > 14) {
            report('typing', e.data.length + ' caractères insérés d’un coup');
          }
        });
        $('#txtform', stage).addEventListener('submit', (e) => {
          e.preventDefault();
          if (S.phase !== 'question') return;
          const v = input.value.trim();
          if (!v) { input.focus(); return; }
          input.blur();
          submit({ text: v });
        });
      } else if (q.type === 'ordering') {
        const list = $('#olist', stage);
        const renumber = () => Array.from(list.children).forEach((li, i) => {
          li.querySelector('.n').textContent = String(i + 1);
          li.querySelector('[data-mv="-1"]').disabled = i === 0;
          li.querySelector('[data-mv="1"]').disabled = i === list.children.length - 1;
        });
        renumber();
        list.addEventListener('click', (e) => {
          const b = e.target.closest('[data-mv]');
          if (!b) return;
          const li = b.closest('li');
          if (b.dataset.mv === '-1' && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
          if (b.dataset.mv === '1' && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
          renumber();
        });
        let drag = null;
        list.addEventListener('pointerdown', (e) => {
          const li = e.target.closest('.order-item');
          if (!li || e.target.closest('button')) return;
          drag = li; li.classList.add('dragging'); li.setPointerCapture(e.pointerId);
        });
        list.addEventListener('pointermove', (e) => {
          if (!drag) return;
          const over = document.elementFromPoint(e.clientX, e.clientY);
          const target = over && over.closest('.order-item');
          if (target && target !== drag && target.parentNode === list) {
            const r = target.getBoundingClientRect();
            list.insertBefore(drag, e.clientY < r.top + r.height / 2 ? target : target.nextElementSibling);
            renumber();
          }
        });
        const end = () => { if (drag) { drag.classList.remove('dragging'); drag = null; } };
        list.addEventListener('pointerup', end);
        list.addEventListener('pointercancel', end);
        $('#submit', stage).addEventListener('click', () => {
          if (S.phase === 'question') submit({ order: Array.from(list.children).map((li) => li.dataset.id) });
        });
      }
    }

    function center(content) {
      S.phase = S.phase === 'finished' ? 'finished' : 'between';
      mount(stage, html`<div class="game-center">${content}</div>`);
    }

    /* ---------------- Flow ---------------- */
    async function submit(response) {
      if (S.phase !== 'question' || S.busy) return;
      S.phase = 'submitting';
      S.busy = true;
      S.seq++;
      clearInterval(S.qTimer);
      const index = S.state.index;
      try {
        const r = await QZ.call('attempt_answer', { attempt_id: attemptId, index, response });
        S.state = r.state;
        updateTop();
        if (!r.accepted) { S.busy = false; return apply(false); }
        await showFeedback(r.feedback, response === null);
      } catch (e) {
        S.busy = false;
        if (e.code === 'network') {
          banner('Connexion perdue… nouvel essai');
          S.phase = 'question';
          setTimeout(() => submit(response), 1500);
          return;
        }
        QZ.fail(e);
        return;
      }
      S.busy = false;
      apply(true);
    }

    function showFeedback(fb, timeout) {
      return new Promise((resolve) => {
        const done = () => { clearTimeout(S.feedbackTimer); overlay('fb', null); document.getElementById('fbx') && document.getElementById('fbx').remove(); resolve(); };
        const el = document.createElement('div');
        el.id = 'fbx';
        el.setAttribute('data-qz', '');
        if (fb && fb.correct !== undefined) {
          const kind = fb.timeout ? 'bad' : fb.correct ? 'good' : fb.fraction > 0 ? 'part' : 'bad';
          const title = fb.timeout ? 'Temps écoulé !' : fb.correct ? 'Bonne réponse !' : fb.fraction > 0 ? 'Presque !' : 'Mauvaise réponse';
          el.className = 'fb ' + kind;
          mount(el, html`<div class="fb-icon">${fb.correct ? icon('check') : icon(fb.timeout ? 'clock' : 'x')}</div>
            <h2>${title}</h2>
            ${fb.points_gained ? html`<div class="pts">+ ${fmt.num(fb.points_gained, 0)} points</div>` : ''}
            ${fb.streak > 1 ? html`<div class="row" style="font-weight:800">${icon('fire')}Série de ${fb.streak} bonnes réponses</div>` : ''}
            ${!fb.correct ? html`<div class="expl">${correctText(fb)}</div>` : ''}
            ${fb.explanation ? html`<div class="expl">${fb.explanation}</div>` : ''}
            <button class="btn-game" data-next>${S.state.status === 'finished' ? 'Voir mon résultat' : 'Question suivante'}${icon('play')}</button>`);
          el.querySelector('[data-next]').addEventListener('click', done);
          S.feedbackTimer = setTimeout(done, fb.explanation ? 15000 : 6000);
        } else {
          el.className = 'fb ' + (timeout || (fb && fb.timeout) ? 'bad' : 'neutral');
          mount(el, html`<div class="fb-icon">${timeout || (fb && fb.timeout) ? icon('clock') : icon('check')}</div><h2>${timeout || (fb && fb.timeout) ? 'Temps écoulé !' : 'Réponse enregistrée'}</h2>`);
          S.feedbackTimer = setTimeout(done, timeout ? 1300 : 750);
        }
        document.body.appendChild(el);
      });
    }

    function correctText(fb) {
      const c = fb.correction;
      if (!c) return '';
      if (c.choices) return 'Bonne réponse : ' + c.choices.filter((x) => x.correct).map((x) => x.text).join(' · ');
      if (c.value === true || c.value === false) return 'Bonne réponse : ' + (c.value ? 'Vrai' : 'Faux');
      if (c.answers) return 'Réponse attendue : ' + c.answers[0];
      if (c.items) return 'Bon ordre : ' + c.items.map((x, i) => (i + 1) + '. ' + x.text).join('  ');
      if (c.value !== undefined) return 'Bonne réponse : ' + fmt.num(c.value, 4) + ' ' + (c.unit || '');
      return '';
    }

    async function serve() {
      if (S.busy || S.destroyed) return;
      S.busy = true;
      S.seq++;
      try {
        S.state = await QZ.call('attempt_state', { attempt_id: attemptId, serve: true });
      } catch (e) {
        S.busy = false;
        if (e.code === 'network') { banner('Connexion perdue… nouvel essai'); setTimeout(serve, 1500); return; }
        return QZ.fail(e);
      }
      S.busy = false;
      apply(false);
    }

    async function refresh(fresh) {
      try {
        S.state = await QZ.call('attempt_state', { attempt_id: attemptId, fresh: !!fresh });
      } catch (e) {
        if (e.code === 'network') { setTimeout(() => refresh(fresh), 1500); return; }
        return QZ.fail(e);
      }
      apply(false);
    }

    /** Reconciles the UI with the authoritative server state. */
    function apply(afterAnswer) {
      const st = S.state;
      if (!st || S.destroyed) return;
      updateTop();
      handleWarning(st.warning);
      if (st.status === 'finished') return finish();
      if (st.status === 'locked') return showLock();
      overlay('lock', null);
      if (st.question) {
        if (S.phase !== 'question' || S.lastIndexShown !== st.index) renderQuestion(st.question);
        return;
      }
      if (S.phase === 'question' || S.phase === 'submitting') S.phase = 'between';
      if (st.index === 0 && S.lastIndexShown === -1 && !afterAnswer) return countdown();
      center(html`<div class="spinner" style="border-color:rgba(255,255,255,.2);border-top-color:#fff"></div>`);
      serve();
    }

    function countdown() {
      S.phase = 'countdown';
      let n = 3;
      const step = () => {
        if (S.destroyed || S.phase !== 'countdown') return;
        if (n === 0) { S.phase = 'between'; return serve(); }
        center(html`<p style="font-weight:800;opacity:.85">${S.state.quiz.title}</p><div class="big-count" aria-live="polite">${n}</div><p style="opacity:.8">Prépare-toi…</p>`);
        S.phase = 'countdown';
        n--;
        setTimeout(step, 900);
      };
      step();
    }

    function showLock() {
      clearInterval(S.qTimer);
      S.phase = 'locked';
      const st = S.state;
      overlay('lock', html`<div class="box">
        <div class="ring">${icon('lock')}</div>
        <h2>Quiz verrouillé</h2>
        <p><b>${st.lock_reason || 'Sortie du quiz détectée'}</b></p>
        <p>La question en cours a été annulée. Lève la main : seule ${teacherName} peut débloquer ton quiz.</p>
        <p class="small" style="opacity:.8">Ne ferme pas cette page. Elle se débloquera toute seule.</p>
        ${st.is_preview ? html`<button class="btn-game" id="pv-unlock">${icon('unlock')}Débloquer (aperçu)</button>` : ''}
      </div>`);
      const b = document.getElementById('pv-unlock');
      if (b) b.addEventListener('click', async () => { S.state = await QZ.call('attempt_preview_unlock', { attempt_id: attemptId }); apply(false); });
      mount(stage, html`<div class="game-center"></div>`);
    }

    function handleWarning(w) {
      if (!w || S.lastWarn === w.id) return;
      S.lastWarn = w.id;
      QZ.beep('warn');
      overlay('warning', html`<div class="box">
        <div class="ring" style="background:#fef3c7;color:#b45309">${icon('alert')}</div>
        <h2 style="color:#1c1631">Message de ${teacherName}</h2>
        <p style="color:#1c1631;font-weight:700">${w.text}</p>
        <button class="btn-game" style="background:#1c1631;color:#fff" id="ack">J’ai compris</button>
      </div>`);
      document.getElementById('ack').addEventListener('click', async () => {
        overlay('warning', null);
        try { S.state = await QZ.call('attempt_ack_warning', { attempt_id: attemptId }); } catch (e) { /* ignore */ }
      });
    }

    function finish() {
      if (S.finished) return;
      S.finished = true;
      S.phase = 'finished';
      clearInterval(S.qTimer);
      stopWatch();
      overlay('lock', null);
      overlay('shield', null);
      overlay('fs', null);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      const st = S.state;
      const r = st.result;
      const excluded = st.finish_reason === 'excluded';
      $('#g-count', root).textContent = 'Terminé';
      $('#g-bar', root).style.width = '100%';
      const back = preview ? '/prof/quiz/' + st.quiz.id : '/eleve';
      center(html`
        <div class="fb-icon" style="width:96px;height:96px;border-radius:50%;background:rgba(255,255,255,.15);display:grid;place-items:center">${excluded ? icon('ban', 'icon-lg') : icon('flag', 'icon-lg')}</div>
        <h2>${excluded ? 'Tu as été exclu du quiz' : st.finish_reason === 'timeout' ? 'Temps écoulé : quiz terminé' : st.finish_reason === 'exits' ? 'Quiz terminé (sorties)' : st.finish_reason === 'teacher' ? 'Quiz arrêté par ' + teacherName : 'Quiz terminé !'}</h2>
        ${r ? html`<div class="big-note" style="color:#fff">${r.zeroed ? '0' : fmt.note(r.note20)}<small style="color:rgba(255,255,255,.7)">/20</small></div>
          <p style="font-weight:700">${fmt.num(r.score)} / ${fmt.num(r.max_score)} points${st.quiz.feedback_mode === 'immediate' ? ' · ' + fmt.num(r.points, 0) + ' points Kahoot' : ''}</p>`
          : html`<p style="max-width:44ch;font-weight:600;opacity:.9">Ta copie est enregistrée. ${teacherName} publiera les notes et la correction plus tard.</p>`}
        <div class="game-actions" style="flex-wrap:wrap">
          ${r && !preview ? html`<button class="btn-game" data-go="/eleve/resultat/${st.attempt_id}">${icon('doc')}Ma correction</button>` : ''}
          ${r && !preview && st.quiz.show_leaderboard ? html`<button class="btn-game ghost" data-go="/eleve/classement/${st.quiz.id}">${icon('trophy')}Classement</button>` : ''}
          <button class="btn-game ghost" data-go="${back}">${preview ? 'Retour à l’éditeur' : 'Retour à mes quiz'}</button>
        </div>`);
      stage.addEventListener('click', (e) => { const t = e.target.closest('[data-go]'); if (t) QZ.go(t.dataset.go); });
      if (r && !r.zeroed && r.note20 >= 10) confetti();
    }

    function confetti() {
      const c = document.createElement('canvas');
      c.setAttribute('data-qz', '');
      c.style.cssText = 'position:fixed;inset:0;z-index:110;pointer-events:none';
      c.width = innerWidth; c.height = innerHeight;
      document.body.appendChild(c);
      const ctx = c.getContext('2d');
      const colors = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#fff'];
      const bits = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.5, r: 4 + Math.random() * 6, vy: 2 + Math.random() * 4, vx: -1.5 + Math.random() * 3, a: Math.random() * 6, col: colors[Math.floor(Math.random() * colors.length)] }));
      let frames = 0;
      const draw = () => {
        ctx.clearRect(0, 0, c.width, c.height);
        bits.forEach((b) => { b.y += b.vy; b.x += b.vx; b.a += 0.1; ctx.fillStyle = b.col; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillRect(-b.r / 2, -b.r / 2, b.r, b.r * 0.6); ctx.restore(); });
        if (++frames < 220 && !S.destroyed) requestAnimationFrame(draw); else c.remove();
      };
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) draw(); else c.remove();
      QZ.onCleanup(() => c.remove());
    }

    /* ---------------- Anti-cheat watch ---------------- */
    const active = () => !S.finished && !S.destroyed && S.state && S.state.status !== 'finished';

    function report(type, detail) {
      if (!active()) return;
      QZ.call('attempt_event', { attempt_id: attemptId, type, detail: detail || '' }).then((r) => onEventResult(r)).catch(() => {});
    }
    function reportOnce(key, type, detail) {
      if (S.reported.has(key)) return;
      S.reported.add(key);
      report(type, detail);
    }

    function onEventResult(r) {
      if (!r || !r.state || S.destroyed || S.busy) return;
      const wasQuestion = S.phase === 'question';
      S.seq++;
      S.state = r.state;
      if (r.action === 'warn' && r.cancelled) banner('Sortie détectée : la question a été annulée (0 point).');
      else if (r.action === 'warn') banner('Sortie détectée et signalée à ' + teacherName + '.');
      if (r.action === 'lock' || r.action === 'submit' || (wasQuestion && !r.state.question) || r.state.status !== 'in_progress') {
        clearInterval(S.qTimer);
        if (S.phase === 'question') S.phase = 'between';
        apply(false);
      }
    }

    function startAway(type, detail) {
      if (!active()) return;
      if (S.away) { if (type === 'hidden') S.away.type = 'hidden'; return; }
      S.away = { key: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), type, start: Date.now() };
      QZ.beacon('attempt_event', { attempt_id: attemptId, type, exit_key: S.away.key, detail: detail || '' });
    }
    function endAway() {
      const a = S.away;
      if (!a) return;
      S.away = null;
      if (!active()) return;
      QZ.call('attempt_event', { attempt_id: attemptId, type: a.type, exit_key: a.key, duration_ms: Date.now() - a.start, detail: 'Retour après ' + fmt.dur(Date.now() - a.start) })
        .then(onEventResult).catch(() => {});
    }

    function shield(on) {
      if (!active()) return overlay('shield', null);
      overlay('shield', on ? html`<div class="box"><div class="ring">${icon('eyeoff')}</div><h2>Reviens sur le quiz</h2><p>La question est masquée quand le quiz n’est plus au premier plan. Ta sortie est enregistrée.</p></div>` : null);
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        clearTimeout(S.blurTimer);
        startAway('hidden', 'Page ou application quittée');
      } else {
        endAway();
        requestWakeLock();
        if (document.hasFocus()) shield(false);
      }
    }
    function onBlur() {
      if (!active()) return;
      shield(true);
      clearTimeout(S.blurTimer);
      S.blurTimer = setTimeout(() => { if (!document.hasFocus() && document.visibilityState === 'visible') startAway('blur', 'Autre fenêtre ou application au premier plan'); }, BLUR_GRACE_MS);
    }
    function onFocus() {
      clearTimeout(S.blurTimer);
      if (document.visibilityState === 'visible') { shield(false); endAway(); }
    }

    const fsSupported = () => !!(document.documentElement.requestFullscreen) && !mobile;
    const inFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    function needFs() { return !!(S.state && S.state.quiz.require_fullscreen && fsSupported() && !S.fsUnavailable); }
    function onFsChange() {
      if (inFs()) S.fsEntered = true;
      if (!active() || !needFs() || !S.fsEntered) return;
      if (!inFs()) {
        startAway('fullscreen', 'Sortie du plein écran');
        showFsOverlay();
      } else {
        overlay('fs', null);
        if (S.away && S.away.type === 'fullscreen') endAway();
      }
    }
    function showFsOverlay() {
      const el = overlay('fs', html`<div class="box"><div class="ring">${icon('laptop')}</div><h2>Plein écran obligatoire</h2><p>Ce quiz doit rester en plein écran. Chaque sortie est comptée et annule la question en cours.</p><button class="btn-game" id="fs-back">Revenir en plein écran</button></div>`);
      el.className = 'game-overlay lock';
      document.getElementById('fs-back').addEventListener('click', () => {
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
          S.fsUnavailable = true;
          overlay('fs', null);
          banner('Plein écran refusé par le navigateur : la surveillance reste active.');
        });
      });
    }
    /** Waits until the quiz runs fullscreen (desktop) — or until the browser refuses it. */
    function ensureFullscreen() {
      return new Promise((resolve) => {
        if (inFs()) S.fsEntered = true;
        if (!needFs() || inFs()) return resolve();
        const el = overlay('fs', html`<div class="box"><div class="ring">${icon('laptop')}</div><h2>Passe en plein écran</h2><p>Le quiz se déroule en plein écran. En sortir comptera comme une sortie du quiz.</p><button class="btn-game" id="fs-go">${icon('play')}Passer en plein écran</button></div>`);
        el.className = 'game-overlay shield';
        document.getElementById('fs-go').addEventListener('click', () => {
          document.documentElement.requestFullscreen({ navigationUI: 'hide' })
            .then(() => { S.fsEntered = true; overlay('fs', null); resolve(); })
            .catch(() => { S.fsUnavailable = true; overlay('fs', null); banner('Plein écran indisponible ici : la surveillance reste active.'); resolve(); });
        });
      });
    }

    function onKey(e) {
      if (!active()) return;
      const k = (e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const inInput = e.target && /^(input|textarea)$/i.test(e.target.tagName);
      if (k === 'f12' || (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(k)) || (e.metaKey && e.altKey && ['i', 'j', 'c', 'u'].includes(k))) {
        e.preventDefault();
        reportOnce('dt-' + S.state.index, 'devtools', 'Raccourci ' + (e.key || ''));
        return;
      }
      if (mod && ['c', 'x', 'v', 'a', 'p', 's', 'u', 'f', 'g', 'h', 'o', 'l', 'd', 'e'].includes(k)) {
        if (inInput && ['a', 'x'].includes(k)) return;
        e.preventDefault();
        reportOnce('sc-' + k + '-' + S.state.index, k === 'v' ? 'paste' : k === 'c' || k === 'x' ? 'copy' : k === 'p' ? 'print' : 'shortcut', 'Ctrl/Cmd + ' + k.toUpperCase());
        return;
      }
      if (k === 'printscreen' || k === 'snapshot') {
        e.preventDefault();
        report('screenshot', 'Touche Impr. écran');
        try { navigator.clipboard && navigator.clipboard.writeText(' '); } catch (err) { /* ignore */ }
      }
      if (e.altKey && k === 'tab') report('shortcut', 'Alt + Tab');
    }
    function onKeyUp(e) {
      if (!active()) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'printscreen') {
        report('screenshot', 'Touche Impr. écran');
        try { navigator.clipboard && navigator.clipboard.writeText(' '); } catch (err) { /* ignore */ }
      }
    }
    function block(type) {
      return (e) => {
        if (!active()) return;
        const inInput = e.target && /^(input|textarea)$/i.test(e.target.tagName);
        if (type === 'copy' || type === 'cut') { e.preventDefault(); reportOnce('cp-' + S.state.index, 'copy', 'Copie bloquée'); }
        else if (type === 'paste') { e.preventDefault(); reportOnce('ps-' + S.state.index, 'paste', 'Collage bloqué'); }
        else if (type === 'contextmenu' || type === 'dragstart') e.preventDefault();
        else if (type === 'selectstart' && !inInput) e.preventDefault();
      };
    }

    let mo = null;
    function scanNode(n) {
      if (!isForeign(n)) return;
      const desc = describeNode(n);
      let txt = desc + ' ' + (n.getAttribute && (n.getAttribute('aria-label') || '')) + ' ' + ((n.shadowRoot || n).textContent || '').slice(0, 300);
      if (QZ.backend) txt = txt.replace(/claude|anthropic/gi, '');
      if (AI_RE.test(txt)) reportOnce('ai-' + desc, 'ai_extension', desc);
      else reportOnce('ext-' + desc, 'extension', desc);
    }
    function startMutationWatch() {
      const all = [...Array.from(document.documentElement.children), ...Array.from(document.body.children)];
      all.forEach((n) => { if (n !== document.head && n !== document.body) scanNode(n); });
      mo = new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(scanNode)));
      mo.observe(document.body, { childList: true });
      mo.observe(document.documentElement, { childList: true });
    }

    let hbId = null;
    let pollId = null;
    let dtId = null;
    let tamperId = null;
    let lastFocusOk = Date.now();
    async function heartbeat() {
      if (!active() || S.busy) return;
      const seqAtSend = S.seq;
      try {
        const st = await QZ.call('attempt_heartbeat', {
          attempt_id: attemptId,
          vis: document.visibilityState,
          focus: document.hasFocus(),
          away_key: S.away ? S.away.key : '',
          away_ms: S.away ? Date.now() - S.away.start : 0
        });
        if (seqAtSend !== S.seq || S.busy || S.destroyed) return;
        const prev = S.state;
        S.state = st;
        const changed = !prev || prev.status !== st.status || (prev.question ? 1 : 0) !== (st.question ? 1 : 0) || prev.index !== st.index;
        if (prev && prev.question && !st.question && st.index > prev.index && st.exits > prev.exits) banner('Question annulée : le quiz n’était plus à l’écran.');
        if (changed && S.phase !== 'submitting' && S.phase !== 'countdown' && !document.getElementById('fbx')) apply(false);
        else { updateTop(); handleWarning(st.warning); }
      } catch (e) {
        if (e.code === 'network') banner('Connexion instable… reste sur cette page.');
      }
    }
    function focusPoll() {
      if (!active()) return;
      const ok = document.visibilityState === 'visible' && document.hasFocus();
      if (ok) { lastFocusOk = Date.now(); return; }
      if (!S.away && Date.now() - lastFocusOk > BLUR_GRACE_MS + 400) {
        shield(true);
        startAway(document.visibilityState === 'hidden' ? 'hidden' : 'blur', 'Détecté par surveillance continue');
      }
    }
    function devtoolsProbe() {
      if (!active() || mobile) return;
      const t = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      if (performance.now() - t > 150) reportOnce('dbg-' + S.state.index, 'devtools', 'Exécution suspendue par les outils de développement');
    }
    function tamperProbe() {
      if (!active()) return;
      const bad = tamperCheck();
      if (bad.length) reportOnce('tp-' + bad.join(','), 'tamper', 'Fonctions modifiées : ' + bad.join(', '));
      if (navigator.webdriver) reportOnce('wd', 'automation', 'navigator.webdriver');
    }

    async function requestWakeLock() {
      try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !S.wakeLock) { S.wakeLock = await navigator.wakeLock.request('screen'); S.wakeLock.addEventListener('release', () => { S.wakeLock = null; }); } } catch (e) { /* not granted */ }
    }

    function startWatch() {
      listen(document, 'visibilitychange', onVisibility);
      listen(window, 'pagehide', () => startAway('hidden', 'Page fermée ou quittée'));
      listen(window, 'blur', onBlur);
      listen(window, 'focus', onFocus);
      listen(document, 'fullscreenchange', onFsChange);
      listen(document, 'webkitfullscreenchange', onFsChange);
      listen(document, 'keydown', onKey, true);
      listen(document, 'keyup', onKeyUp, true);
      ['copy', 'cut', 'paste', 'contextmenu', 'dragstart', 'selectstart'].forEach((t) => listen(document, t, block(t), true));
      listen(window, 'beforeprint', () => report('print', 'Impression'));
      listen(window, 'beforeunload', (e) => { if (active()) { e.preventDefault(); e.returnValue = ''; } });
      listen(document, 'mouseleave', () => { if (active() && !mobile && inFs()) shield(true); });
      listen(document, 'mouseenter', () => { if (!S.away && document.hasFocus()) shield(false); });
      hbId = setInterval(heartbeat, HEARTBEAT_MS);
      pollId = setInterval(focusPoll, 500);
      if (!mobile) dtId = setInterval(devtoolsProbe, 1500);
      tamperId = setInterval(tamperProbe, 8000);
      S.gTimer = setInterval(tickGlobal, 500);
      startMutationWatch();
      tamperProbe();
      requestWakeLock();
      if (window.screen && window.screen.isExtended) banner('Deuxième écran détecté : débranche-le. C’est signalé à ' + teacherName + '.');
    }
    function stopWatch() {
      offs.splice(0).forEach((f) => f());
      [hbId, pollId, dtId, tamperId, S.gTimer, S.qTimer].forEach((id) => clearInterval(id));
      clearTimeout(S.blurTimer);
      clearTimeout(S.feedbackTimer);
      if (mo) mo.disconnect();
      QZ.setGuard(null);
      try { S.wakeLock && S.wakeLock.release(); } catch (e) { /* ignore */ }
    }

    QZ.setGuard((path) => {
      if (!QZ.state.user || !active()) return true;
      report('back', 'Tentative de quitter la page du quiz');
      banner('Tu ne peux pas quitter le quiz avant la fin.');
      return false;
    });
    QZ.onCleanup(() => {
      S.destroyed = true;
      stopWatch();
      ['lock', 'shield', 'fs', 'warning'].forEach((k) => overlay(k, null));
      ['g-banner', 'fbx'].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
    });

    game.addEventListener('click', (e) => {
      if (e.target.closest('[data-quit]')) { S.finished = true; stopWatch(); QZ.go('/prof/quiz/' + (S.state ? S.state.quiz.id : '')); }
    });

    /* ---------------- Boot ---------------- */
    (async () => {
      try {
        S.state = await QZ.call('attempt_state', { attempt_id: attemptId, fresh: true });
      } catch (e) {
        QZ.fail(e);
        return QZ.go(preview ? '/prof' : '/eleve', { replace: true });
      }
      if (S.state.status !== 'finished') {
        startWatch();
        await ensureFullscreen();
      }
      apply(false);
    })();
  };
})(window.QZ = window.QZ || {});
