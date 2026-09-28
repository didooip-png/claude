# Prompt à donner à Claude Code sur le VPS

Ouvre Claude Code sur ton VPS (connecté en SSH, dans ton dossier personnel), puis copie-colle **tout le bloc ci-dessous**.
Remplace seulement les deux lignes marquées `À REMPLIR` (ou laisse-les vides : Claude te posera la question).

---

```text
Tu vas installer en production sur CE serveur (mon VPS) le site « Quiz SES », une plateforme de quiz notés anti-triche.
Travaille en français avec moi. Avant toute action qui modifie le serveur, fais d'abord l'audit (étape 1) et montre-moi ce que tu comptes faire.

## Mes informations
- Nom de domaine du site : À REMPLIR (ex. quiz.mondomaine.fr — il doit déjà pointer vers l'IP de ce VPS ; si je n'en ai pas, on installe sur l'IP en HTTP)
- E-mail pour le certificat HTTPS (Let's Encrypt) : À REMPLIR

## Contexte du projet
- Site pour UNE seule professeure, Cyrine, qui enseigne les SES (sciences économiques et sociales, lycée français : Seconde, Première, Terminale).
- Rôle unique du site : faire passer des quiz notés (style Kahoot, comme Moodle mais uniquement pour des quiz) SANS que les élèves puissent tricher, en particulier avec ChatGPT, Claude, etc., sur PC et surtout sur iPhone.
- Les élèves créent un compte avec prénom + nom + mot de passe (validé par la professeure). La professeure crée les quiz, les ouvre avec un code d'accès, surveille en direct, publie les notes.
- Un premier quiz est déjà fourni : « La croissance économique » (Terminale, 20 questions), importé en brouillon.

## Où est le code
- Dépôt GitHub : https://github.com/didooip-png/claude — branche : claude/hello-6gcdab
- Clone-le dans /opt/quiz-ses :
    sudo git clone -b claude/hello-6gcdab https://github.com/didooip-png/claude.git /opt/quiz-ses
- Si le dépôt est privé et que le clone échoue : demande-moi de me connecter (`gh auth login` si GitHub CLI est installé, sinon un « personal access token » GitHub en lecture seule que je te donnerai), ou que j'envoie une archive .zip du dépôt sur le serveur. Ne mets jamais le token dans un fichier ni dans l'historique git.

## Architecture (à lire avant d'agir)
- `public/` = racine web à servir. SPA sans étape de build : `index.html` + `assets/` (CSS/JS). Tout le rendu se fait côté navigateur.
- `public/api/index.php` = UNIQUE point d'entrée PHP (routeur JSON). `public/lib/*.php` = code interne (ne doit jamais être servi).
- `public/config.php` = modèle de configuration ; la vraie configuration est `config.local.php` (créée par le script, jamais versionnée).
- `public/uploads/` = images des questions (le seul dossier inscriptible par PHP ; aucune exécution de script).
- `database/schema.sql` (tables + compte professeure) et `database/demo_data.sql` (les quiz fournis, en brouillon).
- `deploy/install.sh` = installation automatique Ubuntu/Debian (nginx ou Apache, PHP-FPM ≥ 8.0, MariaDB/MySQL, HTTPS certbot, pare-feu ufw, sauvegardes cron). `deploy/update.sh` = mises à jour. `deploy/nginx/`, `deploy/apache/` = modèles de configuration.
- `tests/api_test.php` (63 tests de l'API, dont l'anti-triche) et `tests/e2e_smoke.mjs` (parcours complet dans Chromium).
- Stack : PHP 8 + PDO MySQL (requêtes préparées), sessions PHP, MariaDB 10.3+ / MySQL 5.7+, utf8mb4. Aucune dépendance externe (pas de CDN, pas de Composer, pas de npm en production).

## Modèle de sécurité à préserver (ne rien affaiblir)
- Les bonnes réponses ne sont JAMAIS envoyées au navigateur de l'élève ; notes et chronos sont calculés côté serveur.
- Une question à la fois, pas de retour arrière ; chrono par question tenu par le serveur.
- Si l'élève quitte le quiz (autre appli, onglet, perte de focus, plein écran, rechargement, 2e appareil, extension d'IA, outils de développement), la question en cours est annulée et le quiz est verrouillé jusqu'à ce que la professeure le débloque. Signal de présence toutes les 2 s : sans signal pendant 10 s, le serveur sanctionne seul.
- CSRF sur toutes les requêtes POST, session unique par compte, anti force brute, mots de passe hachés (password_hash), en-têtes de sécurité stricts (CSP sans script inline), refus des navigateurs automatisés.
- Seul `api/index.php` exécute du PHP ; `lib/`, `config*.php`, `*.sql`, `*.md`, fichiers cachés → 404. MySQL n'est jamais exposé à Internet.

## Étape 1 — Audit (lecture seule, puis rapport)
Vérifie et résume-moi : OS et version, RAM/disque libre, serveur web déjà présent (nginx/Apache/Caddy/Docker/panneau type Plesk/cPanel/aaPanel) et sites déjà hébergés, qui écoute sur les ports 80/443/3306, versions PHP et PHP-FPM installées, MySQL/MariaDB présent et comment s'y connecter en root, pare-feu actif et port SSH, résolution DNS du domaine vers l'IP publique du serveur.
Si le serveur héberge déjà d'autres sites : ne casse rien. Ajoute Quiz SES comme site séparé (son propre server block / vhost), n'efface aucune configuration existante et ne modifie pas les autres bases de données.

## Étape 2 — Installation
- Cas standard (Ubuntu/Debian, pas de panneau d'administration) : lis `deploy/install.sh` en entier, puis lance-le :
    cd /opt/quiz-ses && sudo bash deploy/install.sh --domain <DOMAINE> --email <EMAIL>
  (sans domaine : `sudo bash deploy/install.sh`). Si MySQL root demande un mot de passe : `sudo MYSQL_ROOT_PASSWORD='…' bash deploy/install.sh …`.
- Cas particulier (panneau Plesk/cPanel/aaPanel, Docker, Caddy, autre OS, serveur web déjà très configuré) : n'utilise pas le script aveuglément. Reproduis ses étapes à la main de façon équivalente : base utf8mb4 + utilisateur dédié avec mot de passe aléatoire, import de schema.sql puis demo_data.sql, copie de `public/` vers la racine du site, `config.local.php` (droits 640, propriétaire root:groupe du serveur web), `uploads/` inscriptible par PHP uniquement, règles de sécurité équivalentes à `deploy/nginx/quiz-ses.conf` (ou `.htaccess` sous Apache), HTTPS, sauvegardes.
- Si une étape échoue : diagnostique la cause réelle et corrige-la ; ne désactive aucune protection pour « faire marcher ».

## Étape 3 — Vérifications obligatoires
1. `curl -sI https://<DOMAINE>/` → 200 + en-têtes Content-Security-Policy, X-Frame-Options, X-Content-Type-Options.
2. Doivent répondre 404 (ou 403) : `/config.php`, `/config.local.php`, `/lib/db.php`, `/lib/.htaccess`, `/uploads/x.php`, `/.git/config`, `/database/schema.sql`.
3. `curl -s https://<DOMAINE>/api/index.php?a=session` → JSON avec `"ok":true` (la base est bien connectée).
4. Tests de l'API SUR UNE BASE TEMPORAIRE, JAMAIS sur la base de production (le test modifie le mot de passe de la prof et crée des élèves) :
   - crée une base `quiz_ses_test` + un utilisateur dédié, importe schema.sql puis demo_data.sql ;
   - copie `public/` dans un dossier temporaire, avec un `config.local.php` pointant vers `quiz_ses_test` ;
   - lance `php -S 127.0.0.1:8099 -t <dossier_temporaire>` en arrière-plan, puis `php tests/api_test.php http://127.0.0.1:8099 "mysql quiz_ses_test"` (adapte la commande mysql si l'accès root demande un mot de passe) ;
   - attendu : « 63 réussis, 0 échecs » ; ensuite arrête le serveur PHP, supprime le dossier temporaire, la base et l'utilisateur de test.
5. Vérifie que la tâche cron de sauvegarde existe (`/etc/cron.d/quiz-ses-backup`) et lance-la une fois à la main pour confirmer qu'un fichier .sql.gz est produit dans /var/backups/quiz-ses.
6. Vérifie `sudo ufw status` : SSH (le bon port !), 80 et 443 ouverts ; 3306 fermé.

## Étape 4 — Rapport final
Donne-moi :
- l'adresse du site ;
- le compte professeure : identifiant `cyrine`, mot de passe provisoire `ChangeMoi2026!`. Le site oblige à le changer à la première connexion : dis-moi de le faire immédiatement ;
- où se trouvent la configuration (`/var/www/quiz-ses/config.local.php`), le récapitulatif (`/root/quiz-ses-installation.txt`) et les sauvegardes ;
- la commande de mise à jour : `cd /opt/quiz-ses && sudo bash deploy/update.sh` ;
- les résultats des vérifications de l'étape 3 ;
- tout point d'attention (domaine sans HTTPS, ressources faibles, autre site impacté…).

## Interdits
- Ne jamais lancer les tests sur la base de production, ni vider/recréer la base de production (pas de `--reset-db`) sans mon accord écrit.
- Ne jamais afficher en clair le mot de passe MySQL dans le rapport (indique seulement le fichier où il se trouve).
- Ne pas désactiver ni affaiblir l'anti-triche, les en-têtes de sécurité, le CSRF ou les règles d'accès.
- Ne pas ouvrir MySQL à Internet, ne pas installer phpMyAdmin sans me demander.
- Ne pas modifier le code de l'application, sauf si c'est indispensable pour ce serveur : dans ce cas explique pourquoi et montre le diff.
```

---

## Ce que la professeure fait ensuite (5 minutes)

1. Se connecter (onglet **Professeure**, identifiant `cyrine`) et choisir son vrai mot de passe.
2. **Élèves** : créer ses classes (ex. « Tle SES 2 ») puis donner l'adresse du site aux élèves pour qu'ils créent leur compte ; valider les comptes (« Tout valider »), puis **fermer les inscriptions**.
3. **Mes quiz → La croissance économique** : vérifier les questions, générer un **code d'accès**, puis **Ouvrir aux élèves** le jour du quiz.
4. **En direct** pendant le quiz : sorties, verrouillages, avertissements, exclusion.
5. **Résultats → Publier les résultats** quand tout le monde a fini.
