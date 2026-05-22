# Bangladesh VAT-Compliant Sales Workflow Implementation Plan

End-to-end implementation of: **PO → Dispatch → VAT Challan → Delivery Challan → Customer Receive → HO Receive → Invoice → Payment/TDS**

Following strict safe-extension: existing Sales/Purchase/Inventory/Accounting/Payroll modules remain untouched. All new tables/routes/pages are additive.

---

## Phase 1 — Database (Supabase migrations + Laravel migrations)

New tables (all with `branch_id`, `financial_year_id`, audit fields, soft deletes where noted):

1. **purchase_orders** — po_number, po_date, customer_id, delivery_date, status (draft/open/partial/closed/cancelled), total_amount, vat_amount, grand_total, notes, attachment_url
2. **purchase_order_items** — po_id, product_id, qty_ordered, qty_delivered, qty_remaining, rate, vat_pct, line_total
3. **po_amendments** — po_id, amended_by, old_data (jsonb), new_data, reason
4. **dispatches** — dispatch_number, dispatch_date, customer_id, vehicle_no, driver_name, status (draft/dispatched/delivered/received), total_qty
5. **dispatch_items** — dispatch_id, product_id, qty
6. **dispatch_po_allocations** — dispatch_item_id, po_item_id, allocated_qty (enforces no-over-allocation via service)
7. **vat_challans** — challan_number, challan_date, customer_id, dispatch_id (nullable), vehicle_no, driver_name, subtotal, vat_amount, total, attachment_url, status, source (manual/import)
8. **vat_challan_items** — vat_challan_id, product_id, qty, rate, vat_pct, vat_amount, line_total
9. **delivery_challans** — dc_number, dc_date, vat_challan_id, product_id, qty, status (issued/delivered/customer_received/sent_to_ho/ho_received/invoiced), attachment_url
10. **customer_receives** — delivery_challan_id, receive_date, received_by_name, transport_info, scan_url
11. **ho_receives** — delivery_challan_id, ho_receive_date, verified_by, missing_flag, notes
12. **sales_invoices_v2** (extension; existing sales_invoices stays) — invoice_number, invoice_date, customer_id, mode (single/same_day/custom), subtotal, vat_total, grand_total, status, voucher_id
13. **sales_invoice_items_v2** — invoice_id, product_id, qty, rate, vat_pct, vat_amount, line_total, source_vat_challan_item_id
14. **invoice_challans** — invoice_id, vat_challan_id (link table for consolidation)
15. **invoice_payments** — invoice_id, payment_date, mode (cash/bank/cheque/online), amount_received, tds_amount, bank_account_id, voucher_id, reference
16. **tds_entries** — invoice_id, payment_id, tds_pct, tds_amount, certificate_no, certificate_date, voucher_id
17. **invoice_status_logs** / **dispatch_status_logs** — id, ref_id, old_status, new_status, changed_by, changed_at, notes

All tables RLS: `is_super_admin(auth.uid())` ALL + authenticated SELECT where read needed (mirrors existing pattern).

---

## Phase 2 — Backend (Laravel)

`erp-backend/app/`:

- **Models**: PurchaseOrder, PurchaseOrderItem, Dispatch, DispatchItem, DispatchPoAllocation, VatChallan, VatChallanItem, DeliveryChallan, CustomerReceive, HoReceive, SalesInvoiceV2, InvoicePayment, TdsEntry
- **Services** (Service Layer; reuse `AccountingService`, `StockService`, `NumberSequenceService`):
  - `PurchaseOrderService` — create/amend/close, balance recompute
  - `DispatchService` — multi-PO allocation, over-allocation guard, stock OUT movement
  - `VatChallanService` — manual + import, link to dispatch
  - `DeliveryChallanService` — auto-create per product from VAT challan, status transitions
  - `CustomerReceiveService`, `HoReceiveService`
  - `InvoiceProcessingService` — 3 modes (single / same-day / custom), validation, consolidation, voucher posting (DR AR, CR Sales, CR VAT Payable, COGS/Inventory)
  - `InvoicePaymentService` — partial payment, TDS split, voucher (DR Bank, DR TDS Receivable, CR AR)
