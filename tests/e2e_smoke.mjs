// Parcours complet dans un vrai navigateur (Playwright) : prof sur PC + élève sur iPhone.
// Usage : php -S 127.0.0.1:8080 -t public  puis  node tests/e2e_smoke.mjs [url] [dossier_captures]
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const SHOTS = process.argv[3] || '/tmp';
const errors = [];
let step = 0;
const log = (m) => console.log(`[${++step}] ${m}`);
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

// The quiz refuses automated browsers (navigator.webdriver): hide the flag for this test.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--disable-blink-features=AutomationControlled'] });
const tctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const sctx = await browser.newContext({ ...devices['iPhone 13'] });
const teacher = await tctx.newPage();
const student = await sctx.newPage();
for (const [name, p] of [['prof', teacher], ['élève', student]]) {
  p.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
}

// ---- Teacher first login ----
await teacher.goto(BASE + '/');
await teacher.click('[data-tab="teacher"]');
await teacher.fill('#lt-user', 'cyrine');
await teacher.fill('#lt-pass', 'ChangeMoi2026!');
await teacher.click('#f-teacher button[type="submit"]');
await teacher.waitForSelector('#f-pw');
log('prof : mot de passe provisoire → écran de changement');
await teacher.fill('#p-cur', 'ChangeMoi2026!');
await teacher.fill('#p-new', 'Cyrine2026Ses!');
await teacher.fill('#p-new2', 'Cyrine2026Ses!');
await teacher.click('#f-pw button[type="submit"]');
await teacher.waitForSelector('text=Comptes à valider');
log('prof : tableau de bord');
await shot(teacher, '01-prof-dashboard');

// ---- Student registers on iPhone ----
await student.goto(BASE + '/');
await shot(student, '02-eleve-connexion');
await student.click('text=Créer mon compte');
await student.fill('#r-first', 'Lina');
await student.fill('#r-last', 'Martin');
await student.fill('#r-pass', 'lina-2026');
await student.fill('#r-pass2', 'lina-2026');
await student.click('#f-reg button[type="submit"]');
await student.waitForSelector('text=Compte en attente');
log('élève : compte en attente de validation');

// ---- Teacher validates ----
await teacher.goto(BASE + '/#/prof');
await teacher.reload();
await teacher.waitForSelector('[data-validate-all]');
await teacher.click('[data-validate-all]');
await teacher.waitForSelector('text=Aucun compte en attente');
log('prof : compte validé');
await teacher.goto(BASE + '/#/prof/quiz');
await teacher.reload();
await teacher.locator('.qcard', { hasText: 'La croissance économique' }).locator('[data-edit]').click();
await teacher.click('[data-status="open"]');
await teacher.click('.modal-foot .btn-primary');
await teacher.waitForSelector('[data-status="closed"]');
log('prof : quiz ouvert aux élèves');

// ---- Student starts the quiz ----
await student.click('[data-reload]');
await student.waitForSelector('.qcard');
await shot(student, '03-eleve-quiz');
await student.click('[data-start]');
await student.waitForSelector('#engage');
await shot(student, '04-eleve-consignes');
await student.check('#engage');
await student.click('#go');
await student.waitForSelector('.tile', { timeout: 15000 });
log('élève : 1re question affichée après le compte à rebours');
await shot(student, '05-eleve-question');
const leaked = await student.evaluate(() => document.body.innerHTML.includes('"correct"'));
if (leaked) errors.push('bonne réponse présente dans la page élève');
await student.click('.tile >> nth=0');
await student.waitForSelector('text=Question 2 / 20', { timeout: 10000 });
await student.waitForSelector('.tile');
log('élève : question 2');

// ---- Teacher opens live view ----
await teacher.goto(BASE + '/#/prof/direct');
await teacher.waitForSelector('.scard');
log('prof : élève visible en direct');

// ---- Student leaves the app (simulated iOS app switch) ----
await student.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await student.waitForTimeout(700);
await student.evaluate(() => {
  delete document.visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
});
await student.waitForSelector('#ov-lock', { timeout: 10000 });
log('élève : quiz verrouillé après la sortie');
await shot(student, '06-eleve-verrouille');
await teacher.waitForSelector('.scard.st-locked', { timeout: 10000 });
await teacher.waitForSelector('.toast.alert', { timeout: 10000 });
log('prof : alerte reçue + carte rouge');
await shot(teacher, '07-prof-direct-alerte');

// ---- Teacher warns then unlocks ----
await teacher.click('.scard [data-a="warn"]');
await teacher.click('.modal-foot .btn-primary');
await student.waitForSelector('#ov-warning', { timeout: 10000 });
log('élève : avertissement reçu');
await shot(student, '08-eleve-avertissement');
await student.click('#ack');
await teacher.click('.scard [data-a="unlock"]');
await student.waitForSelector('#ov-lock', { state: 'detached', timeout: 10000 });
await student.waitForSelector('.tile', { timeout: 10000 });
log('élève : débloqué, question suivante');

// ---- Student finishes ----
for (let i = 0; i < 25; i++) {
  if (await student.locator('text=Quiz terminé').count()) break;
  const tile = student.locator('.tile').first();
  if (await tile.count()) { await tile.click().catch(() => {}); }
  await student.waitForTimeout(900);
}
await student.waitForSelector('text=Quiz terminé', { timeout: 30000 });
log('élève : quiz terminé');
await shot(student, '09-eleve-fin');
await shot(teacher, '10-prof-direct-fin');

// ---- Results ----
const quizId = await teacher.evaluate(() => document.querySelector('#lv-quiz').value);
await teacher.goto(BASE + '/#/prof/resultats/' + quizId);
await teacher.waitForSelector('text=Répartition des notes');
await shot(teacher, '11-prof-resultats');
await teacher.click('[data-tab="questions"]');
await shot(teacher, '12-prof-analyse');
await teacher.click('[data-tab="students"]');
await teacher.click('[data-release="1"]');
await teacher.waitForSelector('[data-release="0"]');
log('prof : résultats publiés');
await teacher.click('tbody tr.clickable');
await teacher.waitForSelector('text=Chronologie');
await shot(teacher, '13-prof-copie');

await student.click('text=Retour à mes quiz');
await student.waitForSelector('text=Mes résultats');
await student.click('[data-result]');
await student.waitForSelector('text=Correction');
log('élève : correction visible');
await shot(student, '14-eleve-correction');

// ---- Editor ----
await teacher.goto(BASE + '/#/prof/quiz/' + quizId);
await teacher.waitForSelector('.qitem');
await shot(teacher, '15-prof-editeur');
await teacher.click('.qitem [data-editq]');
await teacher.waitForSelector('.type-picker');
await shot(teacher, '16-prof-question');

console.log(errors.length ? '\nERREURS:\n' + errors.join('\n') : '\nAucune erreur JavaScript.');
await browser.close();
process.exit(errors.length ? 1 : 0);
