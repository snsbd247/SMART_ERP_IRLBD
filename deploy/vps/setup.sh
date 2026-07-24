#!/usr/bin/env bash
# ============================================================
#  SmartERP — VPS Setup (Step 1)  [idempotent / safe to re-run]
#  Installs base packages required to run the ERP stack:
#    Nginx, PHP 8.2 (+extensions), MySQL, Node 20, Composer, Git
#  Tested on: Ubuntu 22.04 / 24.04 LTS
# ============================================================
#  Usage:
#     curl -fsSL https://raw.githubusercontent.com/snsbd247/audit-treasure-6d69be20/main/deploy/vps/setup.sh -o setup.sh
#     chmod +x setup.sh && sudo ./setup.sh
#
#  Env overrides:
#     PHP_VERSION=8.2  NODE_MAJOR=20  TIMEZONE=Asia/Dhaka
# ============================================================
set -euo pipefail

PHP_VERSION="${PHP_VERSION:-8.2}"
NODE_MAJOR="${NODE_MAJOR:-20}"
TIMEZONE="${TIMEZONE:-Asia/Dhaka}"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_NC='\033[0m'
log()  { echo -e "${C_GREEN}[$(date +%H:%M:%S)]${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_NC} $*"; }
err()  { echo -e "${C_RED}[ERR ]${C_NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root (sudo ./setup.sh)"; exit 1; fi
if ! grep -qiE 'ubuntu|debian' /etc/os-release; then
  warn "Non-Ubuntu/Debian detected. Continuing, but YMMV."
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a   # auto-restart services without prompting

log "Setting timezone to ${TIMEZONE}..."
timedatectl set-timezone "${TIMEZONE}" || true

log "Updating apt index and installing prerequisites..."
apt-get update -y
apt-get install -y software-properties-common ca-certificates curl gnupg lsb-release \
  apt-transport-https unzip zip git ufw nginx mysql-server cron rsync \
  build-essential

# -------- PHP --------
if ! dpkg -l | grep -q "php${PHP_VERSION}-fpm"; then
  log "Adding PHP PPA (ondrej/php)..."
  add-apt-repository -y ppa:ondrej/php
  apt-get update -y
fi

log "Installing PHP ${PHP_VERSION} and extensions..."
apt-get install -y \
  php${PHP_VERSION} php${PHP_VERSION}-fpm php${PHP_VERSION}-cli \
  php${PHP_VERSION}-mysql php${PHP_VERSION}-mbstring php${PHP_VERSION}-xml \
  php${PHP_VERSION}-curl php${PHP_VERSION}-zip php${PHP_VERSION}-gd \
  php${PHP_VERSION}-bcmath php${PHP_VERSION}-intl php${PHP_VERSION}-redis \
  php${PHP_VERSION}-soap php${PHP_VERSION}-imagick

# Tune PHP for ERP workloads (uploads, long runs)
PHP_INI="/etc/php/${PHP_VERSION}/fpm/php.ini"
if [[ -f "${PHP_INI}" ]]; then
  log "Tuning ${PHP_INI} (upload/memory/time limits)..."
  sed -ri 's|^;?upload_max_filesize\s*=.*|upload_max_filesize = 64M|' "${PHP_INI}"
  sed -ri 's|^;?post_max_size\s*=.*|post_max_size = 64M|'             "${PHP_INI}"
  sed -ri 's|^;?memory_limit\s*=.*|memory_limit = 512M|'              "${PHP_INI}"
  sed -ri 's|^;?max_execution_time\s*=.*|max_execution_time = 300|'   "${PHP_INI}"
  sed -ri 's|^;?max_input_vars\s*=.*|max_input_vars = 5000|'          "${PHP_INI}"
fi

# -------- Composer --------
if ! command -v composer >/dev/null 2>&1; then
  log "Installing Composer..."
  EXPECTED_SIG="$(curl -sS https://composer.github.io/installer.sig)"
  curl -sS https://getcomposer.org/installer -o /tmp/composer-setup.php
  ACTUAL_SIG="$(php -r "echo hash_file('sha384','/tmp/composer-setup.php');")"
  if [[ "${EXPECTED_SIG}" != "${ACTUAL_SIG}" ]]; then
    err "Composer installer checksum mismatch"; rm -f /tmp/composer-setup.php; exit 1
  fi
  php /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer --quiet
  rm -f /tmp/composer-setup.php
else
  log "Composer already installed ($(composer --version --no-ansi 2>/dev/null | head -1))"
fi

# -------- Node --------
CUR_NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  CUR_NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
fi
if [[ "${CUR_NODE_MAJOR}" -lt "${NODE_MAJOR}" ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  log "Node.js $(node -v) already installed"
fi

# -------- MySQL secure defaults --------
log "Ensuring MySQL is enabled..."
systemctl enable --now mysql

# -------- Firewall --------
log "Configuring UFW firewall (22 / 80 / 443)..."
ufw allow OpenSSH       >/dev/null 2>&1 || true
ufw allow 'Nginx Full'  >/dev/null 2>&1 || true
ufw --force enable      >/dev/null 2>&1 || true

# -------- Services --------
log "Enabling & starting services..."
systemctl enable --now nginx mysql "php${PHP_VERSION}-fpm"

# -------- Directories --------
log "Preparing /var/backups/smarterp ..."
mkdir -p /var/backups/smarterp
chmod 750 /var/backups/smarterp

log "Base VPS setup complete. Next: run ./clone.sh"
log "Versions: PHP $(php -r 'echo PHP_VERSION;') | Node $(node -v) | Composer $(composer --version --no-ansi 2>/dev/null | awk '{print $3}')"
