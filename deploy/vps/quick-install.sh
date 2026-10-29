#!/usr/bin/env bash
# ============================================================
#  SmartERP — One-Command VPS Quick Installer
#  Does EVERYTHING in one go:
#    1) Base setup (Nginx + PHP 8.2 + MySQL + Node 20 + Composer)
#    2) MySQL database + user
#    3) Clone repo + composer install + npm build
#    4) .env config + key:generate + migrate --seed
#    5) Nginx vhost + reload
#    6) SSL via certbot
#
#  Usage (on a fresh Ubuntu 22.04/24.04 VPS, as root):
#    curl -fsSL https://raw.githubusercontent.com/snsbd247/audit-treasure-6d69be20/main/deploy/vps/quick-install.sh -o /tmp/qi.sh \
#      && chmod +x /tmp/qi.sh && sudo /tmp/qi.sh
#
#  Env overrides (optional):
#    DOMAIN=erp.irlbd.com  ADMIN_EMAIL=admin@irlbd.com
#    DB_NAME=smarterp  DB_USER=smarterp  DB_PASS='StrongPass@2026'
#    APP_DIR=/opt/smarterp  REPO_URL=https://github.com/snsbd247/audit-treasure-6d69be20.git
#    SKIP_SSL=1   # skip certbot (e.g. if DNS not ready yet)
# ============================================================
set -euo pipefail

DOMAIN="${DOMAIN:-erp.irlbd.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@irlbd.com}"
REPO_URL="${REPO_URL:-https://github.com/snsbd247/audit-treasure-6d69be20.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/smarterp}"
DB_NAME="${DB_NAME:-smarterp}"
DB_USER="${DB_USER:-smarterp}"
DB_PASS="${DB_PASS:-StrongPass@2026}"
PHP_VERSION="${PHP_VERSION:-8.2}"
SKIP_SSL="${SKIP_SSL:-0}"
CRED_FILE="/root/smarterp-credentials.txt"

C_G='\033[0;32m'; C_Y='\033[1;33m'; C_R='\033[0;31m'; C_N='\033[0m'
log()  { echo -e "${C_G}[$(date +%H:%M:%S)]${C_N} $*"; }
warn() { echo -e "${C_Y}[WARN]${C_N} $*"; }
err()  { echo -e "${C_R}[ERR ]${C_N} $*" >&2; }

[[ $EUID -eq 0 ]] || { err "Run as root (sudo)"; exit 1; }

BASE_RAW="https://raw.githubusercontent.com/snsbd247/audit-treasure-6d69be20/${REPO_BRANCH}/deploy/vps"

# ---------------- 1. Base setup ----------------
log "Step 1/6  Base setup (Nginx + PHP ${PHP_VERSION} + MySQL + Node)..."
curl -fsSL "${BASE_RAW}/setup.sh" -o /tmp/setup.sh
chmod +x /tmp/setup.sh
/tmp/setup.sh

# ---------------- 2. MySQL DB ------------------
log "Step 2/6  Creating MySQL database '${DB_NAME}' and user '${DB_USER}'..."
mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER  USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# ---------------- 3. Clone + build -------------
log "Step 3/6  Cloning repo and building frontend/backend..."
curl -fsSL "${BASE_RAW}/clone.sh" -o /tmp/clone.sh
chmod +x /tmp/clone.sh
REPO_URL="${REPO_URL}" REPO_BRANCH="${REPO_BRANCH}" APP_DIR="${APP_DIR}" \
  VITE_API_BASE_URL="https://${DOMAIN}/api" \
  /tmp/clone.sh

# ---------------- 4. .env + migrate ------------
log "Step 4/6  Writing .env, key:generate, migrate --seed..."
ENV_FILE="${APP_DIR}/backend/.env"
cat > "${ENV_FILE}" <<EOF
APP_NAME=SmartERP
APP_ENV=production
APP_DEBUG=false
APP_URL=https://${DOMAIN}
APP_KEY=

LOG_CHANNEL=single
LOG_LEVEL=warning

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=${DB_NAME}
DB_USERNAME=${DB_USER}
DB_PASSWORD="${DB_PASS}"

# Token-only API mode. Do not enable Sanctum stateful/session cookies here;
# same-origin browser requests otherwise get routed through session middleware.
SANCTUM_STATEFUL_DOMAINS=
SESSION_DOMAIN=
CORS_ALLOWED_ORIGINS=https://${DOMAIN}

CACHE_DRIVER=file
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120
FILESYSTEM_DISK=public
EOF

cd "${APP_DIR}/backend"
mkdir -p storage/app/public storage/app/backups storage/framework/cache/data \
         storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
chown -R www-data:www-data storage bootstrap/cache
chmod -R 775 storage bootstrap/cache
php artisan key:generate --force
# Fresh install -> seed; if already migrated, just migrate.
if php artisan migrate:status >/dev/null 2>&1 && \
   php artisan migrate:status 2>/dev/null | grep -q "Ran"; then
  log "Existing migrations detected -> running migrate only (no seed)"
  php artisan migrate --force
