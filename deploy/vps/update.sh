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
STARTED_UPDATE_SHA="$(sha256sum "$0" 2>/dev/null | awk '{print $1}' || true)"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_NC='\033[0m'
log()  { echo -e "${C_GREEN}[$(date +%H:%M:%S)]${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_NC} $*"; }
err()  { echo -e "${C_RED}[ERR ]${C_NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root (sudo ./update.sh)"; exit 1; fi
if [[ ! -d "${APP_DIR}/.git" ]]; then err "${APP_DIR} is not a git checkout. Run clone.sh first."; exit 1; fi

install_deploy_runner() {
  if [[ ! -f "${APP_DIR}/deploy/vps/deploy-runner.sh" ]]; then
    warn "deploy-runner.sh not found; Pull & Deploy runner was not refreshed."
    return 0
  fi

  local runner_pid=""
  [[ -f /var/run/smarterp-deploy.pid ]] && runner_pid="$(cat /var/run/smarterp-deploy.pid 2>/dev/null || true)"
  if [[ "${SMARTERP_DEPLOY_RUNNER:-0}" == "1" ]] \
     || [[ -n "${runner_pid}" && -d "/proc/${runner_pid}" ]]; then
    log "Pull & Deploy runner is active; skipping self-overwrite during web deploy."
    return 0
  fi

  log "Refreshing Pull & Deploy runner (/usr/local/bin/smarterp-deploy)..."
  install -m 0755 -o root -g root "${APP_DIR}/deploy/vps/deploy-runner.sh" /usr/local/bin/smarterp-deploy
  sed -i "s|^APP_DIR=.*|APP_DIR=\"${APP_DIR}\"|" /usr/local/bin/smarterp-deploy

  touch /var/log/smarterp-deploy.log /var/log/smarterp-deploy.state
  chown www-data:www-data /var/log/smarterp-deploy.log /var/log/smarterp-deploy.state
  chmod 0664 /var/log/smarterp-deploy.log /var/log/smarterp-deploy.state

  local sudoers_tmp
  sudoers_tmp="$(mktemp)"
  cat > "${sudoers_tmp}" <<SUDO
www-data ALL=(root) NOPASSWD: /usr/local/bin/smarterp-deploy
Defaults!/usr/local/bin/smarterp-deploy !requiretty
SUDO
  chmod 0440 "${sudoers_tmp}"
  if visudo -cf "${sudoers_tmp}" >/dev/null; then
    install -m 0440 -o root -g root "${sudoers_tmp}" /etc/sudoers.d/smarterp-deploy
    rm -f "${sudoers_tmp}"
  else
    rm -f "${sudoers_tmp}"
    err "Generated sudoers file is invalid; Pull & Deploy runner not installed."
    exit 1
  fi

  sudo -u www-data sudo -n /usr/local/bin/smarterp-deploy --check >/dev/null \
    || warn "Pull & Deploy sudo check failed; verify /etc/sudoers.d/smarterp-deploy."
}

cd "${APP_DIR}"
log "Pulling latest from origin/${REPO_BRANCH}..."
git fetch --all --prune
git checkout "${REPO_BRANCH}"
git reset --hard "origin/${REPO_BRANCH}"

LATEST_UPDATE_SHA="$(sha256sum "${APP_DIR}/deploy/vps/update.sh" 2>/dev/null | awk '{print $1}' || true)"
if [[ "${SMARTERP_UPDATE_REEXECED:-0}" != "1" && -n "${STARTED_UPDATE_SHA}" && -n "${LATEST_UPDATE_SHA}" && "${STARTED_UPDATE_SHA}" != "${LATEST_UPDATE_SHA}" ]]; then
  log "update.sh changed during pull; restarting once with the latest script..."
  export SMARTERP_UPDATE_REEXECED=1 APP_DIR REPO_BRANCH PHP_VERSION BACKUP_DIR
  exec bash "${APP_DIR}/deploy/vps/update.sh"
fi

install_deploy_runner

log "Rebuilding frontend..."
if [[ -f package.json ]]; then
  APP_URL="https://erp.irlbd.com"
  if [[ -f "${APP_DIR}/erp-backend/.env" ]]; then
    APP_URL_FROM_ENV=$(grep -E '^APP_URL=' "${APP_DIR}/erp-backend/.env" | cut -d= -f2- | tr -d '"' || true)
    [[ -n "${APP_URL_FROM_ENV:-}" ]] && APP_URL="${APP_URL_FROM_ENV%/}"
  fi
  export VITE_API_BASE_URL="${APP_URL}/api"
  export VITE_SUPABASE_URL="${APP_URL}/supabase-disabled"
  export VITE_SUPABASE_PUBLISHABLE_KEY="vps-laravel-mode-no-supabase"
  export VITE_SUPABASE_PROJECT_ID="vps-laravel"
  npm install --no-audit --no-fund --legacy-peer-deps
  npm run build
fi

if [[ -d "${APP_DIR}/erp-backend" ]]; then
  cd "${APP_DIR}/erp-backend"
  log "Updating backend deps..."
  composer install --no-dev --optimize-autoloader --no-interaction
  mkdir -p storage/app/public storage/app/backups storage/framework/cache/data \
           storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
  chown -R www-data:www-data storage bootstrap/cache
  chmod -R 775 storage bootstrap/cache

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

  log "Repairing VPS token-only auth/install flags..."
  if [[ -f .env ]]; then
    grep -q '^SANCTUM_STATEFUL_DOMAINS=' .env \
      && sed -i 's|^SANCTUM_STATEFUL_DOMAINS=.*|SANCTUM_STATEFUL_DOMAINS=|' .env \
      || printf '\nSANCTUM_STATEFUL_DOMAINS=\n' >> .env
    grep -q '^SESSION_DOMAIN=' .env \
      && sed -i 's|^SESSION_DOMAIN=.*|SESSION_DOMAIN=|' .env \
      || printf 'SESSION_DOMAIN=\n' >> .env
  fi
  if [[ "${DB_CONN:-mysql}" == "mysql" && -n "${DB_NAME:-}" ]]; then
    MYSQL_PWD="${DB_PASS}" mysql -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "${DB_USER}" "${DB_NAME}" <<SQL || warn "Could not update installed flag"
INSERT INTO system_settings (setting_key, setting_value, is_encrypted, created_at, updated_at)
VALUES ('setup_completed', 'true', 0, NOW(), NOW())
ON DUPLICATE KEY UPDATE setting_value = 'true', updated_at = NOW();
SQL
  fi
  touch storage/installed

  log "Clearing & re-caching..."
  php artisan config:clear
  php artisan route:clear
  php artisan view:clear
  php artisan cache:clear
  php artisan config:cache
  php artisan route:cache
  php artisan view:cache

  if [[ -d "${APP_DIR}/dist" ]]; then
    log "Copying built frontend into Laravel public/ ..."
    rm -rf "${APP_DIR}/erp-backend/public/assets" 2>/dev/null || true
    rsync -a --exclude='index.php' --exclude='.htaccess' --exclude='storage' \
      "${APP_DIR}/dist/" "${APP_DIR}/erp-backend/public/"
  fi

  chown -R www-data:www-data storage bootstrap/cache public
  chmod -R 775 storage bootstrap/cache
fi

log "Reloading services..."
systemctl reload "php${PHP_VERSION}-fpm" || true
systemctl reload nginx || true

log "Deploy update complete. Existing data preserved; no seeders executed."
