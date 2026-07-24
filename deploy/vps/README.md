# SmartERP — VPS One-Command Installer

Self-hosted production deployment: **Laravel API + MySQL + React** behind Nginx on your own VPS.
The frontend talks only to the same-origin Laravel API (`/api`) — there is no Supabase/Cloud dependency in the app itself.

If an older VPS deploy shows `POST /api/auth/login 500` in the browser, run:

```bash
sudo APP_DIR=/opt/smarterp /opt/smarterp/deploy/vps/update.sh
```

## Quick start

On a fresh **Ubuntu 22.04 / 24.04** VPS as `root`:

```bash
curl -fsSL https://raw.githubusercontent.com/snsbd247/audit-treasure/main/deploy/vps/install.sh -o install.sh
chmod +x install.sh
DOMAIN=erp.irlbd.com ADMIN_EMAIL=you@erp.irlbd.com ./install.sh
```

## Required DNS (A records → your VPS IP)

| Host | Purpose |
|---|---|
| `erp.irlbd.com` | Main app |
| `www.erp.irlbd.com` | Redirect / app |
| `supabase.erp.irlbd.com` | Supabase API gateway (Kong) |
| `studio.erp.irlbd.com` | Supabase Studio (admin) |

## What it installs

- Docker + self-hosted Supabase stack (Postgres, GoTrue, PostgREST, Realtime, Storage, Studio, Kong)
- Node 20, PHP 8.2-fpm, MySQL 8, Nginx, Certbot (Let's Encrypt SSL)
- Clones the repo, builds the React frontend, configures Laravel API
- Creates the MySQL DB and writes all `.env` files
- Generates JWT secret + ANON / SERVICE_ROLE keys for Supabase
- Saves all credentials to `/root/smarterp-credentials.txt`

## Files

- `install.sh` — the installer (one command)
- `../../docs/VPS_Setup_Guide_BN.pdf` — Bangla setup guide (with screenshots-style steps)
