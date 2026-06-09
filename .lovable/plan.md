# Sales Workflow (BD VAT) — Rebuild Plan

আগের Sales Workflow সিস্টেম রিমোভ করে নতুন করে বানানো হবে। মূল পরিবর্তন: একটা PO এর বিপরীতে **partial multiple VAT Challan** support, প্রতি PO item-এর `delivered_qty` / `remaining_qty` ট্র্যাকিং, এবং পুরো cycle (PO → VAT Challan → DC → Customer Receive → HO Receive → Invoice → Bill Submit → Payment+TDS → CoA Ledger)।

অন্য মডিউল (Accounts, Inventory, HRM, Reports) এ কোনো breaking change হবে না — শুধু `sales-workflow` namespace-এর tables, services, controllers, এবং pages রিবিল্ড হবে।

## Process Flow (Confirmed)

```text
Purchase Order (5 products × 500 pcs)
   │
   ├── VAT Challan #1 (3 products × 300 pcs)   ← partial
   │      └── Delivery Challan per product (3 DCs)
   │      └── 2 sets sent with vehicle (1 → customer, 1 → signed copy back)
   │      └── Customer Receive (sealed/signed) → Factory → HO Receive
   │
   ├── VAT Challan #2 (remaining qty)          ← partial
   │      └── ... same flow
   │
   └── Invoice (1 invoice per challan OR consolidated multi-challan)
          └── Bill Submit to Customer HO (start of 30-day clock)
                └── Payment (after 30 days) − TDS deduction
                      └── CoA Ledger posting
```

## Scope

### Remove (old system)
- Drop old service/controller logic that didn't support partial PO consumption.
- Keep table data but **add columns** rather than dropping tables (data preservation).
- Remove confusing UI bits; rebuild pages around the new flow.

### Database changes
1. `purchase_order_items` — add `delivered_qty` (default 0), computed `remaining_qty` via view/accessor.
2. `vat_challan_items` — add `purchase_order_item_id` (nullable FK), `po_qty_consumed`.
3. `vat_challans` — add `purchase_order_id` (nullable FK, since a challan is now PO-linked).
4. `sales_invoices_v2` — already has `bill_submitted_at`, `bill_due_date`, `payment_terms_days` ✓.
5. `tds_entries` — verify posts to **TDS Receivable (Asset)** account.
6. Migration applied to **both** Laravel (MySQL) and Supabase (Postgres).

### Backend (Laravel)
- **`PurchaseOrderService`** — add `availableQtyPerItem(poId)` helper.
- **`VatChallanService`** — rebuild:
  - require `purchase_order_id`
  - validate each item: `qty ≤ po_item.remaining_qty`
  - on create: increment `po_item.delivered_qty`, auto-create one DC per product
  - on delete: decrement `po_item.delivered_qty`
- **`DeliveryChallanService`** — status transitions: `issued → dispatched → customer_received → ho_received → invoiced`.
- **`InvoiceProcessingService`** — already supports single / same_day / custom multi-challan. Keep as-is; tighten eligibility check (all DCs `ho_received`).
- **`InvoicePaymentService`** — verify TDS posts to `TDS Receivable`. Fix account name lookup if needed.
- **`AccountingService`** ledger entries:
  - Invoice posted: DR AR, CR Sales, CR VAT Payable
  - Payment received: DR Bank/Cash, DR TDS Receivable, CR AR

### Frontend (React)
- `PurchaseOrderDetailPage` — show per-item delivered/remaining qty + "Issue VAT Challan" button.
- `VatChallanFormPage` (new) — pick PO → load items with `remaining_qty` → enter delivery qty per product.
- `VatChallansPage`, `DeliveryChallansPage`, `CustomerReceivePage`, `HoReceivePage` — keep current shape, refine status flow.
- `InvoiceQueuePage` — already supports multi-pick; keep.
- `InvoiceDetailPage` — already has Bill Submit section ✓.
- Remove dead components from old confusing workflow.

### Routes & Sidebar
- No new top-level routes; existing `/sales-workflow/*` paths retained.
- Sidebar items unchanged → no impact on other modules.

## Technical Details (for review)

**Migration files**
- `erp-backend/database/migrations/2024_01_01_000700_partial_po_vat_challan.php` — adds the 3 columns above.
- `supabase/migrations/<timestamp>_partial_po_vat_challan.sql` — same schema for Postgres with GRANTs.

**New / rebuilt files**
- `erp-backend/app/Services/VatChallanService.php` (rebuild with PO consumption)
- `erp-backend/app/Services/PurchaseOrderService.php` (add availability helper)
- `erp-backend/app/Http/Controllers/SalesWorkflow/VatChallanController.php` (accept `purchase_order_id`)
- `src/pages/sales-workflow/VatChallanFormPage.tsx` (new — PO-driven form)
- `src/lib/sales-workflow-api.ts` (add `getPoAvailability(poId)`)

**Backward compatibility**
- `purchase_order_id` on `vat_challans` is **nullable** → existing rows unaffected.
- Old challans without PO link still display/edit/delete normally.

**Other modules**
- Accounting, Inventory, HRM, Reports — no schema or code touched outside `sales-workflow`. Voucher/Ledger posting uses existing `AccountingService` API.

## Out of scope
- Mushak 6.3 print template tweaks (already exists).
- Customer/Supplier master changes.
- New report types beyond existing TDS Register & Sales reports.
