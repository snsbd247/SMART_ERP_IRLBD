#!/usr/bin/env bash
# ============================================================
#  SmartERP — Deploy Update
#  Pulls latest code, reinstalls deps, runs migrations, rebuilds
#  frontend, clears caches. Safe to re-run on each deploy.
# ============================================================
#  Usage:
#     sudo APP_DIR=/opt/smarterp ./update.sh
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/smarterp}"
REPO_BRANCH="${REPO_BRANCH:-main}"
PHP_VERSION="${PHP_VERSION:-8.2}"

C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_NC='\033[0m'
log() { echo -e "${C_GREEN}[$(date +%H:%M:%S)]${C_NC} $*"; }
err() { echo -e "${C_RED}[ERR ]${C_NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root (sudo ./update.sh)"; exit 1; fi
if [[ ! -d "${APP_DIR}/.git" ]]; then err "${APP_DIR} is not a git checkout. Run clone.sh first."; exit 1; fi

cd "${APP_DIR}"
log "Pulling latest from origin/${REPO_BRANCH}..."
git fetch --all --prune
git checkout "${REPO_BRANCH}"
git reset --hard "origin/${REPO_BRANCH}"

log "Rebuilding frontend..."
if [[ -f package.json ]]; then
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
  npm run build
fi

if [[ -d "${APP_DIR}/erp-backend" ]]; then
  cd "${APP_DIR}/erp-backend"
  log "Updating backend deps..."
  composer install --no-dev --optimize-autoloader --no-interaction

  log "Running migrations..."
  php artisan migrate --force || true

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

log "Deploy update complete."
