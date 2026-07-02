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
REPO_URL="${REPO_URL:-https://github.com/snsbd247/audit-treasure-6d69be20.git}"
PHP_VERSION="${PHP_VERSION:-8.2}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/smarterp}"
STATUS_FILE="${STATUS_FILE:-/var/log/smarterp-deploy.status.json}"
MIN_FREE_MB="${MIN_FREE_MB:-500}"
STARTED_UPDATE_SHA="$(sha256sum "$0" 2>/dev/null | awk '{print $1}' || true)"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_NC='\033[0m'
log()  { echo -e "${C_GREEN}[$(date +%H:%M:%S)]${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_NC} $*"; }
err()  { echo -e "${C_RED}[ERR ]${C_NC} $*" >&2; }

# ---------- Structured status JSON (consumed by DeployController) ----------
STEPS_JSON='[]'
DEPLOY_STARTED_AT="$(date -Iseconds)"
PREV_SHA=""; NEW_SHA=""; DB_BACKUP_PATH=""
status_write() {
  local state="$1" msg="${2:-}"
  cat > "${STATUS_FILE}" <<JSON 2>/dev/null || true
{
  "state": "${state}",
  "message": $(printf '%s' "${msg}" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"${msg//\"/\\\"}\""),
  "started_at": "${DEPLOY_STARTED_AT}",
  "finished_at": "$(date -Iseconds)",
  "prev_sha": "${PREV_SHA}",
  "new_sha": "${NEW_SHA}",
  "db_backup": "${DB_BACKUP_PATH}",
  "steps": ${STEPS_JSON}
}
JSON
  chmod 0664 "${STATUS_FILE}" 2>/dev/null || true
}
step() {
  local name="$1" status="$2" detail="${3:-}"
  log "[${status}] ${name}${detail:+ — ${detail}}"
  STEPS_JSON=$(python3 -c "
import json,sys
arr=json.loads('''${STEPS_JSON}''')
arr.append({'name':'${name}','status':'${status}','detail':'''${detail//\'/\\\'}''','at':'$(date -Iseconds)'})
print(json.dumps(arr))
" 2>/dev/null || echo "${STEPS_JSON}")
  status_write running "${name}"
}
on_failure() {
  local rc=$?
  err "Update failed (exit ${rc}). Rollback available via: sudo /usr/local/bin/smarterp-rollback"
  status_write failed "Update failed at step '${CURRENT_STEP:-unknown}' (exit ${rc}). Run rollback to restore previous deploy."
  exit "${rc}"
}
trap on_failure ERR

if [[ $EUID -ne 0 ]]; then err "Run as root (sudo ./update.sh)"; exit 1; fi
if [[ ! -d "${APP_DIR}/.git" ]]; then err "${APP_DIR} is not a git checkout. Run clone.sh first."; exit 1; fi

# Prevent overlapping Pull & Deploy runs. This is intentionally also here
# (not only in deploy-runner.sh) so a newly pulled update.sh can protect the
# VPS even before /usr/local/bin/smarterp-deploy has been refreshed.
UPDATE_LOCK="${UPDATE_LOCK:-/var/run/smarterp-update.lock}"
if [[ "${SMARTERP_UPDATE_LOCKED:-0}" != "1" ]]; then
  if command -v flock >/dev/null 2>&1; then
    exec 8>"${UPDATE_LOCK}"
    if ! flock -n 8; then
      warn "Another deploy update is already running; ignoring duplicate request."
      status_write running "Another deploy update is already running; duplicate request ignored."
      exit 0
    fi
    export SMARTERP_UPDATE_LOCKED=1 UPDATE_LOCK
  else
    warn "flock not available; duplicate deploy protection is limited."
  fi
fi

# ============================================================
#  PRE-DEPLOYMENT CHECKS
# ============================================================
CURRENT_STEP="preflight"; status_write running "preflight"
log "Running pre-deployment checks..."

# Disk space
APP_FREE_MB=$(df -Pm "${APP_DIR}"   | awk 'NR==2 {print $4}')
VAR_FREE_MB=$(df -Pm /var           | awk 'NR==2 {print $4}')
if (( APP_FREE_MB < MIN_FREE_MB )); then
  step "disk-space" failed "Only ${APP_FREE_MB}MB free in ${APP_DIR} (need ${MIN_FREE_MB}MB)"
  err  "Insufficient disk space in ${APP_DIR}"; exit 1
fi
if (( VAR_FREE_MB < MIN_FREE_MB )); then
  step "disk-space" failed "Only ${VAR_FREE_MB}MB free in /var (need ${MIN_FREE_MB}MB)"
  err  "Insufficient disk space in /var"; exit 1
fi
step "disk-space" ok "app=${APP_FREE_MB}MB var=${VAR_FREE_MB}MB free"

# Required tools
for bin in git php composer node npm rsync mysqldump; do
  command -v "$bin" >/dev/null 2>&1 || { step "tooling" failed "missing: $bin"; err "Required tool not found: $bin"; exit 1; }
done
step "tooling" ok "git/php/composer/node/npm/rsync/mysqldump present"

# ---------- PHP extensions auto-install ----------
CURRENT_STEP="php-extensions"
REQUIRED_PHP_EXT=(bcmath ctype curl dom fileinfo gd intl mbstring openssl pdo pdo_mysql tokenizer xml zip)
PHP_BUILTIN_EXT=(ctype fileinfo openssl pdo tokenizer)
php_ext_is_builtin() {
  local needle="$1"
  local ext
  for ext in "${PHP_BUILTIN_EXT[@]}"; do
    [[ "$ext" == "$needle" ]] && return 0
  done
  return 1
}
php_ext_package_name() {
  local ext="$1"
  case "$ext" in
    dom) echo "php${PHP_VERSION}-xml" ;;
    mysqli|mysqlnd|pdo_mysql) echo "php${PHP_VERSION}-mysql" ;;
    *) echo "php${PHP_VERSION}-${ext}" ;;
  esac
}
php_ext_loaded() {
  # Authoritative check: extension_loaded() works regardless of `php -m` formatting
  # (some extensions like pdo_mysql appear under [PDO_Drivers], not as their own line).
  php -r "exit(extension_loaded('$1') ? 0 : 1);" >/dev/null 2>&1
}
MISSING_EXT=()
MISSING_BUILTIN_EXT=()
for ext in "${REQUIRED_PHP_EXT[@]}"; do
  if ! php_ext_loaded "${ext}"; then
    if php_ext_is_builtin "${ext}"; then
      MISSING_BUILTIN_EXT+=("${ext}")
    else
      pkg="$(php_ext_package_name "${ext}")"
      [[ " ${MISSING_EXT[*]} " == *" ${pkg} "* ]] || MISSING_EXT+=("${pkg}")
    fi
  fi
