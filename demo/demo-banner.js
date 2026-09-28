/* Quiz SES — bandeau de la démo (identifiants de test + réinitialisation). */
(function (QZ) {
  'use strict';
  const { html, mount } = QZ;
  function show() {
    const el = document.createElement('div');
    el.className = 'demo-banner';
    el.setAttribute('data-qz', '');
    el.setAttribute('role', 'note');
    const draw = (open) => {
      mount(el, open
        ? html`<div class="demo-inner">
            <span><b>Démo</b> : tout est enregistré dans ce navigateur uniquement.</span>
            <span>Prof : <code>cyrine</code> / <code>cyrine2026</code></span>
            <span>Élève test : Emma Leroy / <code>demo2026</code> (ou crée un compte)</span>
            <span class="row" style="gap:6px"><button type="button" data-reset>Réinitialiser la démo</button><button type="button" data-min>Réduire</button></span>
          </div>`
        : html`<button type="button" data-max><b>Démo</b> · identifiants</button>`);
    };
    let open = QZ.store.get('demoBanner', true);
    draw(open);
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-min]')) { open = false; QZ.store.set('demoBanner', false); draw(false); }
      if (e.target.closest('[data-max]')) { open = true; QZ.store.set('demoBanner', true); draw(true); }
      if (e.target.closest('[data-reset]')) {
        const ok = await QZ.confirm({ title: 'Réinitialiser la démo ?', message: 'Toutes les modifications faites dans cette démo (comptes, quiz, copies) seront effacées de ce navigateur.', confirmLabel: 'Réinitialiser', danger: true });
        if (!ok) return;
        QZ.demoReset();
        QZ.state.user = null;
        QZ.stopTeacherAlerts && QZ.stopTeacherAlerts();
        await QZ.refreshSession();
        QZ.go('/connexion', { replace: true });
        QZ.toast('Démo réinitialisée', 'good');
      }
    });
    document.body.appendChild(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})(window.QZ = window.QZ || {});
