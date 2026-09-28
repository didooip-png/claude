/* Quiz SES — démarrage. */
(function (QZ) {
  'use strict';
  const { html, icon, mount } = QZ;

  QZ.route('/', () => QZ.go(QZ.home(), { replace: true }));

  async function boot() {
    QZ.trusted = new WeakSet();
    [...document.documentElement.children, ...document.body.children].forEach((n) => QZ.trusted.add(n));
    let d;
    try {
      d = await QZ.refreshSession();
    } catch (e) {
      mount(QZ.root(), html`<div class="auth-panel" style="min-height:100%"><div class="card stack" style="max-width:520px">
        <h1>${icon('alert')} Site indisponible</h1>
        <p>${e.message || 'Le serveur ne répond pas.'}</p>
        <p class="muted small">Si tu es l’administratrice : vérifie le fichier config.php et que la base de données a bien été importée (voir le README).</p>
        <button class="btn btn-primary" id="retry">Réessayer</button></div></div>`);
      document.getElementById('retry').addEventListener('click', () => location.reload());
      return;
    }
    document.title = QZ.state.settings.site_name;
    if (d.session_replaced) QZ.toast('Tu as été déconnecté : ton compte a été ouvert sur un autre appareil.', 'bad', { duration: 8000 });
    const path = QZ.initialPath();
    QZ.go(path === '/' ? QZ.home() : path, { replace: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.QZ = window.QZ || {});
