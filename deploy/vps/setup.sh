#!/usr/bin/env bash
# ============================================================
#  SmartERP — VPS Setup (Step 1)
#  Installs base system packages required to run the ERP stack:
#    Nginx, PHP 8.2 (+extensions), MySQL, Node 20, Composer, Git
#  Tested on: Ubuntu 22.04 / 24.04 LTS
# ============================================================
#  Usage:
#     curl -fsSL https://raw.githubusercontent.com/snsbd247/audit-treasure-6d69be20/main/deploy/vps/setup.sh -o setup.sh
#     chmod +x setup.sh && sudo ./setup.sh
# ============================================================
set -euo pipefail

PHP_VERSION="${PHP_VERSION:-8.2}"
NODE_MAJOR="${NODE_MAJOR:-20}"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_NC='\033[0m'
log()  { echo -e "${C_GREEN}[$(date +%H:%M:%S)]${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_NC} $*"; }
err()  { echo -e "${C_RED}[ERR ]${C_NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then err "Run as root (sudo ./setup.sh)"; exit 1; fi

log "Updating apt and installing prerequisites..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y software-properties-common ca-certificates curl gnupg lsb-release \
  unzip zip git ufw nginx mysql-server

log "Adding PHP PPA (ondrej/php)..."
add-apt-repository -y ppa:ondrej/php
apt-get update -y

log "Installing PHP ${PHP_VERSION} and extensions..."
apt-get install -y \
  php${PHP_VERSION} php${PHP_VERSION}-fpm php${PHP_VERSION}-cli \
  php${PHP_VERSION}-mysql php${PHP_VERSION}-mbstring php${PHP_VERSION}-xml \
  php${PHP_VERSION}-curl php${PHP_VERSION}-zip php${PHP_VERSION}-gd \
  php${PHP_VERSION}-bcmath php${PHP_VERSION}-intl php${PHP_VERSION}-redis

log "Installing Composer..."
if ! command -v composer >/dev/null 2>&1; then
  curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
fi

log "Installing Node.js ${NODE_MAJOR}.x..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "${NODE_MAJOR}" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi

log "Configuring UFW firewall (22/80/443)..."
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
yes | ufw enable || true

log "Enabling services..."
systemctl enable --now nginx mysql php${PHP_VERSION}-fpm

log "Base VPS setup complete. Next: run ./clone.sh"
