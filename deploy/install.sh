#!/usr/bin/env bash
# =====================================================================
#  Quiz SES — installation automatique sur un VPS Ubuntu / Debian
#
#  À lancer en root depuis le dossier du dépôt :
#     sudo bash deploy/install.sh --domain quiz.mondomaine.fr --email moi@exemple.fr
#     sudo bash deploy/install.sh                 (sans domaine : accès par l'IP, en HTTP)
#
#  Options :
#     --domain NOM          nom de domaine du site (HTTPS automatique si --email est aussi donné)
#     --email ADRESSE       adresse e-mail pour le certificat Let's Encrypt
#     --dir CHEMIN          dossier du site (défaut : /var/www/quiz-ses)
#     --db-name NOM         nom de la base (défaut : quiz_ses)
#     --db-user NOM         utilisateur MySQL (défaut : quiz_ses)
#     --web auto|nginx|apache   serveur web (défaut : auto = garde celui déjà installé, sinon nginx)
#     --no-demo-quizzes     n'importe pas les quiz fournis (dont « La croissance économique »)
#     --no-firewall         ne modifie pas le pare-feu
#     --reset-db            SUPPRIME puis recrée la base (toutes les données sont perdues)
#
#  Relancer le script est sans danger : la base existante et les images sont conservées.
# =====================================================================
set -Eeuo pipefail

DOMAIN=""
EMAIL=""
APP_DIR="/var/www/quiz-ses"
DB_NAME="quiz_ses"
DB_USER="quiz_ses"
WEB="auto"
DEMO_QUIZZES=1
FIREWALL=1
RESET_DB=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --dir) APP_DIR="${2:-}"; shift 2 ;;
    --db-name) DB_NAME="${2:-}"; shift 2 ;;
    --db-user) DB_USER="${2:-}"; shift 2 ;;
    --web) WEB="${2:-}"; shift 2 ;;
    --no-demo-quizzes) DEMO_QUIZZES=0; shift ;;
    --no-firewall) FIREWALL=0; shift ;;
    --reset-db) RESET_DB=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $1 (voir --help)"; exit 1 ;;
  esac
done

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[ERREUR] %s\033[0m\n' "$*" >&2; exit 1; }
trap 'die "échec à la ligne $LINENO (commande : $BASH_COMMAND)"' ERR

[[ $EUID -eq 0 ]] || die "Lance ce script en root : sudo bash deploy/install.sh"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$REPO_DIR/public/index.html" && -f "$REPO_DIR/database/schema.sql" ]] || die "Lance le script depuis le dépôt Quiz SES (dossiers public/ et database/ introuvables)."
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]{1,64}$ ]] || die "--db-name : lettres, chiffres et _ uniquement."
[[ "$DB_USER" =~ ^[A-Za-z0-9_]{1,32}$ ]] || die "--db-user : lettres, chiffres et _ uniquement."
[[ -z "$DOMAIN" || "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "--domain invalide."
[[ "$WEB" =~ ^(auto|nginx|apache)$ ]] || die "--web doit valoir auto, nginx ou apache."

. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) case "${ID_LIKE:-}" in *debian*) ;; *) die "Système non pris en charge (${PRETTY_NAME:-inconnu}). Ce script vise Ubuntu/Debian : suis l'installation manuelle du README." ;; esac ;;
esac
export DEBIAN_FRONTEND=noninteractive

step "Paquets de base"
apt-get update -qq
apt-get install -y -qq ca-certificates curl rsync openssl cron unzip >/dev/null

# ---------------------------------------------------------------- Web server
if [[ "$WEB" == "auto" ]]; then
  if systemctl is-active --quiet apache2 2>/dev/null; then WEB="apache"
  elif command -v nginx >/dev/null 2>&1 || systemctl is-active --quiet nginx 2>/dev/null; then WEB="nginx"
  else WEB="nginx"; fi
fi
info "Serveur web : $WEB"
if [[ "$WEB" == "nginx" ]] && systemctl is-active --quiet apache2 2>/dev/null; then
  die "Apache tourne déjà sur ce serveur : relance avec --web apache (ou arrête Apache)."
fi
if [[ "$WEB" == "apache" ]] && systemctl is-active --quiet nginx 2>/dev/null; then
  die "nginx tourne déjà sur ce serveur : relance avec --web nginx (ou arrête nginx)."
fi

