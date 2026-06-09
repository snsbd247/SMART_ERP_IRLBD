# Purchase Workflow Rebuild Plan

ফ্যাক্টরি থেকে রিকুইজিশন শুরু করে পেমেন্ট পর্যন্ত পুরো পারচেজ সাইকেল একটা ইউনিফায়েড workflow হিসেবে বানানো হবে। অন্য মডিউল (Sales Workflow, Inventory, HRM, Accounts existing pages) এ কোনো breaking change হবে না — শুধু `purchase-workflow` namespace-এ নতুন tables, services, controllers, এবং pages যোগ হবে। বিদ্যমান `purchases` / `purchase_items` table-গুলো backward-compatible থাকবে।

## Process Flow

```text
Store Department (Factory)
   └── Purchase Requisition (PR)  [product + qty]
        │
        ▼  Approve
Factory Admin
        │
        ▼  Forward
Commercial Department
   └── Purchase Order (PO)
        ├── Full PR → 1 PO
        └── OR partial: PR items → multiple POs
        │
        ▼  Print → Send to Supplier
Supplier
   └── Delivers goods + Invoice / Delivery Challan
        │
        ▼  Receive
Store Department
   └── GRN (Goods Receipt Note)  [posts stock IN]
        │
        ▼  Forward physical bill
Accounts Department
   └── Bill Entry against GRN  [DR Purchase, CR Accounts Payable]
        │
        ▼  Due date tracked
   └── Payment  [DR AP, CR Bank/Cash]  (− TDS if applicable)
        │
        ▼  CoA Ledger auto-post (every accounting step)
```

## Scope

### New Module: `purchase-workflow`
Routes under `/purchase-workflow/*`, sidebar group "Purchase Workflow".

### Database (new tables — additive only)

1. `purchase_requisitions` — pr_number, pr_date, branch_id, requested_by (employee), notes, status (draft/pending_admin/admin_approved/commercial_processed/closed/rejected).
2. `purchase_requisition_items` — pr_id, product_id, qty_required, qty_ordered (running counter), remarks.
3. `purchase_orders_v2` — po_number, po_date, supplier_id, pr_id (nullable), branch_id, subtotal/vat/grand_total, status (draft/sent/partial_received/received/closed), notes.
4. `purchase_order_items_v2` — po_id, pr_item_id (nullable), product_id, qty_ordered, qty_received, rate, vat_pct, line_total.
5. `grns` — grn_number, grn_date, po_id, supplier_id, supplier_invoice_no, supplier_invoice_date, branch_id, received_by, status (draft/posted), total_amount.
6. `grn_items` — grn_id, po_item_id, product_id, qty_received, rate, line_total.
7. `purchase_bills` — bill_number, bill_date, supplier_id, supplier_bill_no, due_date, branch_id, subtotal/vat/grand_total, paid_amount, status (unpaid/partial/paid).
8. `purchase_bill_grns` — bill_id, grn_id (M:N — multiple GRNs can be billed together).
9. `purchase_bill_payments` — bill_id, payment_date, amount, tds_amount, payment_method, bank_account_id, voucher_id (link to acc_vouchers).

All tables: standard `id uuid`, timestamps, soft-delete columns, RLS policies + GRANTs per project rules.

### Backend (Laravel — Service Layer)

- `PurchaseRequisitionService` — create / approve / reject / close.
- `PurchaseOrderV2Service` — create from PR (full or partial items), validate qty ≤ pr_item.remaining.
- `GrnService` — receive against PO (partial allowed), increments stock via existing `StockService`, updates `po_item.qty_received`.
- `PurchaseBillService` — create bill linked to one or more GRNs, auto-post: DR Purchase, CR Accounts Payable.
- `PurchaseBillPaymentService` — post payment: DR AP, [DR TDS Receivable], CR Bank/Cash. Uses existing `AccountingService::createVoucher`.

Controllers under `App\Http\Controllers\PurchaseWorkflow\*`. Routes prefixed `/api/purchase-workflow/*`.

### Frontend (React)

New pages under `src/pages/purchase-workflow/`:
- `RequisitionsPage` (list) + `RequisitionFormPage` + `RequisitionDetailPage` (approve/reject).
- `PoListPage` + `PoFormPage` (pick PR, pick items) + `PoDetailPage` (print).
- `GrnListPage` + `GrnFormPage` (pick PO, enter received qty) + `GrnDetailPage`.
- `BillListPage` + `BillFormPage` (pick supplier + GRNs) + `BillDetailPage` (with payment section).
- `PaymentFormPage` (against bill, TDS field).

Shared API client: `src/lib/purchase-workflow-api.ts`.
Sidebar: add "Purchase Workflow" group with 5 items.

### Accounting Integration (CoA hits)

| Step | Debit | Credit |
|---|---|---|
| GRN | (no JV — only stock movement) | — |
| Bill Entry | Purchase / Inventory | Accounts Payable |
| Payment | Accounts Payable | Bank/Cash |
| Payment with TDS | AP + TDS Payable | Bank/Cash |

Uses existing `AccountingService::autoPost` and `ChartOfAccounts` — no changes to accounting module.

### Permissions (RBAC)
New module keys: `purchase_requisition`, `purchase_order_v2`, `grn`, `purchase_bill`, `purchase_payment` — each with view/create/edit/delete/approve.

### Backward compatibility
- Old `purchases` / `purchase_items` tables untouched — existing `PurchasesPage` keeps working.
- Old `purchase_orders` table untouched (used by sales workflow's mirror? No — that's customer PO; leave as-is).
- No changes to Sales Workflow, Inventory, HRM, Accounts pages.

## Technical Details

**Migrations**
- `supabase/migrations/<ts>_purchase_workflow_tables.sql` — 9 new tables with GRANTs + RLS.
- `erp-backend/database/migrations/2024_01_01_001000_purchase_workflow.php` — same schema for MySQL.

**New backend files**
- `erp-backend/app/Models/{PurchaseRequisition,PurchaseRequisitionItem,PurchaseOrderV2,PurchaseOrderItemV2,Grn,GrnItem,PurchaseBill,PurchaseBillPayment}.php`
- `erp-backend/app/Services/PurchaseWorkflow/*Service.php` (5 services above)
- `erp-backend/app/Http/Controllers/PurchaseWorkflow/*Controller.php` (5 controllers)
- Routes appended to `erp-backend/routes/api.php`.

**New frontend files** (~15 files under `src/pages/purchase-workflow/` + 1 API lib).

**Document numbering** — uses existing `number_sequences` table: PRQ-YYYY-####, POV-YYYY-####, GRN-YYYY-####, PBL-YYYY-####, PPM-YYYY-####.

## Out of scope
- Purchase Return (handled by existing `purchase_returns` table — separate feature).
- Supplier rating / vendor evaluation.
- Multi-currency purchases.
- Approval matrix beyond single admin step (can be extended later).

## Confirm before build
1. PR → PO step: **শুধু Commercial Department** PO ইস্যু করতে পারবে — RBAC দিয়ে control হবে (permission `purchase_order_v2.create`)। ঠিক আছে?
2. GRN ছাড়া Bill এন্ট্রি করা যাবে না (strict)। ঠিক আছে?
3. TDS payment-এ deduct হবে, Bill-এ নয়। ঠিক আছে?
