# Quiz SES — quiz notés anti-triche pour Mme Cyrine

Plateforme de quiz de SES (Seconde, Première, Terminale) : les élèves créent un compte (prénom, nom, mot de passe), passent des quiz notés et chronométrés au style Kahoot, et la professeure surveille tout en direct. Le site est conçu d’abord pour empêcher la triche, en particulier le va-et-vient vers ChatGPT, Claude ou une autre application, sur PC comme sur iPhone.

## Installer sur ton VPS (le plus simple)

**Avec Claude Code** : ouvre [`deploy/PROMPT_CLAUDE_CODE.md`](deploy/PROMPT_CLAUDE_CODE.md), remplis ton nom de domaine et ton e-mail, puis copie-colle le bloc dans Claude Code sur ton VPS. Il audite le serveur, installe, sécurise, teste et te fait un rapport.

**À la main** (Ubuntu / Debian, en SSH) :

```bash
sudo git clone -b claude/hello-6gcdab https://github.com/didooip-png/claude.git /opt/quiz-ses
cd /opt/quiz-ses
sudo bash deploy/install.sh --domain quiz.ton-domaine.fr --email toi@exemple.fr
```

Le script installe et configure tout : nginx (ou Apache s’il est déjà là), PHP-FPM, MariaDB, la base de données avec le quiz « La croissance économique », HTTPS (Let’s Encrypt), le pare-feu et une sauvegarde automatique chaque nuit. Le relancer ne supprime rien.

Première connexion : onglet **Professeure**, identifiant `cyrine`, mot de passe provisoire `ChangeMoi2026!`. Le site impose d’en choisir un nouveau.

Mettre à jour plus tard : `cd /opt/quiz-ses && sudo bash deploy/update.sh`.

### Hébergement mutualisé (OVH, o2switch, Hostinger…)

1. Crée une base MySQL dans l’espace client, puis dans phpMyAdmin importe `database/schema.sql`, puis `database/demo_data.sql`.
2. Copie `public/config.php` en `public/config.local.php` et renseigne l’hôte, le nom de la base, l’utilisateur et le mot de passe.
3. Envoie **le contenu** du dossier `public/` (y compris les fichiers `.htaccess`) à la racine du site par FTP. Le dossier `uploads/` doit être inscriptible.
4. Active le certificat SSL de ton hébergeur. PHP 8.0 minimum.

## Ce que fait le site

**Élèves** : compte avec prénom + nom + mot de passe (validé par la prof), liste des quiz ouverts, code d’accès donné en classe, passage question par question avec chrono, correction et classement quand la prof les publie.

**Professeure**
- Éditeur de quiz : 6 types de questions (choix unique, choix multiples, vrai/faux, réponse courte tolérante aux fautes, numérique avec virgule française et marge d’erreur, remise en ordre), images (graphiques, documents), explications, barème, chrono par question.
- Collage d’un quiz entier en une fois : le format « 1. Question / A. … / ✓ B — explication » et le format Moodle (Aiken) sont reconnus.
- Réglages par quiz : code d’accès, classes autorisées, dates d’ouverture et de fermeture, questions et réponses mélangées, tirage au hasard de N questions, durée totale, nombre de tentatives, restriction au Wi-Fi du lycée (adresse IP), correction immédiate (mode Kahoot) ou après publication.
- **En direct** : chaque élève avec sa progression question par question (juste, faux, annulée, temps de réponse), en ligne ou non, sorties, temps passé hors du quiz, appareil ; les élèves qui n’ont pas commencé ; un journal instantané ; une alerte sonore et une notification à chaque triche. Actions : **Débloquer**, **Avertir** (message plein écran sur l’appareil de l’élève), **Pause**, **Exclure (0/20)**, **Terminer**, **Réinitialiser**, message à toute la classe, terminer pour tous. Un mode projection masque les notes pour afficher l’écran au tableau.
- Résultats : moyenne, médiane, écart-type, répartition des notes, analyse question par question (taux de réussite, réponses choisies, erreurs fréquentes), export Excel (CSV), copie détaillée de chaque élève avec la chronologie de ses sorties, correction manuelle des points.
- Gestion des élèves : validation, classes, réinitialisation de mot de passe, désactivation, fermeture des inscriptions, journal d’activité.

## Anti-triche

Ce qui ne dépend pas du navigateur de l’élève, donc qu’aucun élève ne peut contourner :
- les bonnes réponses ne sont **jamais envoyées** au téléphone ou au PC de l’élève ;
- le chrono de chaque question est tenu par le serveur, une question à la fois, sans retour ;
- **si l’élève quitte le quiz, la question en cours est annulée (0 point)** : revenir avec la réponse de ChatGPT ne sert à rien. Le quiz est ensuite verrouillé jusqu’à ce que la prof le débloque (ou la copie est terminée, au choix) ;
- l’appareil envoie un signal toutes les 2 secondes : sans signal pendant 10 secondes (application quittée, page figée), le serveur sanctionne tout seul ;
- une seule session par compte : se connecter ailleurs est détecté et sanctionné ;
- ordre des questions et des réponses différent pour chaque élève, filigrane avec le nom de l’élève, code d’accès, restriction au réseau du lycée.

Ce que le navigateur détecte et signale : changement d’application ou d’onglet, perte du focus (la question est masquée immédiatement), sortie du plein écran (obligatoire sur PC), rechargement de la page, tentatives de copier, coller ou imprimer, touche capture d’écran, texte inséré d’un coup, extensions d’IA (ChatGPT, Gemini, Copilot, Sider, Monica, Brainly, Photomath…), outils de développement, modification des fonctions du navigateur, navigateur automatisé, deuxième écran.

**Limite** : aucun site ne peut voir un **deuxième téléphone** posé sur les genoux. Contre ça : les chronos courts, la présence de la prof en classe et, sur iPhone, l’**Accès guidé** (Réglages → Accessibilité → Accès guidé, puis triple-clic sur le bouton latéral), qui empêche de quitter l’application.

## Organisation du projet

```
public/            ← le site (racine web)
  index.html, assets/   interface (HTML/CSS/JS, sans CDN ni étape de build)
  api/index.php         unique point d'entrée PHP
  lib/                  code serveur (auth, notation, anti-triche, actions)
  config.php            modèle de configuration → copier en config.local.php
  uploads/              images des questions
database/          schema.sql, demo_data.sql (quiz fournis, en brouillon), demo_quizzes.json
deploy/            install.sh, update.sh, configurations nginx/Apache, prompt Claude Code
tests/             api_test.php (63 tests), e2e_smoke.mjs (parcours complet dans Chromium)
demo/, tools/      démo autonome dans le navigateur et outils de génération
```

## Tests

```bash
php -S 127.0.0.1:8080 -t public          # avec un config.local.php pointant vers une base de TEST
php tests/api_test.php http://127.0.0.1:8080 "mysql quiz_ses_test"
node tests/e2e_smoke.mjs http://127.0.0.1:8080 /tmp
```

Ne lance jamais les tests sur la base de production : ils créent des élèves et changent le mot de passe de la professeure.
