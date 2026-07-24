#!/usr/bin/env bash
# ============================================================
#  SmartERP — App Clone (Step 2)
#  Clones the repo and installs PHP + Node dependencies, builds
#  the React frontend into erp-backend/public.
# ============================================================
#  Usage:
#     sudo REPO_URL=... APP_DIR=/opt/smarterp ./clone.sh
# ============================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/snsbd247/audit-treasure-6d69be20.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/smarterp}"

C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_NC='\033[0m'
log() { echo -e "${C_GREEN}[$(date +%H:%M:%S)]${C_NC} $*"; }
err() { echo -e "${C_RED}[ERR ]${C_NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root (sudo ./clone.sh)"; exit 1; fi

log "Cloning ${REPO_URL} (branch ${REPO_BRANCH}) into ${APP_DIR}..."
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --all --prune
  git -C "${APP_DIR}" checkout "${REPO_BRANCH}"
  git -C "${APP_DIR}" reset --hard "origin/${REPO_BRANCH}"
else
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone --branch "${REPO_BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

log "Installing frontend deps and building..."
cd "${APP_DIR}"
if [[ -f package.json ]]; then
  npm install --no-audit --no-fund --legacy-peer-deps
  npm run build
fi

# Deploy React build into Laravel public/ (SPA served as index.html)
if [[ -d "${APP_DIR}/dist" && -d "${APP_DIR}/erp-backend/public" ]]; then
  log "Copying dist/ -> erp-backend/public/ ..."
  # Preserve Laravel's index.php, .htaccess, storage symlink
  rsync -a --exclude='index.php' --exclude='.htaccess' --exclude='storage' \
    "${APP_DIR}/dist/" "${APP_DIR}/erp-backend/public/"
fi


log "Installing backend (Laravel) deps..."
if [[ -d "${APP_DIR}/erp-backend" ]]; then
  cd "${APP_DIR}/erp-backend"
  export COMPOSER_ALLOW_SUPERUSER=1
  composer config --global --no-plugins allow-plugins.php-http/discovery true || true
  composer config --global --no-plugins policy.advisories.block false || true
  composer config --no-plugins policy.advisories.block false || true
  composer update --no-dev --optimize-autoloader --no-interaction --no-plugins \
    --ignore-platform-req=ext-imagick --no-audit \
    || composer install --no-dev --optimize-autoloader --no-interaction --no-plugins --no-audit
  [[ -f .env ]] || cp .env.example .env
  php artisan key:generate --force || true
  php artisan storage:link --force >/dev/null 2>&1 || true
  mkdir -p storage/app/public storage/app/backups storage/framework/cache/data \
           storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
  chown -R www-data:www-data storage bootstrap/cache public
  chmod -R 775 storage bootstrap/cache
fi

log "Clone & install complete. Next: configure .env, then run ./update.sh"
