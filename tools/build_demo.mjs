// Construit la démo autonome (une seule page HTML) : interface réelle + serveur de démo dans le navigateur.
// Usage : node tools/build_demo.mjs <fichier_sortie.html> [--standalone]
//   --standalone : ajoute <!doctype html><html>… pour ouvrir le fichier directement dans un navigateur.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
const standalone = process.argv.includes('--standalone');
if (!out) {
  console.error('Usage : node tools/build_demo.mjs <sortie.html> [--standalone]');
  process.exit(1);
}
const read = (p) => readFileSync(join(root, p), 'utf8');
const js = ['core', 'auth', 'student', 'player', 'teacher', 'live', 'editor', 'results'].map((f) => read(`public/assets/js/${f}.js`));
const scripts = [...js, read('demo/demo-backend.js'), read('demo/demo-banner.js'), read('public/assets/js/app.js')];
for (const s of scripts) {
  if (/<\/script/i.test(s)) throw new Error('Un script contient « </script » : impossible de l’insérer tel quel.');
}
const data = JSON.stringify(JSON.parse(read('database/demo_quizzes.json'))).replace(/</g, '\\u003c');
const css = read('public/assets/css/app.css') + '\n' + read('demo/demo.css');

const body = `<title>Quiz SES</title>
<style>
${css}
</style>
<div id="app"><div class="loading"><div class="spinner"></div></div></div>
<script>window.QZ_DEMO_DATA = ${data};</script>
${scripts.map((s) => `<script>\n${s}\n</script>`).join('\n')}
`;

const html = standalone
  ? `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n${body}</body></html>\n`
  : body;
writeFileSync(out, html);
console.log(`Démo écrite : ${out} (${Math.round(html.length / 1024)} Ko)`);
