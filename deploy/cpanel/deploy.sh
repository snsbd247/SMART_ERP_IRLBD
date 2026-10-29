#!/usr/bin/env bash
# ============================================================
#  SmartERP — cPanel deploy (erp.irlbd.com)
# ============================================================
#  Builds the frontend locally, uploads frontend + backend to the
#  cPanel account over SSH, runs migrations, and health-checks the
#  site. Rolls back automatically if the health check fails.
#
#  Server layout (cPanel, no git / composer / node on the server):
#    ~/erp_app/                         Laravel app (backend/)
#    ~/public_html/erp.irlbd.com/       web root: built frontend +
#                                       index.php / .htaccess that boot
#                                       ~/erp_app (kept as-is)
#
#  Usage (from the repo root, Git Bash on Windows or Linux/macOS):
#    CPANEL_PASS='...' bash deploy/cpanel/deploy.sh      # password auth (plink/pscp or sshpass)
#    bash deploy/cpanel/deploy.sh                        # SSH-key auth (ssh/scp)
#
#  Options (env):
#    CPANEL_HOST   default 163.227.239.146
#    CPANEL_USER   default ismail162
#    REMOTE_APP    default erp_app                       (relative to ~)
#    REMOTE_WEB    default public_html/erp.irlbd.com     (relative to ~)
#    SITE_URL      default https://erp.irlbd.com
#    WITH_VENDOR=1 also upload backend/vendor (only needed when
#                  composer dependencies changed; otherwise the
#                  server's existing vendor/ is reused)
#    SKIP_BUILD=1  reuse an existing frontend/dist
# ============================================================
set -euo pipefail

CPANEL_HOST="${CPANEL_HOST:-163.227.239.146}"
CPANEL_USER="${CPANEL_USER:-ismail162}"
REMOTE_APP="${REMOTE_APP:-erp_app}"
REMOTE_WEB="${REMOTE_WEB:-public_html/erp.irlbd.com}"
SITE_URL="${SITE_URL:-https://erp.irlbd.com}"
TARGET="${CPANEL_USER}@${CPANEL_HOST}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- transport: plink/pscp or sshpass (password), else ssh/scp (key) ----------
if [[ -n "${CPANEL_PASS:-}" ]] && command -v plink >/dev/null 2>&1; then
  remote() { plink -ssh -batch -pw "${CPANEL_PASS}" "${TARGET}" "$1"; }
  # pscp is a native Windows exe: hand it a Windows path.
  upload() { local src="$1"; command -v cygpath >/dev/null 2>&1 && src="$(cygpath -w "$1")"; pscp -batch -q -pw "${CPANEL_PASS}" "${src}" "${TARGET}:$2"; }
