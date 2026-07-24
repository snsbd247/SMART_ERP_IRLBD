# SmartERP — Intelligent Business Management Suite

SmartERP is a full-stack ERP solution for accounting, inventory, HRM, manufacturing, sales/purchase workflow, and Bangladesh VAT compliance. Built with **React 18 + Vite** and **Laravel 10/11 (PHP 8.2)** + MySQL.

## Architecture

| Layer | Tech | Purpose |
|-------|------|---------|
| Frontend | React 18 + Vite + Tailwind + shadcn/ui | SPA dashboard & forms |
| Backend API | Laravel + Sanctum | Business logic, auth, MySQL primary DB, storage |
| Reports / Prints | Laravel Blade + dompdf | PDF invoices, ledgers, statements |

> The frontend's internal data client (`src/integrations/supabase/`) is named for historical reasons but talks only to the Laravel REST API — there is no Supabase/Cloud dependency in the app itself.

## Quick Start — VPS Deployment (Recommended)

Deploy the entire stack (self-hosted Supabase + Laravel + React) on a fresh **Ubuntu 22.04/24.04** VPS with one command.

### Requirements
- Fresh Ubuntu 22.04/24.04 VPS (≥ 2 vCPU, 4 GB RAM, 40 GB SSD)
- Root (or sudo) access
- DNS A-records pointing to your VPS IP:

| Host | Purpose |
|------|---------|
| `erp.irlbd.com` | Main app |
| `www.erp.irlbd.com` | Redirect / app |
| `supabase.erp.irlbd.com` | Supabase API gateway (Kong) |
| `studio.erp.irlbd.com` | Supabase Studio admin UI |

### One-Command Install

```bash
curl -fsSL https://raw.githubusercontent.com/snsbd247/smart_accounting/main/deploy/vps/install.sh -o install.sh
chmod +x install.sh
DOMAIN=erp.irlbd.com ADMIN_EMAIL=you@erp.irlbd.com ./install.sh
```

The installer will:
1. Install Docker, Node 20, PHP 8.2-fpm, MySQL 8, Nginx, Certbot
2. Clone the repo and build the React frontend
3. Configure Laravel (`erp-backend/`) with MySQL + `.env`
4. Deploy self-hosted Supabase (Postgres, GoTrue, PostgREST, Storage, Studio, Kong)
5. Issue SSL certificates via Let's Encrypt
6. Save all credentials to `/root/smarterp-credentials.txt`

### Post-Install
1. Open `https://erp.irlbd.com/install` → Laravel installer wizard
2. Use the MySQL credentials from `/root/smarterp-credentials.txt`
3. Create the Super Admin account
4. Login and start using SmartERP

> **Tip:** If the `supabase-analytics` container fails on small VPS plans, the installer automatically relaxes its health check and continues. The app will still work; analytics/logs are optional.

If installation stops early, the installer now saves any generated recovery credentials to `/root/smarterp-credentials.txt` with `Status: FAILED/PARTIAL`. Fix the shown error in `/root/install.log`, then rerun the installer.

---

## Local Development Setup

### Prerequisites
- Node.js 20+ (`nvm install 20`)
- PHP 8.2+ with extensions: `mbstring xml curl zip bcmath gd intl mysql`
- Composer 2.x
- MySQL 8
- Git

### 1. Clone the repository

```bash
git clone https://github.com/snsbd247/smart_accounting.git
cd smart_accounting
```

### 2. Frontend setup

```bash
npm install --legacy-peer-deps
# or
npm ci --legacy-peer-deps
```

Create a local `.env`:

```bash
# .env.local
VITE_API_BASE_URL=http://localhost:8000/api
```

Run the dev server:

```bash
npm run dev
```

### 3. Backend (Laravel) setup

```bash
cd erp-backend
composer install
```

Copy and edit `.env`:

```bash
cp .env.example .env
php artisan key:generate
```

Set database credentials in `.env`:

```ini
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=smarterp
DB_USERNAME=root
DB_PASSWORD=your_mysql_password
```

