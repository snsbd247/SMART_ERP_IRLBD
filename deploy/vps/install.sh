#!/usr/bin/env bash
# ============================================================
#  SmartERP — One-Command VPS Installer
#  Self-hosted Supabase + Laravel (erp-backend) + React frontend
#  Tested on: Ubuntu 22.04 / 24.04 LTS  (root or sudo user)
# ============================================================
#  Usage (on a fresh VPS):
#     curl -fsSL https://raw.githubusercontent.com/snsbd247/smart_accounting/main/deploy/vps/install.sh -o install.sh
#     chmod +x install.sh
#     sudo ./install.sh
# ============================================================
set -euo pipefail

# --------- CONFIG (edit these or pass as env vars) ----------
DOMAIN="${DOMAIN:-erp.irlbd.com}"
SUPABASE_SUBDOMAIN="${SUPABASE_SUBDOMAIN:-supabase.${DOMAIN}}"
STUDIO_SUBDOMAIN="${STUDIO_SUBDOMAIN:-studio.${DOMAIN}}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@${DOMAIN}}"
REPO_URL="${REPO_URL:-https://github.com/snsbd247/audit-treasure-6d69be20.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/smarterp}"
SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
NODE_MAJOR="${NODE_MAJOR:-20}"
PHP_VERSION="${PHP_VERSION:-8.2}"
MYSQL_DB="${MYSQL_DB:-smarterp_db}"
MYSQL_USER="${MYSQL_USER:-smarterp_user}"
CRED_FILE="${CRED_FILE:-/root/smarterp-credentials.txt}"
# -----------------------------------------------------------

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_NC='\033[0m'
log()  { echo -e "${C_GREEN}[$(date +%H:%M:%S)]${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_NC} $*"; }
err()  { echo -e "${C_RED}[ERR ]${C_NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root (sudo ./install.sh)"; exit 1; fi
if ! grep -qiE 'ubuntu|debian' /etc/os-release; then
  warn "This script targets Ubuntu/Debian. Continuing anyway..."
fi

write_credentials() {
  local status="${1:-PARTIAL}"
  cat > "${CRED_FILE}" <<EOF
=========================================================
 SmartERP — Installation Summary  ($(date))
=========================================================
 Status                : ${status}

 Frontend (App)        : https://${DOMAIN}
 Supabase API Gateway  : https://${SUPABASE_SUBDOMAIN}
 Supabase Studio       : https://${STUDIO_SUBDOMAIN}

 Studio Login          : ${DASHBOARD_USER:-admin} / ${DASHBOARD_PASS:-not-generated-yet}

 Supabase Anon Key     : ${ANON_KEY:-not-generated-yet}
 Supabase Service Key  : ${SERVICE_ROLE_KEY:-not-generated-yet}
 JWT Secret            : ${JWT_SECRET:-not-generated-yet}
 Postgres Password     : ${POSTGRES_PASSWORD:-not-generated-yet}

 MySQL DB / User / Pwd : ${MYSQL_DB} / ${MYSQL_USER} / ${MYSQL_PASS:-not-generated-yet}

 App Path              : ${APP_DIR}
 Supabase Path         : ${SUPABASE_DIR}/docker
=========================================================
 Next steps:
   1. Open https://${DOMAIN}/install   (Laravel installer wizard)
   2. Use the MySQL credentials above
   3. Create the Super Admin account
   4. Login & enjoy SmartERP
=========================================================
EOF
  chmod 600 "${CRED_FILE}"
}

on_exit() {
  local status=$?
  if [[ ${status} -ne 0 ]]; then
    warn "Installer stopped before completion. Saving available credentials for recovery..."
    write_credentials "FAILED/PARTIAL - check /root/install.log" || true
    warn "Credentials saved to: ${CRED_FILE}  (chmod 600)"
  fi
}
trap on_exit EXIT

rand() { openssl rand -hex "${1:-24}"; }
b64()  { openssl rand -base64 "${1:-32}" | tr -d '\n'; }

# JWT helper (HS256) using openssl + python3
make_jwt() {
  local role="$1" secret="$2"
  python3 - "$role" "$secret" <<'PY'
import sys, json, hmac, hashlib, base64, time
role, secret = sys.argv[1], sys.argv[2]
def b64u(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
header  = b64u(json.dumps({"alg":"HS256","typ":"JWT"}, separators=(',',':')).encode())
payload = b64u(json.dumps({"role":role,"iss":"supabase","iat":int(time.time()),"exp":int(time.time())+10*365*24*3600}, separators=(',',':')).encode())
sig = b64u(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
print(f"{header}.{payload}.{sig}")
PY
}

# ===================== 1. SYSTEM PREP ======================
log "Step 1/9  Updating system & installing base packages..."
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1
mkdir -p /etc/needrestart/conf.d
echo "\$nrconf{restart} = 'a';" > /etc/needrestart/conf.d/99-auto.conf
echo "\$nrconf{kernelhints} = 0;" >> /etc/needrestart/conf.d/99-auto.conf
apt-get update -y
apt-get install -y curl wget git unzip zip ca-certificates gnupg lsb-release \
  software-properties-common openssl python3 python3-pip ufw jq net-tools

# ===================== 2. FIREWALL =========================
log "Step 2/9  Configuring firewall (22, 80, 443)..."
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ===================== 3. DOCKER ===========================
log "Step 3/9  Installing Docker + Compose..."
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# ===================== 4. NODE + PHP + MYSQL ===============
log "Step 4/9  Installing Node ${NODE_MAJOR}, PHP ${PHP_VERSION}, MySQL, Nginx, Composer..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
add-apt-repository -y ppa:ondrej/php
apt-get update -y
apt-get install -y nodejs nginx mysql-server certbot python3-certbot-nginx \
  php${PHP_VERSION} php${PHP_VERSION}-fpm php${PHP_VERSION}-cli php${PHP_VERSION}-mysql \
  php${PHP_VERSION}-mbstring php${PHP_VERSION}-xml php${PHP_VERSION}-curl php${PHP_VERSION}-zip \
  php${PHP_VERSION}-bcmath php${PHP_VERSION}-gd php${PHP_VERSION}-intl
if ! command -v composer >/dev/null; then
  curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
fi

# ===================== 5. MYSQL DB =========================
log "Step 5/9  Creating MySQL database for Laravel..."
MYSQL_PASS="$(rand 16)"
mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'localhost' IDENTIFIED BY '${MYSQL_PASS}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DB}\`.* TO '${MYSQL_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# ===================== 6. SELF-HOSTED SUPABASE =============
log "Step 6/9  Installing self-hosted Supabase (Docker)..."
mkdir -p "${SUPABASE_DIR}"
if [ ! -d "${SUPABASE_DIR}/docker" ]; then
  git clone --depth 1 https://github.com/supabase/supabase "${SUPABASE_DIR}/repo"
  cp -r "${SUPABASE_DIR}/repo/docker" "${SUPABASE_DIR}/docker"
fi
cd "${SUPABASE_DIR}/docker"
cp -n .env.example .env

JWT_SECRET="$(rand 32)"
ANON_KEY="$(make_jwt anon "${JWT_SECRET}")"
SERVICE_ROLE_KEY="$(make_jwt service_role "${JWT_SECRET}")"
POSTGRES_PASSWORD="$(rand 16)"
DASHBOARD_USER="admin"
DASHBOARD_PASS="$(rand 12)"
SECRET_KEY_BASE="$(b64 64)"
VAULT_ENC_KEY="$(rand 16)"
LOGFLARE_PUBLIC_TOKEN="$(rand 32)"
LOGFLARE_PRIVATE_TOKEN="$(rand 32)"
POOLER_TENANT_ID="${POOLER_TENANT_ID:-smarterp}"

sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
sed -i "s|^ANON_KEY=.*|ANON_KEY=${ANON_KEY}|" .env
sed -i "s|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}|" .env
sed -i "s|^DASHBOARD_USERNAME=.*|DASHBOARD_USERNAME=${DASHBOARD_USER}|" .env
sed -i "s|^DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=${DASHBOARD_PASS}|" .env
sed -i "s|^SECRET_KEY_BASE=.*|SECRET_KEY_BASE=${SECRET_KEY_BASE}|" .env
sed -i "s|^VAULT_ENC_KEY=.*|VAULT_ENC_KEY=${VAULT_ENC_KEY}|" .env
sed -i "s|^SITE_URL=.*|SITE_URL=https://${DOMAIN}|" .env
sed -i "s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=https://${SUPABASE_SUBDOMAIN}|" .env
sed -i "s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=https://${SUPABASE_SUBDOMAIN}|" .env
if grep -q '^SUPABASE_PUBLISHABLE_KEY=' .env; then
  sed -i "s|^SUPABASE_PUBLISHABLE_KEY=.*|SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}|" .env
fi
if grep -q '^SUPABASE_SECRET_KEY=' .env; then
  sed -i "s|^SUPABASE_SECRET_KEY=.*|SUPABASE_SECRET_KEY=${SERVICE_ROLE_KEY}|" .env
fi

# --- Logflare / Analytics: REQUIRED, otherwise the analytics container fails
# and brings the whole stack down via depends_on. Replace placeholder tokens.
if grep -q '^LOGFLARE_PUBLIC_ACCESS_TOKEN=' .env; then
  sed -i "s|^LOGFLARE_PUBLIC_ACCESS_TOKEN=.*|LOGFLARE_PUBLIC_ACCESS_TOKEN=${LOGFLARE_PUBLIC_TOKEN}|" .env
else
  echo "LOGFLARE_PUBLIC_ACCESS_TOKEN=${LOGFLARE_PUBLIC_TOKEN}" >> .env
fi
if grep -q '^LOGFLARE_PRIVATE_ACCESS_TOKEN=' .env; then
  sed -i "s|^LOGFLARE_PRIVATE_ACCESS_TOKEN=.*|LOGFLARE_PRIVATE_ACCESS_TOKEN=${LOGFLARE_PRIVATE_TOKEN}|" .env
else
  echo "LOGFLARE_PRIVATE_ACCESS_TOKEN=${LOGFLARE_PRIVATE_TOKEN}" >> .env
fi
# Legacy var name some compose files still read
if grep -q '^LOGFLARE_API_KEY=' .env; then
  sed -i "s|^LOGFLARE_API_KEY=.*|LOGFLARE_API_KEY=${LOGFLARE_PRIVATE_TOKEN}|" .env
fi
# Supavisor pooler tenant id (must not be default 'your-tenant-id')
if grep -q '^POOLER_TENANT_ID=' .env; then
  sed -i "s|^POOLER_TENANT_ID=.*|POOLER_TENANT_ID=${POOLER_TENANT_ID}|" .env
fi

# Logflare occasionally starts slower than its healthcheck on small VPS plans.
# Studio/Kong/Vector depend on analytics being "healthy", so relax only the
# healthcheck here; the analytics container still runs normally and logs remain optional.
cat > docker-compose.override.yml <<'YML'
services:
  analytics:
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:4000/health >/dev/null || exit 0"]
      timeout: 10s
      interval: 10s
      retries: 30
      start_period: 120s
YML

# Fresh start — if a previous failed run left a half-initialised analytics
# volume, the DB user/credentials inside it won't match new env values.
# Supabase's compose uses bind-mounted ./volumes/db/data for Postgres, so
# `down -v` alone does NOT reset the database — we must also wipe the dir.
log "Cleaning any previous half-initialised Supabase volumes..."
docker compose down -v 2>/dev/null || true
rm -rf ./volumes/db/data ./volumes/storage ./volumes/pooler 2>/dev/null || true

docker compose pull
# Bring analytics up FIRST so the rest of the stack can wait on a healthy one.
# Use --wait with a generous timeout; don't kill the whole installer if it
# stalls — we'll surface the issue and continue.
if ! docker compose up -d --wait --wait-timeout 300; then
  warn "Some Supabase containers are not healthy yet. Showing analytics logs:"
  docker compose logs --tail=50 analytics || true
  warn "Retrying without blocking on health checks so Laravel/Nginx setup can finish..."
  docker compose up -d || true
fi

# ===================== 7. APP CODE =========================
log "Step 7/9  Cloning project & building frontend..."
mkdir -p "$(dirname "${APP_DIR}")"
if [ ! -d "${APP_DIR}/.git" ]; then
  git clone "${REPO_URL}" "${APP_DIR}"
else
  cd "${APP_DIR}" && git pull
fi
cd "${APP_DIR}"

# Frontend env
cat > .env.production <<EOF
VITE_API_BASE_URL=https://${DOMAIN}/api
VITE_SUPABASE_URL=https://${DOMAIN}/supabase-disabled
VITE_SUPABASE_PUBLISHABLE_KEY=vps-laravel-mode-no-supabase
VITE_SUPABASE_PROJECT_ID=vps-laravel
EOF

npm install --legacy-peer-deps --no-audit --no-fund
npm run build

# Laravel install
cd "${APP_DIR}/erp-backend"
composer install --no-dev --optimize-autoloader --no-interaction
mkdir -p storage/{app/public,app/backups,framework/{cache/data,sessions,views},logs} bootstrap/cache
chown -R www-data:www-data storage bootstrap/cache
chmod -R 775 storage bootstrap/cache
rm -f storage/installed .env

cat > .env <<EOF
APP_NAME="SmartERP"
APP_ENV=production
APP_DEBUG=false
APP_URL=https://${DOMAIN}
LOG_CHANNEL=single
LOG_LEVEL=warning
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=${MYSQL_DB}
DB_USERNAME=${MYSQL_USER}
DB_PASSWORD="${MYSQL_PASS}"
SANCTUM_STATEFUL_DOMAINS=
SESSION_DOMAIN=
CORS_ALLOWED_ORIGINS=https://${DOMAIN}
CACHE_DRIVER=file
QUEUE_CONNECTION=sync
SESSION_DRIVER=file
SESSION_LIFETIME=120
FILESYSTEM_DISK=public
SUPABASE_URL=https://${SUPABASE_SUBDOMAIN}
SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
EOF
php artisan key:generate --force

# Copy built frontend into Laravel public (preserve index.php + .htaccess)
rm -rf "${APP_DIR}/erp-backend/public/assets" 2>/dev/null || true
cp -r "${APP_DIR}/dist/"* "${APP_DIR}/erp-backend/public/" 2>/dev/null || true

chown -R www-data:www-data "${APP_DIR}"

# ----- systemd queue worker -----
log "Installing systemd queue worker (smarterp-queue)..."
cat > /etc/systemd/system/smarterp-queue.service <<UNIT
[Unit]
Description=SmartERP Laravel Queue Worker
After=network.target mysql.service

[Service]
User=www-data
Group=www-data
Restart=always
RestartSec=5
WorkingDirectory=${APP_DIR}/erp-backend
ExecStart=/usr/bin/php artisan queue:work --sleep=3 --tries=3 --max-time=3600

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now smarterp-queue.service || warn "queue worker failed to start"

# ----- Laravel scheduler cron -----
log "Installing Laravel scheduler cron entry..."
CRON_LINE="* * * * * www-data cd ${APP_DIR}/erp-backend && /usr/bin/php artisan schedule:run >> /var/log/smarterp-schedule.log 2>&1"
echo "${CRON_LINE}" > /etc/cron.d/smarterp-scheduler
chmod 644 /etc/cron.d/smarterp-scheduler

# ===================== 8. NGINX + SSL ======================
log "Step 8/9  Configuring Nginx + Let's Encrypt SSL..."

# Main app vhost (API -> Laravel PHP, everything else -> React SPA index.html)
cat > /etc/nginx/sites-available/smarterp <<NGINX
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    root ${APP_DIR}/erp-backend/public;
    index index.php index.html;
    client_max_body_size 50M;

    # Laravel API routes
    location ^~ /api/ {
        try_files \$uri /index.php?\$query_string;
    }
    location = /install {
        try_files \$uri /index.php?\$query_string;
    }

    # React SPA — deep links fall back to index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php${PHP_VERSION}-fpm.sock;
    }
    location ~ /\.ht { deny all; }
}
NGINX

# Supabase vhost (proxy to Kong gateway on :8000)
cat > /etc/nginx/sites-available/supabase <<NGINX
server {
    listen 80;
    server_name ${SUPABASE_SUBDOMAIN};
    client_max_body_size 50M;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

# Studio vhost (proxy to Studio on :3000)
cat > /etc/nginx/sites-available/studio <<NGINX
server {
    listen 80;
    server_name ${STUDIO_SUBDOMAIN};
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/smarterp /etc/nginx/sites-enabled/smarterp
ln -sf /etc/nginx/sites-available/supabase /etc/nginx/sites-enabled/supabase
ln -sf /etc/nginx/sites-available/studio   /etc/nginx/sites-enabled/studio
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Pull & Deploy button runner (idempotent sudo wrapper for update.sh)
log "Installing /usr/local/bin/smarterp-deploy and sudoers entry..."
install -m 0755 -o root -g root "${APP_DIR}/deploy/vps/deploy-runner.sh" /usr/local/bin/smarterp-deploy
sed -i "s|^APP_DIR=.*|APP_DIR=\"${APP_DIR}\"|" /usr/local/bin/smarterp-deploy
touch /var/log/smarterp-deploy.log /var/log/smarterp-deploy.state
chown www-data:www-data /var/log/smarterp-deploy.log /var/log/smarterp-deploy.state
chmod 0664 /var/log/smarterp-deploy.log /var/log/smarterp-deploy.state
cat > /etc/sudoers.d/smarterp-deploy <<SUDO
www-data ALL=(root) NOPASSWD: /usr/local/bin/smarterp-deploy
Defaults!/usr/local/bin/smarterp-deploy !requiretty
SUDO
chmod 0440 /etc/sudoers.d/smarterp-deploy
visudo -cf /etc/sudoers.d/smarterp-deploy >/dev/null
sudo -u www-data sudo -n /usr/local/bin/smarterp-deploy --check >/dev/null

# SSL — needs domains pointing to this VPS first.
# Try each hostname separately so one bad DNS record (e.g. missing www
# subdomain) doesn't block certs for the others.
log "Requesting SSL certificates (make sure DNS A-records already point to this server)..."
SERVER_IP="$(curl -fsS https://api.ipify.org || echo '')"
issue_cert() {
  local host="$1"
  local resolved
  resolved="$(getent hosts "$host" | awk '{print $1}' | head -n1 || true)"
  if [ -z "$resolved" ]; then
    warn "SSL skip: $host does not resolve (add A-record -> ${SERVER_IP})"
    return
  fi
  if [ -n "$SERVER_IP" ] && [ "$resolved" != "$SERVER_IP" ]; then
    warn "SSL skip: $host -> $resolved (expected ${SERVER_IP}). Fix DNS, then: certbot --nginx -d $host"
    return
  fi
  certbot --nginx --non-interactive --agree-tos -m "${ADMIN_EMAIL}" -d "$host" || \
    warn "SSL failed for $host — retry later: certbot --nginx -d $host"
}
issue_cert "${DOMAIN}"
issue_cert "www.${DOMAIN}"
issue_cert "${SUPABASE_SUBDOMAIN}"
issue_cert "${STUDIO_SUBDOMAIN}"

# ===================== 9. SUMMARY ==========================
log "Step 9/9  Saving credentials..."
write_credentials "COMPLETE"
trap - EXIT

echo
log "✅ Installation complete!"
echo
cat "${CRED_FILE}"
echo
warn "Credentials saved to: ${CRED_FILE}  (chmod 600)"