elif [[ -n "${CPANEL_PASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
  remote() { SSHPASS="${CPANEL_PASS}" sshpass -e ssh "${TARGET}" "$1"; }
  upload() { SSHPASS="${CPANEL_PASS}" sshpass -e scp -q "$1" "${TARGET}:$2"; }
else
  remote() { ssh "${TARGET}" "$1"; }
  upload() { scp -q "$1" "${TARGET}:$2"; }
fi

# ---------- 1. Build frontend ----------
cd "${ROOT}/frontend"
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  log "Building frontend..."
  [[ -d node_modules ]] || npm install --no-audit --no-fund --legacy-peer-deps
  npm run build
fi
[[ -f dist/index.html ]] || fail "frontend/dist/index.html missing — build failed?"

# ---------- 2. Package ----------
log "Packaging..."
tar czf "${WORK}/frontend.tar.gz" -C "${ROOT}/frontend/dist" .
# Backend comes from the committed tree (LF line endings, tracked files
# only — never .env or local junk). storage/ is carried over on the server.
if [[ -n "$(git -C "${ROOT}" status --porcelain -- backend)" ]]; then
  fail "backend/ has uncommitted changes — commit them first (the backend is deployed from HEAD)."
fi
git -C "${ROOT}" -c core.autocrlf=false archive --format=tar HEAD:backend | tar x -C "${WORK}" --one-top-level=backend
rm -rf "${WORK}/backend/storage" "${WORK}/backend/tests"
if [[ "${WITH_VENDOR:-0}" == "1" ]]; then
  [[ -d "${ROOT}/backend/vendor" ]] || fail "WITH_VENDOR=1 but backend/vendor is missing (run composer install)."
  cp -a "${ROOT}/backend/vendor" "${WORK}/backend/vendor"
fi
tar czf "${WORK}/backend.tar.gz" -C "${WORK}/backend" .

# ---------- 3. Upload ----------
RTMP="deploy-tmp/${STAMP}"
remote "mkdir -p ~/${RTMP}"
log "Uploading frontend ($(du -h "${WORK}/frontend.tar.gz" | cut -f1)) and backend ($(du -h "${WORK}/backend.tar.gz" | cut -f1))..."
upload "${WORK}/frontend.tar.gz" "${RTMP}/frontend.tar.gz"
upload "${WORK}/backend.tar.gz" "${RTMP}/backend.tar.gz"

# ---------- 4. Install on the server (backup -> stage -> swap -> migrate) ----------
log "Installing on server..."
remote "bash -s" <<REMOTE || fail "server install step failed (live site untouched unless swap completed — see output)"
set -euo pipefail
cd ~
APP="${REMOTE_APP}"; WEB="${REMOTE_WEB}"; TMP="${RTMP}"
BK=~/db_backups/deploy-${STAMP}
mkdir -p "\$BK"

# Backup: database (credentials read through Laravel, never echoed) + web root.
php -r 'require "\$argv[1]/vendor/autoload.php"; \$a=require "\$argv[1]/bootstrap/app.php"; \$a->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); \$c=config("database.connections.mysql"); file_put_contents(\$argv[2], "[client]\nuser=\"".\$c["username"]."\"\npassword=\"".addcslashes(\$c["password"],"\\\\\"")."\"\nhost=".\$c["host"]."\n"); echo \$c["database"];' ~/"\$APP" "\$BK/.my.cnf" > "\$BK/.dbname"
chmod 600 "\$BK/.my.cnf"
mysqldump --defaults-extra-file="\$BK/.my.cnf" --single-transaction --routines --triggers --no-tablespaces "\$(cat "\$BK/.dbname")" | gzip > "\$BK/database.sql.gz"
rm -f "\$BK/.my.cnf" "\$BK/.dbname"
tar czf "\$BK/web.tar.gz" -C ~/public_html "\$(basename "\$WEB")"
echo "backup: \$BK"

# Stage the new backend next to the live one, carrying over runtime state.
NEW=~/"\$APP.new"; rm -rf "\$NEW"; mkdir -p "\$NEW"
tar xzf "\$TMP/backend.tar.gz" -C "\$NEW"
cp -a ~/"\$APP/.env" "\$NEW/.env"
[ -f ~/"\$APP/composer.lock" ] && [ ! -f "\$NEW/composer.lock" ] && cp -a ~/"\$APP/composer.lock" "\$NEW/"
[ -d "\$NEW/vendor" ] || cp -a ~/"\$APP/vendor" "\$NEW/vendor"
rm -rf "\$NEW/storage"; cp -a ~/"\$APP/storage" "\$NEW/storage"
mkdir -p "\$NEW/bootstrap/cache"
( cd "\$NEW" && php artisan --version >/dev/null ) || { echo "staged app does not boot — aborting, live untouched"; rm -rf "\$NEW"; exit 1; }

# Maintenance window: swap backend + frontend.
( cd ~/"\$APP" && php artisan down --retry=15 >/dev/null 2>&1 || true )
# Re-copy storage now that writes are paused, so no upload/log is lost.
rm -rf "\$NEW/storage"; cp -a ~/"\$APP/storage" "\$NEW/storage"
rm -f "\$NEW/storage/framework/down" "\$NEW/storage/framework/maintenance.php"
mv ~/"\$APP" ~/"\$APP.prev-${STAMP}"
mv "\$NEW" ~/"\$APP"
# assets/ is kept: hashed page chunks from the previous build must stay
# reachable for tabs that were open during the deploy. Files not refreshed
# by a build for 14 days are pruned.
find ~/"\$WEB" -maxdepth 1 -mindepth 1 \
  ! -name index.php ! -name .htaccess ! -name storage ! -name .well-known ! -name cgi-bin ! -name assets \
  -exec rm -rf {} +
tar xzf "\$TMP/frontend.tar.gz" -C ~/"\$WEB"
find ~/"\$WEB/assets" -type f -mtime +14 -delete 2>/dev/null || true
echo "prev: ~/\$APP.prev-${STAMP}"

cd ~/"\$APP"
php artisan migrate --force
php artisan optimize:clear >/dev/null
php artisan up >/dev/null
rm -rf ~/"\$TMP"
rmdir ~/deploy-tmp 2>/dev/null || true
REMOTE

# ---------- 5. Health check (auto-rollback on failure) ----------
log "Health check..."
ok=1
code_home=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${SITE_URL}/") || code_home=000
code_api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${SITE_URL}/api/v1/public/branding") || code_api=000
log "  ${SITE_URL}/ -> ${code_home} ; /api/v1/public/branding -> ${code_api}"
[[ "${code_home}" == "200" && "${code_api}" == "200" ]] || ok=0

if [[ "${ok}" != "1" ]]; then
  log "Health check FAILED — rolling back to the previous version..."
  remote "bash -s" <<ROLLBACK
set -e
cd ~
rm -rf ~/"${REMOTE_APP}.failed-${STAMP}"
mv ~/"${REMOTE_APP}" ~/"${REMOTE_APP}.failed-${STAMP}"
mv ~/"${REMOTE_APP}.prev-${STAMP}" ~/"${REMOTE_APP}"
find ~/"${REMOTE_WEB}" -maxdepth 1 -mindepth 1 ! -name .well-known ! -name cgi-bin -exec rm -rf {} +
tar xzf ~/db_backups/deploy-${STAMP}/web.tar.gz -C ~/public_html
( cd ~/"${REMOTE_APP}" && php artisan up >/dev/null 2>&1 || true )
ROLLBACK
  fail "Deploy rolled back (code restored; migrations, if any ran, were not reverted — DB backup: ~/db_backups/deploy-${STAMP}/database.sql.gz)."
fi

log "Deploy complete. Previous backend kept at ~/${REMOTE_APP}.prev-${STAMP}; backup in ~/db_backups/deploy-${STAMP}/"
