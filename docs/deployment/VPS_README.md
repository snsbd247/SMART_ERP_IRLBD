# SmartERP — VPS deployment (Ubuntu)

Self-hosted production deployment: **Laravel API + MySQL + React** behind Nginx on your own VPS.
The frontend talks only to the same-origin Laravel API (`/api`).

> The live site `erp.irlbd.com` currently runs on cPanel — see [CPANEL_DEPLOYMENT.md](CPANEL_DEPLOYMENT.md).
> These scripts are for a dedicated Ubuntu VPS.

## Quick start

On a fresh **Ubuntu 22.04 / 24.04** VPS as `root`:

```bash
curl -fsSL https://raw.githubusercontent.com/snsbd247/audit-treasure-6d69be20/main/deploy/vps/quick-install.sh -o /tmp/qi.sh
chmod +x /tmp/qi.sh
sudo DOMAIN=erp.irlbd.com /tmp/qi.sh
```

DNS: an A record for the domain (and `www.`) pointing to the VPS IP.

## What it installs

- Nginx, PHP 8.2-fpm, MySQL 8, Node 20, Composer, Certbot (Let's Encrypt SSL)
- Clones the repo to `/opt/smarterp`, builds `frontend/`, publishes it into `backend/public`
- Creates the MySQL DB, writes `backend/.env`, runs migrations + seeders
- Nginx vhost with document root `/opt/smarterp/backend/public`

## Updating an existing VPS

```bash
sudo APP_DIR=/opt/smarterp /opt/smarterp/deploy/vps/update.sh
```

`update.sh` backs up the DB, pulls `main`, runs migrations, rebuilds the frontend and reloads services.
On a VPS installed before the `erp-backend/` → `backend/` rename, the first run migrates `.env`, `vendor/`
and `storage/` into `backend/`, repoints nginx / supervisor / cron (backups kept in the backup dir,
nginx config restored automatically if `nginx -t` fails) and keeps the old folder as `erp-backend.migrated-*`.

## Files (`deploy/vps/`)

- `quick-install.sh` — one-command installer (runs `setup.sh` + `clone.sh` steps)
- `setup.sh` — base packages · `clone.sh` — clone + build
- `update.sh` — deploy update · `rollback.sh` — roll back to a previous SHA · `deploy-runner.sh` — Pull & Deploy wrapper
- Bangla guide: [SETUP_GUIDE_BN.md](SETUP_GUIDE_BN.md)
