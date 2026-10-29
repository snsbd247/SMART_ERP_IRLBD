# Bangladesh VAT Sales Workflow

End-to-end module covering:

```
Purchase Order  →  Dispatch  →  VAT Challan (Mushak 6.3)
   →  Delivery Challan  →  Customer Receive  →  HO Receive
   →  Tax Invoice  →  Payment + TDS  →  Money Receipt (Mushak 6.6)
```

Plus a **Mushak 9.1** monthly VAT return export.

## Quick start

```bash
# 1. Run all migrations (creates workflow tables + RBAC + CoA seed)
php artisan migrate

# 2. Seed a demo customer, two products, and one Purchase Order
php artisan db:seed --class=SalesWorkflowDemoSeeder

# 3. Walk the demo PO through every stage and verify
php artisan sales-workflow:smoke

# Optional: roll the smoke-test data back after verifying
php artisan sales-workflow:smoke --cleanup
```

The smoke command prints a stage-by-stage table and exits non-zero on any failure, so it is safe for CI.

## Permissions

The Phase 5 migration auto-grants any custom role named "Super Admin" or "Admin" full access to the 9 workflow modules:

- `purchase_orders`, `dispatch`, `vat_challan`, `delivery_challan`,
  `customer_receive`, `ho_receive`, `invoice_processing`, `tds_register`,
  `sales_workflow_reports`

For other roles, grant `view / add / edit / delete` per module via Settings → Roles.

## Document prefixes

| Type            | Prefix | Format               |
| --------------- | ------ | -------------------- |
| Purchase Order  | `PO`   | `PO-2026-000123`     |
| Dispatch        | `DSP`  | `DSP-2026-000123`    |
| VAT Challan     | `VCH`  | `VCH-2026-000123`    |
| Delivery Challan| `DC`   | `DC-2026-000123`     |
| Tax Invoice     | `INV`  | `INV-2026-000123`    |
| Money Receipt   | `RCP`  | `RCP-2026-000123`    |
| TDS Entry       | `TDS`  | `TDS-2026-000123`    |

Sequences live in `number_sequences` and reset annually.

## Reports

Available under **Sales Workflow → Reports**:

- AR Aging (0-30 / 31-60 / 61-90 / 90+)
- Collection Report
- Invoice Pending Report
- Invoice Register
- Pending PO Report
- PO vs Dispatch Variance
- Challan Status (issued → invoiced funnel)
- VAT Register
- **Mushak 9.1 Monthly VAT Return** (CSV + Print)

All writes are audit-logged via the app-layer `audit_log` table.