step "PHP (FPM) et extensions"
apt-get install -y -qq php-fpm php-cli php-mysql php-mbstring php-intl php-gd >/dev/null
# Use the PHP-FPM version actually installed (the CLI may be another version on some servers).
FPM_BIN="$(find /usr/sbin -maxdepth 1 -name 'php-fpm[0-9]*' | sort -V | tail -n 1)"
[[ -n "$FPM_BIN" ]] || die "PHP-FPM introuvable après installation."
PHP_VER="${FPM_BIN##*php-fpm}"
[[ "${PHP_VER%%.*}" -ge 8 ]] || die "PHP $PHP_VER détecté : Quiz SES demande PHP 8.0 ou plus (Debian 11 : ajoute le dépôt packages.sury.org/php)."
apt-get install -y -qq "php${PHP_VER}-mysql" "php${PHP_VER}-mbstring" "php${PHP_VER}-intl" "php${PHP_VER}-gd" >/dev/null
PHP_SOCK="/run/php/php${PHP_VER}-fpm.sock"
info "PHP-FPM $PHP_VER"
cat > "/etc/php/${PHP_VER}/fpm/conf.d/99-quiz-ses.ini" <<'INI'
; Quiz SES
expose_php = Off
display_errors = Off
log_errors = On
upload_max_filesize = 8M
post_max_size = 10M
max_execution_time = 30
memory_limit = 256M
date.timezone = Europe/Paris
session.use_strict_mode = 1
session.cookie_httponly = 1
session.use_only_cookies = 1
session.gc_maxlifetime = 28800
INI
systemctl enable --now "php${PHP_VER}-fpm" >/dev/null
systemctl restart "php${PHP_VER}-fpm"
[[ -S "$PHP_SOCK" ]] || die "Socket PHP-FPM introuvable : $PHP_SOCK"

# ---------------------------------------------------------------- Database server
step "Base de données (MariaDB / MySQL)"
if ! (systemctl is-active --quiet mariadb 2>/dev/null || systemctl is-active --quiet mysql 2>/dev/null); then
  if ! command -v mysqld >/dev/null 2>&1 && ! command -v mariadbd >/dev/null 2>&1; then
    info "Installation de MariaDB"
    apt-get install -y -qq mariadb-server >/dev/null
  fi
  systemctl enable --now mariadb >/dev/null 2>&1 || systemctl enable --now mysql >/dev/null 2>&1
fi
MYSQL=(mysql)
if ! mysql -e 'SELECT 1' >/dev/null 2>&1; then
  if [[ -n "${MYSQL_ROOT_PASSWORD:-}" ]]; then
    MYSQL=(mysql -uroot "-p${MYSQL_ROOT_PASSWORD}")
    "${MYSQL[@]}" -e 'SELECT 1' >/dev/null 2>&1 || die "Connexion root MySQL refusée avec MYSQL_ROOT_PASSWORD."
  else
    die "Impossible de se connecter à MySQL en root. Relance avec : sudo MYSQL_ROOT_PASSWORD='...' bash deploy/install.sh ..."
  fi
fi
DB_EXISTS="$("${MYSQL[@]}" -N -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${DB_NAME}'")"
CONFIG_FILE="$APP_DIR/config.local.php"
FRESH_DB=0
if [[ "$RESET_DB" == 1 && "$DB_EXISTS" == 1 ]]; then
  warn "--reset-db : suppression de la base ${DB_NAME}"
  "${MYSQL[@]}" -e "DROP DATABASE \`${DB_NAME}\`"
  DB_EXISTS=0
fi
if [[ "$DB_EXISTS" == 1 && -f "$CONFIG_FILE" ]]; then
  info "Base ${DB_NAME} existante : conservée, identifiants actuels réutilisés."
  DB_PASS=""
else
  DB_PASS="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 32)"
  "${MYSQL[@]}" -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
    ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
    GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, LOCK TABLES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
    FLUSH PRIVILEGES;"
  if [[ "$DB_EXISTS" == 0 ]]; then
    info "Import du schéma"
    "${MYSQL[@]}" "$DB_NAME" < "$REPO_DIR/database/schema.sql"
    FRESH_DB=1
    if [[ "$DEMO_QUIZZES" == 1 ]]; then
      info "Import des quiz fournis (en brouillon)"
      "${MYSQL[@]}" "$DB_NAME" < "$REPO_DIR/database/demo_data.sql"
    fi
  else
    info "Base ${DB_NAME} existante sans configuration : nouveau mot de passe pour ${DB_USER}."
  fi
fi