Run migrations and seeders:

```bash
php artisan migrate --seed
```

#### Optional — 1-Year Demo Data

```bash
php artisan demo:seed
# Reset demo data:
php artisan demo:seed --reset
```

Serve the API (or use Laravel Sail / php artisan serve):

```bash
php artisan serve --host=0.0.0.0 --port=8000
```

### 4. Access the app

- Frontend dev: `http://localhost:5173`
- Laravel API: `http://localhost:8000`
- Laravel installer (first time): `http://localhost:8000/install`

---

## Directory Structure

```
smart_accounting/
├── src/                          # React frontend (pages, components, hooks, lib)
│   ├── pages/                    # Route pages (accounts, inventory, hrm, sales, etc.)
│   ├── components/             # Reusable UI components
│   ├── contexts/               # React contexts (Auth, Branch, Theme, etc.)
│   ├── hooks/                  # Custom hooks
│   └── lib/                    # Utility libraries (auth, API clients, math)
├── erp-backend/                  # Laravel API
│   ├── app/
│   │   ├── Http/Controllers/   # API controllers
│   │   ├── Models/             # Eloquent models
│   │   ├── Services/           # Business logic services
│   │   └── Console/Commands/   # Artisan commands (demo seed, backup, etc.)
│   ├── database/migrations/    # All module migrations
│   ├── database/seeders/       # Default + demo seeders
│   └── routes/api.php          # API routes
├── deploy/                       # Deployment assets
│   ├── vps/install.sh          # One-command VPS installer
│   └── .htaccess               # Shared hosting rewrite rules
└── docs/                         # Guides (Bangla PDF, etc.)
```

---

## Key Features

| Module | Highlights |
|--------|------------|
| **Accounting** | Double-entry vouchers, Chart of Accounts (Bangladesh 4-digit COA), auto-balancing debit/credit, ledger, trial balance, financial statements |
| **Inventory** | Item master, stock ledger (immutable), transfers, adjustments, reorder alerts |
| **Sales & Purchase** | PO, sales orders, dispatch, invoices, payment allocation (FIFO), TDS, party ledger |
| **Bangladesh VAT** | Mushak 6.1, 6.2, 6.3, 6.10, 9.1 (VAT Return) — auto challan & submission-ready reports |
| **HRM & Payroll** | Employee profiles, attendance, biometric sync, salary structure, auto payroll, provident fund |
| **Manufacturing** | BOM, production orders, raw-material consumption, cost tracking |
| **Fund Management** | Employee PF ledger, loan tracking, CoA integration |
| **Backup & Restore** | Automated DB backups (local / Google Drive), one-click restore |
| **Employee Portal** | Self-service attendance, payslips, leave requests, documents |
| **Multi-Branch** | Branch-scoped data with Super Admin override |
| **RBAC** | Role-based access control via `user_custom_roles` + `role_permissions` |

---

## Default Super Admin Credentials (Local / Demo)

After seeding, login with:

- **Username:** `admin`
- **Password:** `Admin@123`

> In Laravel mode, the frontend detects `VITE_API_BASE_URL` and uses Sanctum token auth. In pure Supabase mode, it uses Supabase Auth.

---

## Scripts & Commands

```bash
# Frontend
npm run dev          # Vite dev server
npm run build        # Production build
npm run test         # Vitest unit tests

# Backend (cd erp-backend)
php artisan migrate --seed           # Fresh DB + default data
php artisan demo:seed               # 1-year operational demo data
php artisan demo:seed --reset         # Reset + re-seed demo
php artisan db:backup                 # Manual MySQL backup
php artisan smoke:test-sales          # Validate sales workflow
php artisan test                      # PHPUnit tests
```

---

## License

This project is proprietary software developed for **Smart Accounting** / **Sync Solution BD**.

---

## Support

- **Issues:** Open a GitHub issue or contact `ismailsagor162@gmail.com`
- **Bangla Guide:** See `docs/VPS_Setup_Guide_BN.pdf` for step-by-step screenshots