else
  log "Fresh database -> running migrate --seed"
  php artisan migrate --seed --force
fi
php artisan storage:link --force >/dev/null 2>&1 || true
MYSQL_PWD="${DB_PASS}" mysql -h 127.0.0.1 -u "${DB_USER}" "${DB_NAME}" <<SQL
INSERT INTO system_settings (setting_key, setting_value, is_encrypted, created_at, updated_at)
VALUES ('setup_completed', 'true', 0, NOW(), NOW())
ON DUPLICATE KEY UPDATE setting_value = 'true', updated_at = NOW();
SQL
touch storage/installed
php artisan config:cache
php artisan route:cache || true
chown -R www-data:www-data "${APP_DIR}/backend/storage" \
                            "${APP_DIR}/backend/bootstrap/cache" \
                            "${APP_DIR}/backend/public"

# ---------------- 5. Nginx ---------------------
log "Step 5/6  Configuring Nginx vhost for ${DOMAIN}..."
cat > /etc/nginx/sites-available/smarterp <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    root ${APP_DIR}/backend/public;
    index index.php index.html;

    client_max_body_size 64M;
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }


    location ~ \.php\$ {
        fastcgi_pass unix:/var/run/php/php${PHP_VERSION}-fpm.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME \$realpath_root\$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 300;
    }

    location ~ /\.(?!well-known).* { deny all; }
}
NGINX
ln -sf /etc/nginx/sites-available/smarterp /etc/nginx/sites-enabled/smarterp
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ---------------- 5b. Deploy runner (Pull & Deploy button) -------
log "Installing /usr/local/bin/smarterp-deploy and sudoers entry..."
install -m 0755 -o root -g root "${APP_DIR}/deploy/vps/deploy-runner.sh" /usr/local/bin/smarterp-deploy
# Ensure APP_DIR is baked in so sudo (which strips env) still works.
sed -i "s|^APP_DIR=.*|APP_DIR=\"${APP_DIR}\"|" /usr/local/bin/smarterp-deploy
touch /var/log/smarterp-deploy.log
touch /var/log/smarterp-deploy.state
chown www-data:www-data /var/log/smarterp-deploy.log /var/log/smarterp-deploy.state
chmod 0664 /var/log/smarterp-deploy.log /var/log/smarterp-deploy.state
cat > /etc/sudoers.d/smarterp-deploy <<SUDO
www-data ALL=(root) NOPASSWD: /usr/local/bin/smarterp-deploy
Defaults!/usr/local/bin/smarterp-deploy !requiretty
SUDO
chmod 0440 /etc/sudoers.d/smarterp-deploy
visudo -cf /etc/sudoers.d/smarterp-deploy >/dev/null
sudo -u www-data sudo -n /usr/local/bin/smarterp-deploy --check >/dev/null


# ---------------- 6. SSL -----------------------
if [[ "${SKIP_SSL}" == "1" ]]; then
  warn "Step 6/6  SSL skipped (SKIP_SSL=1). Run later: certbot --nginx -d ${DOMAIN}"
else
  log "Step 6/6  Requesting SSL certificate from Let's Encrypt..."
  apt-get install -y certbot python3-certbot-nginx
  SERVER_IP="$(curl -fsS https://api.ipify.org || echo '')"
  RESOLVED="$(getent hosts "${DOMAIN}" | awk '{print $1}' | head -n1 || true)"
  if [[ -n "${SERVER_IP}" && -n "${RESOLVED}" && "${SERVER_IP}" != "${RESOLVED}" ]]; then
    warn "DNS for ${DOMAIN} -> ${RESOLVED}, but this server is ${SERVER_IP}."
    warn "Fix DNS A-record then run:  certbot --nginx -d ${DOMAIN}"
  else
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
      -m "${ADMIN_EMAIL}" --redirect \
      || warn "certbot failed — fix DNS, then: certbot --nginx -d ${DOMAIN}"
  fi
fi

# ---------------- Summary ----------------------
cat > "${CRED_FILE}" <<EOF
=========================================================
 SmartERP — Installation Summary  ($(date))
=========================================================
 URL          : https://${DOMAIN}
 App path     : ${APP_DIR}
 Backend path : ${APP_DIR}/backend
 DB name      : ${DB_NAME}
 DB user      : ${DB_USER}
 DB password  : ${DB_PASS}
 Admin login  : admin / Admin@123  (change after first login)
=========================================================
 Update later :  sudo APP_DIR=${APP_DIR} ${APP_DIR}/deploy/vps/update.sh
=========================================================
EOF
chmod 600 "${CRED_FILE}"

echo
log "✅ All done!  Open:  https://${DOMAIN}"
echo
cat "${CRED_FILE}"
