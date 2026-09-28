/* Quiz SES — connexion, inscription, mot de passe. */
(function (QZ) {
  'use strict';
  const { html, icon, shape, mount, $, delegate } = QZ;

  function brandPanel() {
    const s = QZ.state.settings;
    return html`<section class="auth-brand">
      <div class="brand-mark">${QZ.brandLogo()}<span>${s.site_name}</span></div>
      <div class="stack">
        <h1>Les quiz de SES de ${s.teacher_name}</h1>
        <p>Des quiz notés, chronométrés et surveillés : une question à la fois, et chaque sortie de l’écran est détectée.</p>
        <div class="auth-shapes" aria-hidden="true">
          <span style="background:var(--t-red)">${shape(0)}</span><span style="background:var(--t-blue)">${shape(1)}</span><span style="background:var(--t-yellow)">${shape(2)}</span><span style="background:var(--t-green)">${shape(3)}</span>
        </div>
      </div>
      <svg class="auth-chart" viewBox="0 0 400 200" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 190V10M10 190h380"/><path d="M20 170l50-22 45 8 50-40 45 10 55-52 45 6 60-58"/>
      </svg>
      <p class="small" style="opacity:.7">Sciences économiques et sociales · Seconde, Première, Terminale</p>
    </section>`;
  }

  function passwordField(id, label, autocomplete) {
    return html`<div class="field"><label for="${id}">${label}</label>
      <div style="position:relative"><input class="input" id="${id}" type="password" autocomplete="${autocomplete}" required style="padding-right:48px">
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-eye="${id}" aria-label="Afficher le mot de passe" style="position:absolute;right:4px;top:6px">${icon('eye')}</button></div></div>`;
  }

  function bindEyes(root) {
    delegate(root, 'click', '[data-eye]', (e, t) => {
      const input = $('#' + t.dataset.eye, root);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }

  function showError(root, msg) {
    const box = $('.error-box', root);
    box.textContent = msg;
    box.hidden = !msg;
  }

  async function submitWith(form, fn) {
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    showError(form, '');
    try {
      await fn();
    } catch (e) {
      showError(form, e.message || 'Erreur');
    } finally {
      btn.disabled = false;
    }
  }

  function afterLogin(data) {
    QZ.state.user = data.user;
    QZ.go(QZ.home(), { replace: true });
  }

  QZ.route('/connexion', () => {
    if (QZ.state.user) return QZ.go(QZ.home(), { replace: true });
    let tab = QZ.store.get('loginTab', 'student');
    const root = QZ.root();
    const draw = () => {
      mount(root, html`<div class="auth">${brandPanel()}
        <section class="auth-panel"><div class="auth-box">
          <div><h2 style="font-size:1.6rem">Connexion</h2><p class="muted">Content de te revoir.</p></div>
          <div class="tabs" role="tablist">
            <button class="tab ${tab === 'student' ? 'active' : ''}" data-tab="student" role="tab">${icon('school')}Élève</button>
            <button class="tab ${tab === 'teacher' ? 'active' : ''}" data-tab="teacher" role="tab">${icon('key')}Professeure</button>
          </div>
          ${tab === 'student' ? html`
            <form class="stack" id="f-student" novalidate>
              <div class="form-grid" style="grid-template-columns:1fr 1fr">
                <div class="field"><label for="ls-first">Prénom</label><input class="input" id="ls-first" autocomplete="given-name" required></div>
                <div class="field"><label for="ls-last">Nom</label><input class="input" id="ls-last" autocomplete="family-name" required></div>
              </div>
              ${passwordField('ls-pass', 'Mot de passe', 'current-password')}
              <div class="error-box" hidden></div>
              <button class="btn btn-primary btn-lg btn-block" type="submit">Se connecter</button>
              <p class="small muted">Mot de passe oublié ? Demande à ${QZ.state.settings.teacher_name} de le réinitialiser.</p>
            </form>
            ${QZ.state.settings.allow_registration ? html`<div class="card-flat row-between"><span>Pas encore de compte ?</span><a class="btn btn-sm" href="#/inscription" data-go="/inscription">Créer mon compte</a></div>` : html`<p class="small muted">Les inscriptions sont fermées.</p>`}
          ` : html`
            <form class="stack" id="f-teacher" novalidate>
              <div class="field"><label for="lt-user">Identifiant</label><input class="input" id="lt-user" autocomplete="username" autocapitalize="none" required></div>
              ${passwordField('lt-pass', 'Mot de passe', 'current-password')}
              <div class="error-box" hidden></div>
              <button class="btn btn-primary btn-lg btn-block" type="submit">Accéder à mon espace</button>
            </form>`}
        </div></section></div>`);
      const fs = $('#f-student', root);
      if (fs) {
        fs.addEventListener('submit', (e) => {
          e.preventDefault();
          submitWith(fs, async () => afterLogin(await QZ.call('login_student', { first_name: $('#ls-first').value, last_name: $('#ls-last').value, password: $('#ls-pass').value })));
        });
      }
      const ft = $('#f-teacher', root);
      if (ft) {
        ft.addEventListener('submit', (e) => {
          e.preventDefault();
          submitWith(ft, async () => afterLogin(await QZ.call('login_teacher', { username: $('#lt-user').value, password: $('#lt-pass').value })));
        });
      }
    };
    draw();
    delegate(root, 'click', '[data-tab]', (e, t) => { tab = t.dataset.tab; QZ.store.set('loginTab', tab); draw(); });
    delegate(root, 'click', '[data-go]', (e, t) => { e.preventDefault(); QZ.go(t.dataset.go); });
    bindEyes(root);
  });

  QZ.route('/inscription', () => {
    if (QZ.state.user) return QZ.go(QZ.home(), { replace: true });
    const root = QZ.root();
    mount(root, html`<div class="auth">${brandPanel()}
      <section class="auth-panel"><div class="auth-box">
        <div><h2 style="font-size:1.6rem">Créer mon compte élève</h2><p class="muted">Utilise ton vrai prénom et ton vrai nom : ${QZ.state.settings.teacher_name} vérifie chaque compte.</p></div>
        <form class="stack" id="f-reg" novalidate>
          <div class="form-grid" style="grid-template-columns:1fr 1fr">
            <div class="field"><label for="r-first">Prénom</label><input class="input" id="r-first" autocomplete="given-name" maxlength="60" required></div>
            <div class="field"><label for="r-last">Nom</label><input class="input" id="r-last" autocomplete="family-name" maxlength="60" required></div>
          </div>
          ${passwordField('r-pass', 'Mot de passe (6 caractères minimum)', 'new-password')}
          ${passwordField('r-pass2', 'Confirme le mot de passe', 'new-password')}
          <div class="error-box" hidden></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Créer mon compte</button>
        </form>
        <div class="card-flat row-between"><span>Déjà inscrit ?</span><a class="btn btn-sm" href="#/connexion" data-go="/connexion">Se connecter</a></div>
      </div></section></div>`);
    const f = $('#f-reg', root);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      submitWith(f, async () => {
        if ($('#r-pass').value !== $('#r-pass2').value) throw new Error('Les deux mots de passe ne sont pas identiques.');
        afterLogin(await QZ.call('register', { first_name: $('#r-first').value, last_name: $('#r-last').value, password: $('#r-pass').value }));
      });
    });
    delegate(root, 'click', '[data-go]', (e, t) => { e.preventDefault(); QZ.go(t.dataset.go); });
    bindEyes(root);
  });

  QZ.route('/mot-de-passe', () => {
    const u = QZ.state.user;
    if (!u) return QZ.go('/connexion', { replace: true });
    const forced = u.must_change_password;
    const min = u.role === 'teacher' ? 10 : 6;
    const root = QZ.root();
    mount(root, html`<div class="auth">${brandPanel()}
      <section class="auth-panel"><div class="auth-box">
        <div><h2 style="font-size:1.6rem">${forced ? 'Choisis ton nouveau mot de passe' : 'Changer de mot de passe'}</h2>
        <p class="muted">${forced ? (u.role === 'teacher' ? 'Le mot de passe provisoire doit être remplacé avant d’accéder à ton espace.' : 'Ta professeure a réinitialisé ton mot de passe : choisis-en un nouveau.') : 'Ton mot de passe protège tes notes.'}</p></div>
        <form class="stack" id="f-pw" novalidate>
          ${passwordField('p-cur', forced ? 'Mot de passe provisoire' : 'Mot de passe actuel', 'current-password')}
          ${passwordField('p-new', `Nouveau mot de passe (${min} caractères minimum${u.role === 'teacher' ? ', lettres et chiffres' : ''})`, 'new-password')}
          ${passwordField('p-new2', 'Confirme le nouveau mot de passe', 'new-password')}
          <div class="error-box" hidden></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Enregistrer</button>
          ${forced ? html`<button type="button" class="btn btn-ghost" data-logout>Se déconnecter</button>` : html`<button type="button" class="btn btn-ghost" data-back>Retour</button>`}
        </form>
      </div></section></div>`);
    const f = $('#f-pw', root);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      submitWith(f, async () => {
        if ($('#p-new').value !== $('#p-new2').value) throw new Error('Les deux mots de passe ne sont pas identiques.');
        const d = await QZ.call('change_password', { current: $('#p-cur').value, new: $('#p-new').value });
        QZ.state.user = d.user;
        QZ.toast('Mot de passe enregistré', 'good');
        QZ.go(QZ.home(), { replace: true });
      });
    });
    delegate(root, 'click', '[data-logout]', () => QZ.logout());
    delegate(root, 'click', '[data-back]', () => QZ.go(QZ.home()));
    bindEyes(root);
  });

  QZ.logout = async () => {
    try { await QZ.call('logout', {}, { silentAuth: true }); } catch (e) { /* ignore */ }
    QZ.state.user = null;
    QZ.stopTeacherAlerts && QZ.stopTeacherAlerts();
    QZ.go('/connexion', { replace: true });
  };
})(window.QZ = window.QZ || {});