- **Controllers** + Form Requests + API Resources under namespaced folders
- **Routes** (`routes/api.php`) under `/api/po`, `/api/dispatch`, `/api/vat-challan`, `/api/delivery-challan`, `/api/receive`, `/api/ho-receive`, `/api/invoice-v2`, `/api/invoice-payment`, `/api/tds` — all guarded by `permission:` middleware
- **Number sequences seeded**: PO, DSP, VCH, DC, INV2, RCP, TDS
- **Voucher posting** routed through `AccountingService::createVoucher()` — double-entry preserved

---

## Phase 3 — Frontend (React + shadcn)

New pages under `src/pages/sales-workflow/`:

- `PurchaseOrdersPage.tsx` + `PurchaseOrderFormPage.tsx` + `PurchaseOrderDetailPage.tsx`
- `DispatchPage.tsx` + `DispatchFormPage.tsx` (multi-PO allocator grid with live remaining-qty)
- `VatChallansPage.tsx` + `VatChallanFormPage.tsx`
- `DeliveryChallansPage.tsx` (status board: Issued → Delivered → Customer Received → HO Received → Invoiced)
- `CustomerReceivePage.tsx` (bulk-mark received with attachment upload)
- `HoReceivePage.tsx` (HO inbox / missing-challan alerts)
- `InvoiceQueuePage.tsx` (eligible challan picker — 3 modes)
- `InvoiceV2DetailPage.tsx`
- `InvoicePaymentPage.tsx` (with TDS split)
- `TdsRegisterPage.tsx`

Shared components: `PoAllocationGrid`, `ChallanStatusBadge`, `InvoiceChallanPicker`, `VatLineTable`, `WorkflowTimeline`.

Routes wired in `src/App.tsx` with `ProtectedRoute` (`sales-workflow.*` permissions).
Sidebar updated with collapsible "Sales Workflow (BD VAT)" group.

---

## Phase 4 — Reports

`src/pages/reports/sales-workflow/`:
- PO vs Dispatch, Pending PO, Challan Status, Customer Receive, HO Pending, Invoice Pending, VAT Register, Invoice Register, Delivery Register, Collection, Outstanding, TDS, Aging

All with filter / search / branch / date-range / CSV+PDF export / print.

---

## Phase 5 — RBAC + Audit + Seed Data

- New canonical modules added to `RolesPage` + Laravel seeder: `purchase_orders`, `dispatch`, `vat_challans`, `delivery_challans`, `customer_receive`, `ho_receive`, `invoice_processing`, `invoice_payment`, `tds`
- New preset roles: **Sales Officer**, **Dispatch Officer**, **HO Operator**, **VAT Manager** (Accounts Officer/Manager already exist)
- Audit log entries on every status transition & voucher post
- Seed Bangladesh CoA accounts: `VAT Payable`, `TDS Receivable`, `Output VAT`

---

## Phase 6 — Documentation (final)

Generate enterprise PDF: ERD diagram, SRS per module, API reference, workflow diagrams (Mermaid), role matrix, voucher posting rules, BD VAT compliance notes, deployment & rollout roadmap.

---

## Execution Strategy

This will span **multiple chat messages** (Lovable per-message limits). Approval flow:

- **This message**: Plan approval only.
- **Next message** (Msg A): Supabase migration (Phase 1 — all 17 tables + RLS).
- **Msg B**: Laravel migrations + Models + Services (Phase 2).
- **Msg C**: Laravel Controllers + Routes + Permissions seeder.
- **Msg D**: Frontend PO + Dispatch pages.
- **Msg E**: VAT Challan + Delivery Challan + Receive pages.
- **Msg F**: Invoice Processing + Payment + TDS pages.
- **Msg G**: Reports.
- **Msg H**: Final PDF documentation + verification script.

After each message you review and say "continue" to proceed.

---

## Safety Guarantees

- Existing `sales_invoices`, `purchases`, `acc_vouchers`, `stock_movements` tables — **NOT modified**
- New invoice flow uses `sales_invoices_v2` (parallel table) — old Sales page keeps working
- All voucher posting goes through existing `AccountingService` — double-entry integrity preserved
- Branch isolation via existing `BranchScope` middleware
- All new permissions default OFF for non-super-admin roles (admin opt-in)
- Reversible: dropping new tables leaves existing ERP fully functional
