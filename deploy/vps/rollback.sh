#!/usr/bin/env bash
# ============================================================
#  SmartERP — Rollback Runner
#  Restores the previous deploy: git reset to prior SHA + restore
#  pre-deploy MySQL backup + rebuild frontend + clear caches.
#
#  Reads the marker written by update.sh:
#     /var/backups/smarterp/.last-deploy   ->  "<backup_path>|<prev_sha>"
#
#  Installed at /usr/local/bin/smarterp-rollback by update.sh.
#  Invoked as: sudo -n /usr/local/bin/smarterp-rollback
# ============================================================
set -u

APP_DIR="${APP_DIR:-/opt/smarterp}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/smarterp}"
PHP_VERSION="${PHP_VERSION:-8.2}"
LOG=/var/log/smarterp-deploy.log
STATE=/var/log/smarterp-deploy.state
STATUS=/var/log/smarterp-deploy.status.json
MARKER="${BACKUP_DIR}/.last-deploy"

ts() { date +%H:%M:%S; }
say() { echo "[$(ts)] $*" | tee -a "$LOG"; }

if [[ "${1:-}" == "--check" ]]; then
  test -r "${MARKER}" && exit 0 || exit 1
fi

echo "running" > "$STATE" 2>/dev/null || true
say "── smarterp-rollback started ──"

if [[ ! -r "${MARKER}" ]]; then
  say "ERROR: no rollback marker at ${MARKER}. Nothing to roll back to."
  echo "failed" > "$STATE" 2>/dev/null || true
  exit 1
fi

LINE=$(cat "${MARKER}")
BKP_PATH="${LINE%%|*}"
PREV_SHA="${LINE##*|}"

say "Target SHA: ${PREV_SHA:0:8}"
say "DB backup:  ${BKP_PATH}"

# ---- 1. Git reset ----
cd "${APP_DIR}" || { say "ERROR: cannot cd ${APP_DIR}"; exit 1; }
if [[ -n "${PREV_SHA}" ]]; then
  say "Restoring code → ${PREV_SHA:0:8}"
  if ! git reset --hard "${PREV_SHA}" >>"$LOG" 2>&1; then
    say "ERROR: git reset failed."; echo "failed" > "$STATE" 2>/dev/null || true; exit 1
  fi
else
  say "WARN: no previous SHA in marker — skipping code revert."
fi

# ---- 2. Restore DB ----
if [[ -f "${BKP_PATH}" && -d "${APP_DIR}/erp-backend" && -f "${APP_DIR}/erp-backend/.env" ]]; then
  cd "${APP_DIR}/erp-backend"
  DB_HOST=$(grep -E '^DB_HOST='     .env | cut -d= -f2- | tr -d '"' || true)
  DB_PORT=$(grep -E '^DB_PORT='     .env | cut -d= -f2- | tr -d '"' || true)
  DB_NAME=$(grep -E '^DB_DATABASE=' .env | cut -d= -f2- | tr -d '"' || true)
  DB_USER=$(grep -E '^DB_USERNAME=' .env | cut -d= -f2- | tr -d '"' || true)
  DB_PASS=$(grep -E '^DB_PASSWORD=' .env | cut -d= -f2- | tr -d '"' || true)
  if [[ -n "${DB_NAME:-}" ]]; then
    say "Restoring database from ${BKP_PATH}..."
    if gunzip -c "${BKP_PATH}" | MYSQL_PWD="${DB_PASS}" mysql \
         -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "${DB_USER}" "${DB_NAME}" >>"$LOG" 2>&1; then
      say "Database restored."
    else
      say "ERROR: database restore failed."
      echo "failed" > "$STATE" 2>/dev/null || true; exit 1
    fi
  fi
fi

# ---- 3. Rebuild frontend at rolled-back code ----
if [[ -f "${APP_DIR}/package.json" ]]; then
  cd "${APP_DIR}"
  say "Reinstalling node modules + rebuilding frontend..."
  npm install --no-audit --no-fund --legacy-peer-deps >>"$LOG" 2>&1 || say "WARN: npm install issues"
  npm run build >>"$LOG" 2>&1 || { say "ERROR: npm build failed"; echo "failed" > "$STATE" 2>/dev/null || true; exit 1; }
fi

if [[ -d "${APP_DIR}/dist" && -d "${APP_DIR}/erp-backend/public" ]]; then
  rm -rf "${APP_DIR}/erp-backend/public/assets" 2>/dev/null || true
  rsync -a --exclude='index.php' --exclude='.htaccess' --exclude='storage' \
    "${APP_DIR}/dist/" "${APP_DIR}/erp-backend/public/" >>"$LOG" 2>&1 || true
fi

# ---- 4. Composer + caches ----
if [[ -d "${APP_DIR}/erp-backend" ]]; then
  cd "${APP_DIR}/erp-backend"
  say "composer install (no-dev)..."
  composer install --no-dev --optimize-autoloader --no-interaction >>"$LOG" 2>&1 || true
  for c in config:clear route:clear view:clear cache:clear config:cache route:cache view:cache; do
    php artisan $c >>"$LOG" 2>&1 || true
  done
  chown -R www-data:www-data storage bootstrap/cache public 2>/dev/null || true
  chmod -R 775 storage bootstrap/cache 2>/dev/null || true
fi

# ---- 5. Reload services ----
systemctl reload "php${PHP_VERSION}-fpm" 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true

# ---- 6. Status file ----
cat > "${STATUS}" <<JSON 2>/dev/null || true
{
  "state": "rolled_back",
  "message": "Rolled back to ${PREV_SHA:0:8}",
  "finished_at": "$(date -Iseconds)",
  "prev_sha": "${PREV_SHA}",
  "db_backup": "${BKP_PATH}",
  "steps": []
}
JSON
chmod 0664 "${STATUS}" 2>/dev/null || true

echo "success" > "$STATE" 2>/dev/null || true
say "ROLLBACK OK"
exit 0
