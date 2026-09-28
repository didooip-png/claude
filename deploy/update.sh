#!/usr/bin/env bash
# =====================================================================
#  Quiz SES — mise à jour du site sur le VPS (code seulement).
#  La base de données, config.local.php et les images ne sont pas touchés.
#     cd /opt/quiz-ses && sudo bash deploy/update.sh [--dir /var/www/quiz-ses] [--no-pull]
# =====================================================================
set -Eeuo pipefail
APP_DIR="/var/www/quiz-ses"
PULL=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) APP_DIR="${2:-}"; shift 2 ;;
    --no-pull) PULL=0; shift ;;
    *) echo "Option inconnue : $1"; exit 1 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Lance ce script en root (sudo)."; exit 1; }
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$APP_DIR/config.local.php" ]] || { echo "Aucune installation trouvée dans $APP_DIR (lance d'abord deploy/install.sh)."; exit 1; }

if [[ "$PULL" == 1 && -d "$REPO_DIR/.git" ]]; then
  echo "==> Récupération de la dernière version"
  git -C "$REPO_DIR" pull --ff-only
fi

echo "==> Sauvegarde de sécurité de la base avant mise à jour"
DB_NAME="$(php -r 'define("APP",1); $c = require $argv[1]; echo $c["db_name"];' "$APP_DIR/config.local.php")"
mkdir -p /var/backups/quiz-ses
if [[ -f /root/.quiz-ses-backup.cnf ]]; then
  mysqldump --defaults-extra-file=/root/.quiz-ses-backup.cnf --single-transaction --no-tablespaces "$DB_NAME" | gzip > "/var/backups/quiz-ses/avant-maj-$(date +%F-%H%M).sql.gz"
fi

echo "==> Mise à jour de la structure de la base (sans perte de données)"
mysql --defaults-extra-file=/root/.quiz-ses-backup.cnf "$DB_NAME" < "$REPO_DIR/database/schema.sql" 2>/dev/null || true
if compgen -G "$REPO_DIR/database/migrations/*.sql" >/dev/null; then
  for f in "$REPO_DIR"/database/migrations/*.sql; do
    echo "    migration $(basename "$f")"
    mysql --defaults-extra-file=/root/.quiz-ses-backup.cnf "$DB_NAME" < "$f" || echo "    (déjà appliquée ou ignorée)"
  done
fi

echo "==> Copie des fichiers"
rsync -a --delete --exclude 'config.local.php' --exclude 'uploads/' "$REPO_DIR/public/" "$APP_DIR/"
rsync -a "$REPO_DIR/public/uploads/.htaccess" "$REPO_DIR/public/uploads/index.html" "$APP_DIR/uploads/"
# Force browsers to fetch the new scripts after each deployment.
VERSION="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || date +%s)"
sed -i "s/?v=[0-9A-Za-z]*/?v=${VERSION}/g" "$APP_DIR/index.html"
chown -R root:www-data "$APP_DIR"
find "$APP_DIR" -type d -exec chmod 755 {} +
find "$APP_DIR" -type f -exec chmod 644 {} +
chmod 640 "$APP_DIR/config.local.php"
chown -R www-data:www-data "$APP_DIR/uploads"

FPM="$(find /usr/sbin -maxdepth 1 -name 'php-fpm[0-9]*' | sort -V | tail -n 1)"
[[ -n "$FPM" ]] && systemctl reload "php${FPM##*php-fpm}-fpm" || true
echo "==> Mise à jour terminée."