# ---------------------------------------------------------------- Files
step "Copie du site dans $APP_DIR"
mkdir -p "$APP_DIR/uploads"
rsync -a --delete --exclude 'config.local.php' --exclude 'uploads/' "$REPO_DIR/public/" "$APP_DIR/"
rsync -a "$REPO_DIR/public/uploads/.htaccess" "$REPO_DIR/public/uploads/index.html" "$APP_DIR/uploads/"
# Force browsers to fetch the new scripts after each deployment.
VERSION="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || date +%s)"
sed -i "s/?v=[0-9A-Za-z]*/?v=${VERSION}/g" "$APP_DIR/index.html"
if [[ -n "$DB_PASS" ]]; then
  cat > "$CONFIG_FILE" <<PHP
<?php
// Généré par deploy/install.sh le $(date '+%d/%m/%Y %H:%M'). Ne jamais publier ce fichier.
defined('APP') || exit;

return [
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => '${DB_NAME}',
    'db_user' => '${DB_USER}',
    'db_pass' => '${DB_PASS}',
    'timezone' => 'Europe/Paris',
    'debug' => false,
];
PHP
fi
chown -R root:www-data "$APP_DIR"
find "$APP_DIR" -type d -exec chmod 755 {} +
find "$APP_DIR" -type f -exec chmod 644 {} +
chown root:www-data "$CONFIG_FILE"
chmod 640 "$CONFIG_FILE"
chown -R www-data:www-data "$APP_DIR/uploads"
chmod 755 "$APP_DIR/uploads"

# ---------------------------------------------------------------- Web configuration
SERVER_NAME="${DOMAIN:-_}"
render() {
  sed -e "s#__SERVER_NAME__#${SERVER_NAME}#g" -e "s#__ROOT__#${APP_DIR}#g" -e "s#__PHP_SOCK__#${PHP_SOCK}#g" -e "s#__DEFAULT_SERVER__#${1}#g" "$2"
}
step "Configuration de $WEB"
if [[ "$WEB" == "nginx" ]]; then
  apt-get install -y -qq nginx >/dev/null
  DEFAULT=""
  if [[ -z "$DOMAIN" ]]; then
    if [[ -L /etc/nginx/sites-enabled/default ]]; then rm -f /etc/nginx/sites-enabled/default; fi
    if grep -rqs "default_server" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null; then
      die "Un autre site nginx est déjà le site par défaut : relance avec --domain ton.domaine.fr"
    fi
    DEFAULT=" default_server"
  fi
  render "$DEFAULT" "$REPO_DIR/deploy/nginx/quiz-ses.conf" > /etc/nginx/sites-available/quiz-ses.conf
  ln -sf /etc/nginx/sites-available/quiz-ses.conf /etc/nginx/sites-enabled/quiz-ses.conf
  nginx -t
  systemctl enable --now nginx >/dev/null
  systemctl reload nginx
else
  apt-get install -y -qq apache2 >/dev/null
  a2enmod -q proxy_fcgi setenvif headers rewrite >/dev/null
  if [[ -z "$DOMAIN" ]]; then a2dissite -q 000-default >/dev/null 2>&1 || true; fi
  render "" "$REPO_DIR/deploy/apache/quiz-ses.conf" > /etc/apache2/sites-available/quiz-ses.conf
  if [[ -z "$DOMAIN" ]]; then sed -i '/ServerName _/d' /etc/apache2/sites-available/quiz-ses.conf; fi
  a2ensite -q quiz-ses >/dev/null
  apache2ctl configtest
  systemctl enable --now apache2 >/dev/null
  systemctl reload apache2
fi

# ---------------------------------------------------------------- HTTPS
URL="http://${DOMAIN:-$(curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')}"
if [[ -n "$DOMAIN" && -n "$EMAIL" ]]; then
  step "Certificat HTTPS (Let's Encrypt)"
  apt-get install -y -qq certbot "python3-certbot-${WEB}" >/dev/null
  if certbot "--${WEB}" -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    URL="https://${DOMAIN}"
    if [[ "$WEB" == "nginx" ]]; then
      sed -i 's#add_header Cross-Origin-Opener-Policy "same-origin" always;#add_header Cross-Origin-Opener-Policy "same-origin" always;\n    add_header Strict-Transport-Security "max-age=31536000" always;#' /etc/nginx/sites-available/quiz-ses.conf
      nginx -t && systemctl reload nginx
    fi
  else
    warn "Certificat impossible : vérifie que le domaine ${DOMAIN} pointe bien vers ce serveur (DNS), puis relance le script."
  fi
