# SmartERP — Intelligent Business Management Suite

SmartERP is a full-stack ERP for accounting, inventory, HRM, manufacturing, sales/purchase workflow and Bangladesh VAT compliance. Built with **React 18 + Vite** and **Laravel (PHP 8.2)** + MySQL.

| Layer | Tech | Purpose |
|-------|------|---------|
| Frontend | React 18 + Vite + Tailwind + shadcn/ui | SPA dashboard & forms |
| Backend API | Laravel + Sanctum | Business logic, auth, MySQL, file storage |
| Reports / Prints | Laravel Blade + dompdf | PDF invoices, ledgers, statements |

The frontend talks only to the Laravel REST API (same origin, `/api`).

## Repository layout

```
smart_erp/
├── frontend/          React app (src/, public/, e2e/, Vite/Tailwind/TS config)
├── backend/           Laravel API (app/, routes/, database/, config/, ...)
├── deploy/
│   ├── cpanel/        deploy.sh — build + upload + migrate + health-check (live site)
│   └── vps/           Ubuntu VPS installer / updater / rollback scripts
├── docs/              Guides (backend API, deployment, theme, permissions)
├── others/            API test collection (Bruno)
└── .github/           CI (Vitest)
```

## Local development

Prerequisites: Node.js 20+, PHP 8.2+ (`mbstring xml curl zip bcmath gd intl mysql`), Composer 2, MySQL 8.

### Backend

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
# set DB_* in .env, then:
php artisan migrate --seed
php artisan serve --port=8000
```

Optional demo data: `php artisan demo:seed` (reset with `--reset`).

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
echo VITE_API_BASE_URL=http://localhost:8000/api > .env.local
npm run dev
```

Default Super Admin after seeding: **admin / Admin@123** (change it immediately).

## Commands

```bash
# frontend/
npm run dev | build | lint | test

# backend/
php artisan migrate --seed            # fresh DB + default data
php artisan backup:database           # manual DB backup
php artisan sales-workflow:smoke      # smoke-test the sales workflow (other *:smoke commands exist)
php artisan test                      # PHPUnit
```

## Deployment

- **Live site (cPanel, erp.irlbd.com):** `bash deploy/cpanel/deploy.sh` — see [docs/deployment/CPANEL_DEPLOYMENT.md](docs/deployment/CPANEL_DEPLOYMENT.md).
- **Ubuntu VPS:** `deploy/vps/quick-install.sh` / `update.sh` — see [docs/deployment/VPS_README.md](docs/deployment/VPS_README.md) and the Bangla guide [docs/deployment/SETUP_GUIDE_BN.md](docs/deployment/SETUP_GUIDE_BN.md).

## Documentation

- [Backend overview](docs/backend/README.md) · [API reference](docs/backend/API_DOCS.md) · [Sales workflow](docs/backend/SALES_WORKFLOW_README.md) · [Canonical roles deploy](docs/backend/CANONICAL_ROLES_DEPLOY.md)
- [Theme](docs/THEME.md) · [Voucher permissions](docs/voucher-permissions.md)

## License

Proprietary software developed for **Smart Accounting** / **Sync Solution BD**.
Support: `ismailsagor162@gmail.com`
