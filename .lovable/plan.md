
## TIN Integration + Treasury TDS Reports — Plan

### 1. Schema changes (Safe Extension Only)

**Supabase migration** (+ matching Laravel migration with `hasColumn` guards):
- `employees.tin_no` — varchar(50), nullable
- `customers.tin_no` — varchar(50), nullable
- `suppliers.tin_no` — varchar(50), nullable
- `treasury_entries.tin_snapshot` — varchar(50), nullable  
  (snapshot at entry-time so historical reports stay correct even if party TIN is later edited)
- `treasury_entries.designation_snapshot` — varchar(150), nullable (for Salary TDS report)
- `treasury_entries.branch_name_snapshot` — varchar(150), nullable (for report Branch column)

All nullable, no defaults required, no FK changes. Existing rows unaffected.

### 2. Forms — TIN input field

- **Employee Add/Edit** (`src/pages/hrm/EmployeesPage.tsx` / employee form dialog): add "TIN Number" text input next to National ID.
- **Customer Add/Edit** (`src/pages/CustomersPage.tsx`): add "TIN" field beside VAT/BIN section.
- **Supplier Add/Edit** (`src/pages/purchase/SuppliersPage.tsx`): add "TIN" field beside `vat_reg_no` / `bin_no`.

Pure presentation additions — no business-logic changes.

### 3. Treasury entry form — auto-fill TIN

`src/pages/accounts/TreasuryInformationPage.tsx`:
- When `treasury_type = salary_tds` and an Employee is selected → fetch `tin_no`, `designation.name`, `branch.name` from the selected employee and populate read-only "TIN", "Designation", "Branch" preview fields. On save, persist them into `tin_snapshot`, `designation_snapshot`, `branch_name_snapshot`.
- When `treasury_type = party_tds` and a Customer/Supplier is selected → fetch `tin_no` + branch (if any), populate read-only TIN preview, save to `tin_snapshot` + `branch_name_snapshot`.
- VAT entries: no change.

Display TIN column in the Treasury list table (after Party Name).

### 4. Reports — separate Salary TDS & Party TDS

New tab/section inside `TreasuryInformationPage.tsx` (or a small `TreasuryReportsPage.tsx`) with two report views, each filterable by date range + month + branch and exportable to CSV + Print (using existing `formatDateDMY` and `downloadCSV`):

**Salary TDS report columns**  
MONTH · CHALLAN NO · CHALLAN DATE · BANK NAME · BRANCH · TIN · EMPLOYEE · DESIGNATION · CHALLAN AMOUNT · TDS AMOUNT

**Party TDS report columns**  
MONTH · CHALLAN NO · CHALLAN DATE · BANK NAME · BRANCH · TIN · PARTY NAME · CHALLAN AMOUNT · TDS AMOUNT

(CHALLAN AMOUNT = the base/bill amount the TDS was deducted from — add an optional `challan_base_amount` numeric column to `treasury_entries` so users can enter it; if left blank, report shows TDS Amount only.)

VAT entries remain in their own existing list/export — untouched.

### 5. Files touched

Frontend (additive):
- `src/pages/hrm/` employee form component — add TIN input
- `src/pages/CustomersPage.tsx` — add TIN input
- `src/pages/purchase/SuppliersPage.tsx` — add TIN input
- `src/pages/accounts/TreasuryInformationPage.tsx` — TIN auto-fill + new report tabs
- `src/lib/treasury-api.ts` — pass through new snapshot fields

Backend:
- 1 Supabase migration (columns + GRANTs unchanged, RLS unchanged)
- 1 Laravel migration mirroring the columns with `hasColumn` guards
- Add new columns to `$fillable` on `Employee`, `Customer`, `Supplier`, `TreasuryEntry` models

### 6. Safety guarantees

- All columns nullable — no data backfill required.
- No accounting / CoA / voucher logic touched.
- No existing report changed; only two new report views added.
- Snapshot columns prevent historical drift if a party TIN is edited later.

---

কনফার্ম করেন:
- **Q1:** `challan_base_amount` (CHALLAN AMOUNT কলামের সোর্স) কি আমি treasury entry form-এ একটা optional field হিসেবে যোগ করব, নাকি `amount`-কেই CHALLAN AMOUNT হিসেবে দেখাব আর TDS AMOUNT আলাদা ভাবে নেব?
- **Q2:** Salary TDS রিপোর্টে "BRANCH" — Employee-এর branch দেখাব, নাকি treasury entry-এর নিজস্ব `branch_id` দেখাব?
- **Q3:** TIN field-এ কোন validation দরকার (যেমন 12-digit numeric Bangladesh e-TIN), নাকি free-text রাখব?