elif [[ -n "$DOMAIN" ]]; then
  warn "Pas d'e-mail fourni : site en HTTP seulement. Relance avec --email pour activer HTTPS (fortement conseillé)."
fi

# ---------------------------------------------------------------- Firewall
if [[ "$FIREWALL" == 1 ]]; then
  step "Pare-feu (ufw)"
  apt-get install -y -qq ufw >/dev/null
  SSH_PORTS="$(sshd -T 2>/dev/null | awk '/^port /{print $2}' | sort -u)"
  [[ -n "$SSH_PORTS" ]] || SSH_PORTS="22"
  for p in $SSH_PORTS; do ufw allow "${p}/tcp" >/dev/null; info "SSH autorisé sur le port $p"; done
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  info "Ports ouverts : SSH, 80, 443 (MySQL reste fermé à Internet)"
fi

# ---------------------------------------------------------------- Backups
step "Sauvegardes automatiques"
BACKUP_DIR="/var/backups/quiz-ses"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
if [[ -n "$DB_PASS" || ! -f /root/.quiz-ses-backup.cnf ]]; then
  CUR_PASS="$(php -r 'define("APP",1); $c = require $argv[1]; echo $c["db_pass"];' "$CONFIG_FILE")"
  CUR_USER="$(php -r 'define("APP",1); $c = require $argv[1]; echo $c["db_user"];' "$CONFIG_FILE")"
  printf '[client]\nuser=%s\npassword=%s\n' "$CUR_USER" "$CUR_PASS" > /root/.quiz-ses-backup.cnf
  chmod 600 /root/.quiz-ses-backup.cnf
fi
cat > /etc/cron.d/quiz-ses-backup <<CRON
# Quiz SES : sauvegarde quotidienne de la base et des images (30 jours conservés)
30 2 * * * root mysqldump --defaults-extra-file=/root/.quiz-ses-backup.cnf --single-transaction --no-tablespaces ${DB_NAME} | gzip > ${BACKUP_DIR}/base-\$(date +\%F).sql.gz && tar -czf ${BACKUP_DIR}/images-\$(date +\%F).tar.gz -C ${APP_DIR} uploads && find ${BACKUP_DIR} -type f -mtime +30 -delete
CRON
chmod 644 /etc/cron.d/quiz-ses-backup
info "Chaque nuit à 2 h 30 dans $BACKUP_DIR"

# ---------------------------------------------------------------- Checks
step "Vérifications"
HOST_HDR="${DOMAIN:-localhost}"
check_status() {
  local path="$1" expected="$2" code
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${HOST_HDR}" "http://127.0.0.1${path}")"
  if [[ "$code" == 301 || "$code" == 308 ]]; then code="$(curl -sk -o /dev/null -w '%{http_code}' --resolve "${HOST_HDR}:443:127.0.0.1" "https://${HOST_HDR}${path}")"; fi
  if [[ "$code" == "$expected" ]]; then info "OK  $path → $code"; else warn "$path → $code (attendu $expected)"; fi
}
API_OK="$(curl -sk -H "Host: ${HOST_HDR}" "http://127.0.0.1/api/index.php?a=session" -L --resolve "${HOST_HDR}:443:127.0.0.1" || true)"
if [[ "$API_OK" == *'"ok":true'* ]]; then info "OK  l'API répond et la base est connectée"; else warn "L'API ne répond pas correctement : ${API_OK:0:200}"; fi
check_status "/" 200
check_status "/config.php" 404
check_status "/config.local.php" 404
check_status "/lib/db.php" 404
check_status "/database/schema.sql" 404

cat > /root/quiz-ses-installation.txt <<TXT
Quiz SES — installé le $(date '+%d/%m/%Y %H:%M')
Adresse du site : ${URL}
Dossier du site : ${APP_DIR}
Configuration (mot de passe MySQL) : ${CONFIG_FILE}
Base : ${DB_NAME} (utilisateur ${DB_USER})
Sauvegardes : ${BACKUP_DIR}
Mise à jour : cd ${REPO_DIR} && sudo bash deploy/update.sh
TXT
chmod 600 /root/quiz-ses-installation.txt

step "Installation terminée"
info "Site : ${URL}"
if [[ "$FRESH_DB" == 1 ]]; then
  info "Compte professeure : identifiant « cyrine », mot de passe provisoire « ChangeMoi2026! »"
  info "→ connecte-toi TOUT DE SUITE : le site impose de choisir un nouveau mot de passe."
fi
info "Récapitulatif enregistré dans /root/quiz-ses-installation.txt"