done
if (( ${#MISSING_BUILTIN_EXT[@]} > 0 )); then
  warn "PHP built-in extensions not visible in CLI: ${MISSING_BUILTIN_EXT[*]} (not installable via apt; continuing)."
fi
if (( ${#MISSING_EXT[@]} > 0 )); then
  log "Installing missing PHP extensions: ${MISSING_EXT[*]}"
  if command -v apt-get >/dev/null 2>&1; then
    # Prevent silent hangs:
    #  - DEBIAN_FRONTEND=noninteractive + APT_LISTCHANGES_FRONTEND=none: no prompts
    #  - NEEDRESTART_MODE=a: auto-restart services (no interactive menu on Ubuntu 22.04+)
    #  - Dpkg::Options: keep old conffiles without asking
    #  - DPkg::Lock::Timeout: wait up to 120s for apt lock instead of hanging forever
    #  - timeout <s>: hard cap so the deploy never blocks indefinitely
    #  - </dev/null: guarantee no TTY read
    export DEBIAN_FRONTEND=noninteractive
    export APT_LISTCHANGES_FRONTEND=none
    export NEEDRESTART_MODE=a
    export NEEDRESTART_SUSPEND=1
    APT_OPTS=(-y --no-install-recommends
      -o Dpkg::Options::=--force-confdef
      -o Dpkg::Options::=--force-confold
      -o DPkg::Lock::Timeout=120)
    log "  apt-get update..."
    timeout 180 apt-get update "${APT_OPTS[@]}" </dev/null 2>&1 | tail -n 20 || warn "apt-get update timed out or failed (continuing)."
    log "  apt-get install ${MISSING_EXT[*]}..."
    if timeout 300 apt-get install "${APT_OPTS[@]}" "${MISSING_EXT[@]}" </dev/null 2>&1 | tail -n 40; then
      systemctl reload "php${PHP_VERSION}-fpm" 2>/dev/null || true
      STILL_MISSING=()
      for ext in "${REQUIRED_PHP_EXT[@]}"; do
        php_ext_loaded "${ext}" || STILL_MISSING+=("${ext}")
      done
      if (( ${#STILL_MISSING[@]} > 0 )); then
        warn "PHP extensions still not visible after install: ${STILL_MISSING[*]}"
        step "php-extensions" warn "installed packages: ${MISSING_EXT[*]}; still missing: ${STILL_MISSING[*]}"
      else
        step "php-extensions" ok "installed: ${MISSING_EXT[*]}"
      fi
    else
      warn "Some PHP extensions failed to install (continuing)."
      step "php-extensions" warn "install failed or timed out: ${MISSING_EXT[*]}"
    fi
  else
    warn "apt-get not available; skipping auto-install of: ${MISSING_EXT[*]}"
    step "php-extensions" warn "apt-get unavailable"
  fi
else
  step "php-extensions" ok "all required extensions present"
fi

# Record current SHA (used for rollback)
cd "${APP_DIR}"
PREV_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
[[ -n "${PREV_SHA}" ]] && step "git-snapshot" ok "previous SHA=${PREV_SHA:0:8}"

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
  if install -m 0755 -o root -g root "${APP_DIR}/deploy/vps/deploy-runner.sh" /usr/local/bin/smarterp-deploy; then
    sed -i "s|^APP_DIR=.*|APP_DIR=\"${APP_DIR}\"|" /usr/local/bin/smarterp-deploy
  elif [[ -x /usr/local/bin/smarterp-deploy ]]; then
    warn "Could not overwrite /usr/local/bin/smarterp-deploy; existing executable runner will be used."
  else
    err "Could not install /usr/local/bin/smarterp-deploy and no existing runner is executable."
    exit 1
  fi

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

install_rollback_runner() {
  if [[ ! -f "${APP_DIR}/deploy/vps/rollback.sh" ]]; then
    warn "rollback.sh not found; rollback runner was not installed."
    return 0
  fi
  log "Refreshing rollback runner (/usr/local/bin/smarterp-rollback)..."
  install -m 0755 -o root -g root "${APP_DIR}/deploy/vps/rollback.sh" /usr/local/bin/smarterp-rollback || {
    warn "Could not install rollback runner."; return 0; }
  sed -i "s|^APP_DIR=.*|APP_DIR=\"${APP_DIR}\"|" /usr/local/bin/smarterp-rollback

  local sudoers_tmp; sudoers_tmp="$(mktemp)"
  cat > "${sudoers_tmp}" <<SUDO
www-data ALL=(root) NOPASSWD: /usr/local/bin/smarterp-rollback
Defaults!/usr/local/bin/smarterp-rollback !requiretty
SUDO
  chmod 0440 "${sudoers_tmp}"
  if visudo -cf "${sudoers_tmp}" >/dev/null; then
    install -m 0440 -o root -g root "${sudoers_tmp}" /etc/sudoers.d/smarterp-rollback
  else
    warn "Generated rollback sudoers file invalid; not installed."
  fi
  rm -f "${sudoers_tmp}"
}

cd "${APP_DIR}"
CURRENT_STEP="git-pull"
log "Pulling latest from origin/${REPO_BRANCH}..."
# Ensure 'origin' points to the configured REPO_URL (auto-heal stale remotes).
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_ORIGIN="$(git remote get-url origin 2>/dev/null || true)"
  if [[ -n "${REPO_URL}" && "${CURRENT_ORIGIN}" != "${REPO_URL}" ]]; then
    log "Updating 'origin' remote: ${CURRENT_ORIGIN} → ${REPO_URL}"
    git remote set-url origin "${REPO_URL}"
  fi
else
  log "Adding 'origin' remote: ${REPO_URL}"
  git remote add origin "${REPO_URL}"
fi
git fetch --all --prune
git checkout "${REPO_BRANCH}"
git reset --hard "origin/${REPO_BRANCH}"
NEW_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
step "git-pull" ok "${PREV_SHA:0:8} → ${NEW_SHA:0:8}"

LATEST_UPDATE_SHA="$(sha256sum "${APP_DIR}/deploy/vps/update.sh" 2>/dev/null | awk '{print $1}' || true)"
if [[ "${SMARTERP_UPDATE_REEXECED:-0}" != "1" && -n "${STARTED_UPDATE_SHA}" && -n "${LATEST_UPDATE_SHA}" && "${STARTED_UPDATE_SHA}" != "${LATEST_UPDATE_SHA}" ]]; then
  log "update.sh changed during pull; restarting once with the latest script..."
  export SMARTERP_UPDATE_REEXECED=1 APP_DIR REPO_BRANCH PHP_VERSION BACKUP_DIR STATUS_FILE
  exec bash "${APP_DIR}/deploy/vps/update.sh"
fi

install_deploy_runner
install_rollback_runner

# ---------- PRE-CHECK: pending migrations (no side-effects) ----------
if [[ -d "${APP_DIR}/erp-backend" ]]; then
  CURRENT_STEP="migrations-check"
  PENDING=$(cd "${APP_DIR}/erp-backend" && php artisan migrate:status --pending 2>&1 | grep -cE '^\s*\|\s+[NY]\s+\|' || true)
  step "migrations-check" ok "${PENDING} pending migration(s)"
fi

CURRENT_STEP="frontend-build"
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
  step "frontend-build" ok "dist/ rebuilt"
fi

if [[ -d "${APP_DIR}/erp-backend" ]]; then
  cd "${APP_DIR}/erp-backend"
  CURRENT_STEP="composer-install"
  log "Updating backend deps..."
  composer install --no-dev --optimize-autoloader --no-interaction
  mkdir -p storage/app/public storage/app/backups storage/framework/cache/data \
           storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
  chown -R www-data:www-data storage bootstrap/cache
  chmod -R 775 storage bootstrap/cache
  step "composer-install" ok

  # ---------- SAFETY: backup DB before any schema change ----------
  CURRENT_STEP="db-backup"
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
        DB_BACKUP_PATH="${BKP}"
        echo "${BKP}|${PREV_SHA}" > "${BACKUP_DIR}/.last-deploy"
        step "db-backup" ok "$(du -h "${BKP}" | cut -f1) → ${BKP}"
      else
        warn "mysqldump failed — continuing without DB backup. Roll back manually if needed."
        rm -f "${BKP}"
        step "db-backup" warn "mysqldump failed"
      fi
    fi
  fi

  # ---------- PRODUCTION-SAFE migrations (additive ONLY) ----------
  CURRENT_STEP="migrate"
  log "Running additive migrations (no data reset)..."
  php artisan migrate --force --no-interaction
  step "migrate" ok

  # ---------- Optional seeders (opt-in via RUN_SEEDERS=1) ----------
  # Default OFF to preserve production safety. Set RUN_SEEDERS=1 to run
  # idempotent master-data seeders (e.g. CoA, units, roles). Demo data
  # should ONLY be loaded from the in-app "Reset & Seed Demo" panel.
  CURRENT_STEP="db-seed"
  if [[ "${RUN_SEEDERS:-0}" == "1" ]]; then
    SEEDER_CLASS="${SEEDER_CLASS:-Database\\Seeders\\ProductionSeeder}"
    log "Running seeders: ${SEEDER_CLASS} (opt-in)..."
    if php artisan db:seed --class="${SEEDER_CLASS}" --force --no-interaction; then
      step "db-seed" ok "${SEEDER_CLASS}"
    else
      warn "Seeder ${SEEDER_CLASS} failed (continuing)."
      step "db-seed" warn "${SEEDER_CLASS} failed"
    fi
  else
    step "db-seed" ok "skipped (RUN_SEEDERS!=1)"
  fi

  CURRENT_STEP="env-fixups"
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
  step "env-fixups" ok

  CURRENT_STEP="cache-refresh"
  log "Clearing & re-caching..."
  php artisan config:clear
  php artisan route:clear
  php artisan view:clear
  php artisan cache:clear
  php artisan config:cache
  php artisan route:cache
  php artisan view:cache
  step "cache-refresh" ok

  if [[ -d "${APP_DIR}/dist" ]]; then
    CURRENT_STEP="publish-assets"
    log "Copying built frontend into Laravel public/ ..."
    rm -rf "${APP_DIR}/erp-backend/public/assets" 2>/dev/null || true
    rsync -a --exclude='index.php' --exclude='.htaccess' --exclude='storage' \
      "${APP_DIR}/dist/" "${APP_DIR}/erp-backend/public/"
    step "publish-assets" ok
  fi

  chown -R www-data:www-data storage bootstrap/cache public
  chmod -R 775 storage bootstrap/cache
fi

CURRENT_STEP="reload-services"
log "Reloading services..."
systemctl reload "php${PHP_VERSION}-fpm" || true
systemctl reload nginx || true
step "reload-services" ok

status_write success "Deploy complete (${PREV_SHA:0:8} → ${NEW_SHA:0:8})"
log "Deploy update complete. Existing data preserved; no seeders executed."
