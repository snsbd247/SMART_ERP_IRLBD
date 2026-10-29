# Canonical Roles — Deploy & Verification Guide (Step 6)

Applies the 7-role × 33-module matrix produced in Steps 4–5.
Safe Extension: only `custom_roles` + `role_permissions` are touched. No
existing user mappings, vouchers, or business data are modified.

---

## 1. Laravel / VPS deploy

```bash
# On the VPS, inside the backend directory
cd /var/www/erp/backend
git pull
php artisan migrate --force          # no-op if no new migrations
php artisan db:seed --class=CanonicalRolesSeeder
php artisan cache:clear
php artisan config:cache
```

The seeder is idempotent — re-running it only upserts the 7 canonical roles
and 231 permission rows. Existing custom roles created by users are left
untouched.

---

## 2. Import via the admin UI (any deploy)

The config import (Chart of Accounts, roles/permissions, numbering, etc.) is
served by Laravel's `POST /v1/admin/demo/import-config` route. Trigger it from
**Admin → Backup → Import Demo Configuration** (Super Admin only).

Optional cleanup of legacy roles (run once via `php artisan tinker` or any
MySQL client if you want to remove obsolete custom roles such as `Admin`,
`Viewer`, `Inventory Clerk`):

```sql
-- Preview first
SELECT cr.name, COUNT(ucr.user_id) AS assigned_users
FROM custom_roles cr
LEFT JOIN user_custom_roles ucr ON ucr.custom_role_id = cr.id
WHERE cr.name NOT IN (
  'Administrator','Accountant','Sales Manager','Purchase Manager',
  'Inventory Manager','HR Manager','Employee'
)
GROUP BY cr.name;

-- Delete only if assigned_users = 0
DELETE FROM custom_roles
WHERE name IN ('Admin','Viewer','Inventory Clerk','Super Admin')
  AND id NOT IN (SELECT custom_role_id FROM user_custom_roles);
```

> Note: the `Super Admin` custom role row is obsolete — Super Admin is now
> the hardcoded user with `employee_id = NULL`, not a custom role.

---

## 3. Verification queries

```sql
-- A. Each canonical role has exactly 33 permission rows
SELECT cr.name, COUNT(rp.id) AS perm_rows
FROM custom_roles cr
LEFT JOIN role_permissions rp ON rp.custom_role_id = cr.id
WHERE cr.name IN (
  'Administrator','Accountant','Sales Manager','Purchase Manager',
  'Inventory Manager','HR Manager','Employee'
)
GROUP BY cr.name
ORDER BY cr.name;
-- Expected: 7 rows, perm_rows = 33 each

-- B. Total view-permission counts per role (sanity)
SELECT cr.name,
       SUM(can_view)   AS v,
       SUM(can_add)    AS a,
       SUM(can_edit)   AS e,
       SUM(can_delete) AS d
FROM custom_roles cr
JOIN role_permissions rp ON rp.custom_role_id = cr.id
WHERE cr.name IN (
  'Administrator','Accountant','Sales Manager','Purchase Manager',
  'Inventory Manager','HR Manager','Employee'
)
GROUP BY cr.name
ORDER BY cr.name;
```

Equivalent Laravel artisan tinker check:

```php
php artisan tinker
>>> DB::table('custom_roles')->whereIn('name', ['Administrator','Accountant','Sales Manager','Purchase Manager','Inventory Manager','HR Manager','Employee'])->pluck('id','name');
>>> DB::table('role_permissions')->whereIn('custom_role_id', $ids)->count();   // expect 231
```

---

## 4. Post-deploy smoke test

1. Log in as Super Admin → **Admin → Roles** — confirm the 7 canonical roles
   appear with all 33 modules visible in the matrix.
2. Create a test user, assign **Sales Manager**, log in:
   - `/sales/*`, `/customers`, `/receipts`, AR reports → accessible
   - `/purchase/*`, `/hrm/*`, `/admin/*` → blocked with "Access Denied"
3. Repeat for **HR Manager** and **Employee** (Employee should only see
   `/portal/*`).
4. Super Admin (null `employee_id`) must continue to bypass all checks.
