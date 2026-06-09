## Scope (confirmed)
Remove Purchase module completely from frontend, Laravel backend, Supabase database, and edge functions. This includes Suppliers, Purchase Reports (AP/AP-Aging/Expense), legacy purchases, and the entire purchase workflow (PR → PO → GRN → Bill).

## 1. Frontend (React)

**Delete files**
- `src/pages/purchase-workflow/` (entire folder — 12 files)
- `src/pages/SuppliersPage.tsx`, `src/pages/SupplierProfilePage.tsx`
- `src/pages/reports/PurchaseReport.tsx`
- `src/pages/reports/accounting/AccountsPayableReport.tsx` and AP-Aging/Expense-Analysis report pages
- `src/components/purchase-workflow/` folder
- `src/components/help/ReturnsHelpPanel.tsx`
- `src/components/dashboard/RecentReturnsWidget.tsx` (if purchase-returns specific)
- `src/lib/purchase-validation.ts`, `purchase-workflow-utils.ts`, `purchase-workflow-transitions.test.ts`, `returns-permissions.test.ts`, `returns-workflow.test.ts`

**Edit**
- `src/App.tsx` — drop all purchase imports + routes (`/purchase`, `/suppliers`, `/purchase-workflow/*`, `/reports/purchase`, `/reports/accounts-payable`, `/reports/ap-aging`, `/reports/expense-analysis`)
- `src/components/AppSidebar.tsx` — remove the Purchase section + AP report entries
- `src/contexts/ModuleContext.tsx` — remove `purchase` module
- `src/components/Breadcrumbs.tsx` — drop purchase paths
- `src/pages/Dashboard.tsx` — drop purchase widgets/cards
- `src/pages/admin/DiagnosticsPage.tsx`, `RolesPage.tsx`, `GeneralSettingsPage.tsx` — drop purchase refs
- `src/lib/ifrs-mapping.ts`, `soft-delete.ts`, `transaction-service.ts`, `document-api.ts` — drop purchase types/branches
- `src/integrations/supabase/laravel-bridge.ts` — drop `/purchases` endpoints
- `src/pages/inventory/StockLedgerPage.tsx`, `src/pages/reports/StockLedger.tsx`, `StockReportsPage.tsx`, `accounting/PartyLedgerReport.tsx`, `accounting/AgingReports.tsx`, `FinancialReports.tsx` — strip supplier/purchase columns/filters
- `src/pages/CustomerProfilePage.tsx` — only if it references supplier (likely shared util)

## 2. Laravel backend (`erp-backend`)

**Delete**
- `app/Http/Controllers/Purchase/` (Purchase, PurchaseReturn, Supplier, PurchaseOrder controllers)
- `app/Models/`: Purchase, PurchaseItem, PurchaseReturn, PurchaseReturnItem, PurchaseOrder, PurchaseOrderItem, PoAmendment, Supplier
- `app/Services/PurchaseService.php`, `PurchaseOrderService.php`, related services
- Purchase migrations under `database/migrations/` (including `2024_01_01_000800_create_purchase_workflow_tables.php`)
- `app/Console/Commands/CleanupLegacyPurchases.php`

**Edit**
- `routes/api.php` — remove purchase/supplier routes
- `database/seeders/DatabaseSeeder.php` — drop purchase `number_sequences`, `page_shortcuts`, role permissions
- `CanonicalRolesSeeder.php`, `NewModulesRbacSeeder.php` — drop `purchase.*` permissions

## 3. Database (Supabase migration)

Drop in FK-safe order with `CASCADE`:
```
purchase_bill_payments, purchase_bill_grns, purchase_bills,
grn_items, grns,
purchase_order_items_v2, purchase_orders_v2,
purchase_requisition_items, purchase_requisitions,
po_amendments, purchase_order_items, purchase_orders,
purchase_return_items, purchase_returns,
purchase_items, purchases,
payment_allocations (supplier portion), party_payments where party_type='supplier',
suppliers
```
Also drop: related `number_sequences` rows (`purchase_*`, `grn`, `bill_*`), `page_shortcuts` PREQ/PPO/GRN/BILL, role_permissions `purchase.*`.

## 4. Edge functions

- `supabase/functions/create-backup/index.ts` — drop purchase tables from export list
- `supabase/functions/reset-and-seed-demo/index.ts` — drop from reset groups + seeds
- `supabase/functions/document-api/index.ts` — drop purchase doc types
- `supabase/functions/import-demo-config/seed.json` — strip purchase seed rows

## 5. Cleanup & verification
- Run typecheck via build to surface dangling imports
- Verify sidebar, dashboard, reports menu render without errors
- Confirm sales-workflow, inventory, accounts modules still function (they share `chart_of_accounts`, `stock_ledger`, `acc_vouchers`)

## Risks
- **Supplier FK cascade**: `party_payments`, `payment_allocations`, `acc_vouchers` may have `supplier_id` references — those rows will be deleted by CASCADE. Any accounting history tied to suppliers is lost. **Irreversible.**
- **Backups** of existing data should be downloaded before running the migration.
- Once executed, restoring requires reverting migration + re-importing.

Proceed?