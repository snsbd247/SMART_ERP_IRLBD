# Plan: Returns, Stock Adjustments, RBAC Seeding

Scope is large — four backend feature areas. I'll implement each as a focused, additive (Safe Extension) slice without modifying existing working controllers.

## 1. Sales Returns Backend
- New `app/Http/Controllers/Sales/SalesReturnController.php` with `index/show/store/update/destroy/approve`.
- `store` validates source `sales_invoice_id`, generates `SR-YY-#####` via `number_sequences`, inserts `sales_returns` + `sales_return_items` in a DB transaction.
- `approve` posts:
  - Reverse stock movement (`+qty` back into warehouse) via existing `StockMovement` model.
  - Journal voucher (Dr Sales Return / Cr Customer Receivable) via `VoucherRepository`.
- Add `PUT /sales-invoices/{id}` and `DELETE /sales-invoices/{id}` to `SalesInvoiceController` (block when paid/returned).
- Routes under `Route::middleware('permission:sales.*')`.

## 2. Purchase Returns Backend + Frontend Wiring
- New `app/Http/Controllers/Purchase/PurchaseReturnController.php` mirroring sales returns (`approve` reverses stock and posts Dr Supplier Payable / Cr Purchase Returns).
- Routes `/purchase-returns` with `purchase.create/edit/delete/approve` gates.
- Frontend: add `/purchase-workflow/returns` route + a thin `PurchaseReturnsPage` (list + approve button) wired through existing `laravel-bridge`.

## 3. Stock Adjustments API + Approval
- New `app/Http/Controllers/Inventory/StockAdjustmentController.php`:
  - `index/show/store/approve/destroy`.
  - On `approve`: write `stock_movements` row (±qty), write journal voucher (Dr/Cr Inventory ↔ Stock Adjustment), flip status to `posted`.
- Add `status` enforcement: only `draft` rows are editable/deletable; `posted` rows are locked.
- Frontend `StockAdjustmentPage.tsx`: add Approve button per row that calls the new endpoint (no change to existing direct-supabase create path — additive).

## 4. BD VAT Canonical Roles & Permissions
- Extend `database/seeders/data/demo_config_seed.json` (or a new `bd_vat_roles_seed.json`) with 4 canonical roles needed by VAT approval flow:
  - `VAT Officer`, `Store Manager`, `Procurement Officer`, `Accounts Manager` — each with explicit permissions for `purchase_workflow.*`, `sales_workflow.*`, `vat_challan.*`, `mushak_9_1.*`, `tds.*`, `bill.*`, `payment.*`.
- Re-use existing `CanonicalRolesSeeder` (idempotent upsert) — just enrich the JSON.
- Run via `db:seed --class=CanonicalRolesSeeder` (documented in commit, not auto-executed since cPanel deploy).
- Also seed missing `role_permissions` rows for `purchase_returns`, `sales_returns`, `stock_adjustments` modules across all 7 existing canonical roles.

## Technical notes
- Backend = Laravel only (`erp-backend/`). No Supabase migrations needed — `sales_returns`, `purchase_returns`, `stock_adjustments` tables already exist (MySQL).
- All new endpoints use `Sanctum` auth + `permission:` middleware (already registered in `Http/Kernel`).
- Voucher posting reuses `app/Repositories/VoucherRepository.php` to keep double-entry consistent.
- Stock impact uses existing `StockMovement` model — no new ledger logic.
- All controllers wrap multi-table writes in `DB::transaction(...)`.

## Files to be created
- `erp-backend/app/Http/Controllers/Sales/SalesReturnController.php`
- `erp-backend/app/Http/Controllers/Purchase/PurchaseReturnController.php`
- `erp-backend/app/Http/Controllers/Inventory/StockAdjustmentController.php`
- `erp-backend/app/Models/SalesReturnItem.php`, `PurchaseReturnItem.php` (if missing)
- `src/pages/purchase-workflow/PurchaseReturnsPage.tsx`

## Files to be modified
- `erp-backend/app/Http/Controllers/Sales/SalesInvoiceController.php` (add update/destroy)
- `erp-backend/routes/api.php` (register new routes)
- `erp-backend/database/seeders/data/demo_config_seed.json` (BD VAT roles + new modules)
- `src/App.tsx` + `src/components/AppSidebar.tsx` (Purchase Returns route)
- `src/pages/inventory/StockAdjustmentPage.tsx` (Approve button)

No existing endpoints are renamed or removed. Strictly additive.
