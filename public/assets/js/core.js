/* Quiz SES — noyau : gabarits sûrs (échappement automatique), API, routeur, composants. */
(function (QZ) {
  'use strict';

  /* ---------------- Templating: every interpolated value is escaped ---------------- */
  class Raw {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
  }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = (s) => String(s).replace(/[&<>"'`]/g, (c) => ESC[c]);
  const raw = (s) => new Raw(String(s));
  function part(v) {
    if (v === null || v === undefined || v === false || v === true) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(part).join('');
    return esc(v);
  }
  function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
    return new Raw(out);
  }
  const nl2br = (s) => raw(esc(s == null ? '' : s).replace(/\n/g, '<br>'));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function mount(el, content) { el.innerHTML = part(content); return el; }
  function delegate(root, type, selector, handler) {
    root.addEventListener(type, (e) => {
      const t = e.target.closest(selector);
      if (t && root.contains(t)) handler(e, t);
    });
  }
  Object.assign(QZ, { Raw, esc, raw, html, nl2br, $, $$, mount, delegate });

  /* ---------------- Icons ---------------- */
  const P = {
    tri: '<path d="M12 3 22 20H2z"/>',
    dia: '<path d="M12 2 22 12 12 22 2 12z"/>',
    cir: '<circle cx="12" cy="12" r="10"/>',
    squ: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
    hex: '<path d="M7 3h10l5 9-5 9H7l-5-9z"/>',
    sta: '<path d="m12 2 3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z"/>',
    pen: '<path d="M12 2 21 8.5 17.5 20h-11L3 8.5z"/>',
    oct: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/>'
  };
  const SHAPES = ['tri', 'dia', 'cir', 'squ', 'hex', 'sta', 'pen', 'oct'];
  const shape = (i) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${P[SHAPES[i % SHAPES.length]]}</svg>`);
  const I = {
    check: '<path d="M5 12l5 5L20 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2.4.6 4 2.3 4 5.2"/>',
    home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
    bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
    laptop: '<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
    tablet: '<rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M11 18h2"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    fire: '<path d="M12 22c4.4 0 7-2.8 7-6.6 0-4.7-4-7-5-11.4-2.2 1.6-3 4-2.6 6.2C9.8 9 9 7.5 8.7 6 6.4 8.2 5 11 5 15.4 5 19.2 7.6 22 12 22z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.7-9.7M17 6l3 3M14 9l2 2"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/>',
    shieldx: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    msg: '<path d="M21 12a8 8 0 0 1-11.6 7.2L3 21l1.8-6.4A8 8 0 1 1 21 12z"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    school: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>',
    doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    sound: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M12 20h.01"/>'
  };
  const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ''}</svg>`);
  const deviceIcon = (d) => icon(/iPhone|Android$/.test(d || '') ? 'phone' : /iPad|Tablette/.test(d || '') ? 'tablet' : 'laptop', 'icon-sm');
  Object.assign(QZ, { icon, shape, deviceIcon });

  /* ---------------- Formatting ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  QZ.fmt = {
    note(n) { return n === null || n === undefined ? '—' : (Math.round(n * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); },
    noteClass(n) { return n === null || n === undefined ? '' : n >= 14 ? 'note-good' : n >= 10 ? 'note-mid' : 'note-bad'; },
    num(n, d = 2) { return n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d }); },
    date(ms) { if (!ms) return '—'; const d = new Date(ms); return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); },
    dateS(s) { return s ? QZ.fmt.date(s * 1000) : '—'; },
    time(ms) { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); },
    dur(ms) {
      if (ms === null || ms === undefined) return '—';
      const s = Math.round(ms / 1000);
      if (s < 60) return s + ' s';
      const m = Math.floor(s / 60);
      if (m < 60) return m + ' min ' + pad(s % 60);
      return Math.floor(m / 60) + ' h ' + pad(m % 60);
    },
    ago(ms) { const s = Math.round(ms / 1000); if (s < 5) return 'à l’instant'; if (s < 60) return 'il y a ' + s + ' s'; const m = Math.round(s / 60); if (m < 60) return 'il y a ' + m + ' min'; return 'il y a ' + Math.round(m / 60) + ' h'; },
    secs(n) { if (!n) return 'sans limite'; return n < 60 ? n + ' s' : (n % 60 ? Math.floor(n / 60) + ' min ' + (n % 60) + ' s' : n / 60 + ' min'); },
    initials(name) { return (name || '?').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase(); },
    plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  };
  QZ.TYPE_LABELS = { single: 'Choix unique', multiple: 'Choix multiples', truefalse: 'Vrai / Faux', short: 'Réponse courte', numeric: 'Numérique', ordering: 'Remettre dans l’ordre' };
  QZ.imgUrl = (f) => (!f ? '' : /^data:image\//.test(f) ? f : 'uploads/' + encodeURIComponent(f));

  /* ---------------- API client ---------------- */
  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  }
  QZ.ApiError = ApiError;
  const API_URL = 'api/index.php';
  QZ.state = { csrf: '', user: null, settings: { site_name: 'Quiz SES', teacher_name: 'Mme Cyrine', allow_registration: true } };

  async function call(action, data = {}, opts = {}) {
    if (QZ.backend) {
      try {
        return await QZ.backend(action, JSON.parse(JSON.stringify(data)));
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'auth' || e.code === 'session_replaced') && !opts.silentAuth) QZ.onAuthLost(e);
        throw e;
      }
    }
    let res;
    try {
      res = await fetch(API_URL + '?a=' + encodeURIComponent(action), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': QZ.state.csrf },
        body: JSON.stringify(data),
        keepalive: !!opts.keepalive
      });
    } catch (e) {
      throw new ApiError('Connexion au serveur impossible. Vérifie ta connexion Internet.', 0, 'network');
    }
    let json;
    try { json = await res.json(); } catch (e) { throw new ApiError('Réponse inattendue du serveur (' + res.status + ').', res.status, 'server'); }
    if (!json.ok) {
      if (json.code === 'csrf' && !opts.retried) {
        await refreshSession();
        return call(action, data, { ...opts, retried: true });
      }
      const err = new ApiError(json.error || 'Erreur', res.status, json.code);
      if ((json.code === 'auth' || json.code === 'session_replaced') && !opts.silentAuth) QZ.onAuthLost(err);
      throw err;
    }
    if (json.data && typeof json.data.csrf === 'string') QZ.state.csrf = json.data.csrf;
    return json.data;
  }

  async function refreshSession() {
    const d = QZ.backend ? await QZ.backend('session', {}) : await (async () => {
      const r = await fetch(API_URL + '?a=session', { credentials: 'same-origin' });
      const j = await r.json();
      if (!j.ok) throw new ApiError(j.error, r.status, j.code);
      return j.data;
    })();
    QZ.state.csrf = d.csrf;
    QZ.state.user = d.user;
    QZ.state.settings = d.settings;
    return d;
  }

  function beacon(action, data) {
    if (QZ.backend) { QZ.backend(action, data).catch(() => {}); return; }
    const body = JSON.stringify(Object.assign({}, data, { _csrf: QZ.state.csrf }));
    const url = API_URL + '?a=' + encodeURIComponent(action);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch (e) { /* fall through */ }
    fetch(url, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body }).catch(() => {});
  }

  async function upload(file) {
    if (QZ.backend) return QZ.backend('t_upload', { file });
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch(API_URL + '?a=t_upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': QZ.state.csrf }, body: fd });
    const json = await res.json().catch(() => ({ ok: false, error: 'Envoi impossible.' }));
    if (!json.ok) throw new ApiError(json.error, res.status, json.code);
    return json.data;
  }

  async function download(action, params, fallbackTitle) {
    if (QZ.backend) {
      const out = await QZ.backend(action, params);
      QZ.modal({
        title: fallbackTitle,
        wide: true,
        body: html`<p class="muted small">Dans la démo, le téléchargement est remplacé par le contenu du fichier (${out.filename}). Sur ton serveur, le fichier se télécharge directement.</p>
          <textarea class="textarea" id="dl-text" rows="14" readonly style="font-family:ui-monospace,Menlo,monospace;font-size:.8rem">${out.content}</textarea>`,
        actions: [{ label: 'Copier', kind: 'primary', close: false, onClick: (m) => { const t = $('#dl-text', m.el); t.select(); navigator.clipboard?.writeText(t.value).then(() => QZ.toast('Copié'), () => {}); } }, { label: 'Fermer' }]
      });
      return;
    }
    window.location.href = API_URL + '?a=' + encodeURIComponent(action) + '&' + new URLSearchParams(params).toString();
  }

  Object.assign(QZ, { call, beacon, upload, download, refreshSession });

  /* ---------------- Toasts ---------------- */
  let toastBox = null;
  QZ.toast = function (message, kind = '', opts = {}) {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('role', 'status'); document.body.appendChild(toastBox); }
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    mount(el, html`${icon(kind === 'bad' || kind === 'alert' ? 'alert' : kind === 'good' ? 'check' : 'info')}<div class="grow"><span>${message}</span>${opts.sub ? html`<small>${opts.sub}</small>` : ''}</div>${opts.action ? html`<button class="btn btn-sm" data-act="go">${opts.action.label}</button>` : ''}`);
    if (opts.action) el.querySelector('[data-act="go"]').addEventListener('click', () => { opts.action.onClick(); el.remove(); });
    toastBox.appendChild(el);
    setTimeout(() => el.remove(), opts.duration || (opts.action ? 9000 : 3800));
  };
  QZ.fail = (e) => QZ.toast(e && e.message ? e.message : 'Une erreur est survenue.', 'bad');

  /* ---------------- Modals (no native alert/confirm: they are blocked in some viewers) ---------------- */
  QZ.modal = function ({ title, body, actions = [{ label: 'Fermer' }], wide = false, onMount, dismissible = true }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    mount(back, html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head"><h2>${title}</h2>${dismissible ? html`<button class="btn btn-ghost btn-icon" data-close aria-label="Fermer">${icon('x')}</button>` : ''}</div>
      <div class="modal-body">${body}</div>
      ${actions.length ? html`<div class="modal-foot">${actions.map((a, i) => html`<button class="btn ${a.kind ? 'btn-' + a.kind : ''}" data-i="${i}">${a.icon ? icon(a.icon) : ''}${a.label}</button>`)}</div>` : ''}
    </div>`);
    const m = { el: back, close() { back.remove(); document.removeEventListener('keydown', onKey); if (m.onClose) m.onClose(); } };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) m.close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', async (e) => {
      if (e.target === back && dismissible) return m.close();
      if (e.target.closest('[data-close]')) return m.close();
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const a = actions[+b.dataset.i];
      if (a.onClick) {
        b.disabled = true;
        try {
          const r = await a.onClick(m, b);
          if (r === false) { b.disabled = false; return; }
        } catch (err) { QZ.fail(err); b.disabled = false; return; }
        b.disabled = false;
      }
      if (a.close !== false) m.close();
    });
    document.body.appendChild(back);
    const first = back.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    if (onMount) onMount(m);
    return m;
  };
  QZ.confirm = function ({ title, message, confirmLabel = 'Confirmer', danger = false }) {
    return new Promise((resolve) => {
      const m = QZ.modal({
        title,
        body: html`<p>${message}</p>`,
        actions: [{ label: 'Annuler', onClick: () => resolve(false) }, { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => { resolve(true); } }]
      });
      m.onClose = () => resolve(false);
    });
  };
  QZ.promptText = function ({ title, label, value = '', placeholder = '', confirmLabel = 'Valider', multiline = false, presets = [] }) {
    return new Promise((resolve) => {
      let done = false;
      const m = QZ.modal({
        title,
        body: html`<div class="field"><label for="pt-in">${label}</label>
          ${multiline ? html`<textarea class="textarea" id="pt-in" placeholder="${placeholder}" maxlength="300">${value}</textarea>` : html`<input class="input" id="pt-in" value="${value}" placeholder="${placeholder}">`}</div>
          ${presets.length ? html`<div class="stack-sm">${presets.map((p, i) => html`<button type="button" class="btn btn-sm" style="justify-content:flex-start;white-space:normal;text-align:left;min-height:38px;height:auto;padding:8px 12px" data-preset="${i}">${p}</button>`)}</div>` : ''}`,
        actions: [{ label: 'Annuler' }, { label: confirmLabel, kind: 'primary', onClick: (mm) => { done = true; resolve($('#pt-in', mm.el).value.trim()); } }],
        onMount: (mm) => QZ.delegate(mm.el, 'click', '[data-preset]', (e, t) => { $('#pt-in', mm.el).value = presets[+t.dataset.preset]; })
      });
      m.onClose = () => { if (!done) resolve(null); };
    });
  };

  /* ---------------- Router (hash based) ---------------- */
  const routes = [];
  let current = null;
  let guard = null;
  QZ.route = (pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ re, keys, handler });
  };
  QZ.setGuard = (fn) => { guard = fn; };
  QZ.currentPath = () => current;
  QZ.go = (path, { replace = false } = {}) => {
    if (guard && guard(path) === false) return;
    current = path;
    try {
      if (replace) history.replaceState(null, '', '#' + path);
      else if (location.hash !== '#' + path) history.pushState(null, '', '#' + path);
    } catch (e) { /* sandboxed viewers may refuse history changes */ }
    render(path);
  };
  function render(path) {
    QZ.cleanup();
    for (const r of routes) {
      const m = path.match(r.re);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        window.scrollTo(0, 0);
        return r.handler(params);
      }
    }
    QZ.go(QZ.home(), { replace: true });
  }
  window.addEventListener('popstate', () => {
    const path = (location.hash || '#/').slice(1) || '/';
    if (path === current) return;
    if (guard && guard(path) === false) { try { history.pushState(null, '', '#' + current); } catch (e) { /* ignore */ } return; }
    current = path;
    render(path);
  });
  QZ.initialPath = () => (location.hash || '#/').slice(1) || '/';

  /* Views register cleanup callbacks (timers, listeners) that run on navigation. */
  let cleanups = [];
  QZ.onCleanup = (fn) => cleanups.push(fn);
  QZ.cleanup = () => { const c = cleanups; cleanups = []; c.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); };
  QZ.every = (ms, fn) => { const id = setInterval(fn, ms); QZ.onCleanup(() => clearInterval(id)); return id; };

  QZ.home = () => {
    const u = QZ.state.user;
    if (!u) return '/connexion';
    if (u.must_change_password) return '/mot-de-passe';
    return u.role === 'teacher' ? '/prof' : '/eleve';
  };

  QZ.root = () => document.getElementById('app');

  QZ.onAuthLost = (err) => {
    QZ.state.user = null;
    QZ.stopTeacherAlerts && QZ.stopTeacherAlerts();
    QZ.toast(err.message, 'bad', { duration: 7000 });
    QZ.refreshSession().catch(() => {}).finally(() => QZ.go('/connexion', { replace: true }));
  };

  QZ.loading = () => mount(QZ.root(), html`<div class="loading"><div class="spinner"></div></div>`);

  /* Small UI helpers */
  QZ.statusPill = (status, reason, zeroed) => {
    if (zeroed) return html`<span class="pill pill-bad">${icon('ban', 'icon-sm')}Exclu · 0/20</span>`;
    if (status === 'in_progress') return html`<span class="pill pill-info pill-live"><span class="dot"></span>En cours</span>`;
    if (status === 'locked') return html`<span class="pill pill-bad">${icon('lock', 'icon-sm')}Verrouillé</span>`;
    const r = { completed: 'Terminé', timeout: 'Temps écoulé', exits: 'Arrêté (sorties)', teacher: 'Arrêté par la prof', excluded: 'Exclu' }[reason] || 'Terminé';
    return html`<span class="pill ${reason === 'completed' ? 'pill-good' : 'pill-warn'}">${r}</span>`;
  };
  QZ.quizStatusPill = (s) => ({
    open: html`<span class="pill pill-good"><span class="dot"></span>Ouvert</span>`,
    draft: html`<span class="pill">Brouillon</span>`,
    closed: html`<span class="pill pill-warn">Fermé</span>`,
    archived: html`<span class="pill">Archivé</span>`
  }[s] || '');
  QZ.brandLogo = () => html`<span class="brand-logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;

  /* Web Audio beep for teacher alerts (no audio file needed). */
  let audioCtx = null;
  QZ.beep = (kind = 'alert') => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'alert' ? [880, 660, 880] : [660];
      notes.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'square';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.16);
        g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + i * 0.16 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.16 + 0.14);
        o.connect(g).connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * 0.16);
        o.stop(audioCtx.currentTime + i * 0.16 + 0.15);
      });
    } catch (e) { /* audio unavailable */ }
  };
  QZ.unlockAudio = () => { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) { /* ignore */ } };

  QZ.store = {
    get(k, d = null) { try { const v = localStorage.getItem('qz.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('qz.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
})(window.QZ = window.QZ || {});
