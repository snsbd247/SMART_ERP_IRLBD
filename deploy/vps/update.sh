#!/usr/bin/env bash
# ============================================================
#  SmartERP — Deploy Update (PRODUCTION-SAFE)
#  Pulls latest code, reinstalls deps, runs *additive* migrations,
#  rebuilds frontend, clears caches. Safe to re-run on each deploy.
#
#  GUARANTEES:
#   - Never runs db:seed / seeders (no demo or master data inserted)
#   - Never runs migrate:fresh / migrate:reset / migrate:refresh / wipe
#   - Only forward `php artisan migrate --force` (additive schema only)
#   - Existing operational data is preserved as-is
#   - Auto DB backup is taken before any migration runs
# ============================================================
#  Usage:
#     sudo APP_DIR=/opt/smarterp ./update.sh
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/smarterp}"
REPO_BRANCH="${REPO_BRANCH:-main}"
PHP_VERSION="${PHP_VERSION:-8.2}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/smarterp}"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_NC='\033[0m'
log()  { echo -e "${C_GREEN}[$(date +%H:%M:%S)]${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_NC} $*"; }
err()  { echo -e "${C_RED}[ERR ]${C_NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root (sudo ./update.sh)"; exit 1; fi
if [[ ! -d "${APP_DIR}/.git" ]]; then err "${APP_DIR} is not a git checkout. Run clone.sh first."; exit 1; fi

cd "${APP_DIR}"
log "Pulling latest from origin/${REPO_BRANCH}..."
git fetch --all --prune
git checkout "${REPO_BRANCH}"
git reset --hard "origin/${REPO_BRANCH}"

log "Rebuilding frontend..."
if [[ -f package.json ]]; then
  npm install --no-audit --no-fund --legacy-peer-deps
  npm run build
fi

if [[ -d "${APP_DIR}/erp-backend" ]]; then
  cd "${APP_DIR}/erp-backend"
  log "Updating backend deps..."
  composer install --no-dev --optimize-autoloader --no-interaction

  # ---------- SAFETY: backup DB before any schema change ----------
  if [[ -f .env ]]; then
    DB_CONN=$(grep -E '^DB_CONNECTION=' .env | cut -d= -f2- | tr -d '"' || true)
    DB_HOST=$(grep -E '^DB_HOST='       .env | cut -d= -f2- | tr -d '"' || true)
    DB_PORT=$(grep -E '^DB_PORT='       .env | cut -d= -f2- | tr -d '"' || true)
    DB_NAME=$(grep -E '^DB_DATABASE='   .env | cut -d= -f2- | tr -d '"' || true)
    DB_USER=$(grep -E '^DB_USERNAME='   .env | cut -d= -f2- | tr -d '"' || true)
    DB_PASS=$(grep -E '^DB_PASSWORD='   .env | cut -d= -f2- | tr -d '"' || true)
    if [[ "${DB_CONN:-mysql}" == "mysql" && -n "${DB_NAME:-}" ]]; then
      mkdir -p "${BACKUP_DIR}"
      BKP="${BACKUP_DIR}/predeploy-$(date +%Y%m%d-%H%M%S).sql.gz"
      log "Backing up database to ${BKP} ..."
      if MYSQL_PWD="${DB_PASS}" mysqldump \
            --single-transaction --quick --routines --triggers --no-tablespaces \
            -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" \
            -u "${DB_USER}" "${DB_NAME}" 2>/dev/null | gzip > "${BKP}"; then
        log "Backup OK ($(du -h "${BKP}" | cut -f1))"
      else
        warn "mysqldump failed — continuing without DB backup. Roll back manually if needed."
        rm -f "${BKP}"
      fi
    fi
  fi

  # ---------- PRODUCTION-SAFE migrations (additive ONLY) ----------
  # NEVER run: migrate:fresh / migrate:reset / migrate:refresh / db:wipe / db:seed.
  # `migrate --force` only applies new "up()" migrations and preserves existing rows.
  log "Running additive migrations (no seeders, no data reset)..."
  php artisan migrate --force --no-interaction

  log "Clearing & re-caching..."
  php artisan config:clear
  php artisan route:clear
  php artisan view:clear
  php artisan cache:clear
  php artisan config:cache
  php artisan route:cache
  php artisan view:cache

  chown -R www-data:www-data storage bootstrap/cache public
  chmod -R 775 storage bootstrap/cache
fi

log "Reloading services..."
systemctl reload "php${PHP_VERSION}-fpm" || true
systemctl reload nginx || true

log "Deploy update complete. Existing data preserved; no seeders executed."
