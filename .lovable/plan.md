## Treasury Information Page (Accounts Menu)

একটা নতুন **standalone** পেজ যেটা শুধু treasury deposit records-এর list মেইনটেন করবে। এটা accounting (CoA, vouchers, ledgers) এর কোন জায়গায় হিট/পোস্ট করবে না — pure record-keeping।

### Scope
- Menu: **Accounts → Treasury Information**
- Route: `/accounts/treasury`
- Permission: `treasury.view/create/edit/delete` (new module, default Super Admin only)
- কোন journal voucher auto-post হবে না, কোন CoA balance change হবে না।

### Entry Types (একই table, `treasury_type` column দিয়ে আলাদা)
1. **Salary TDS** — Employee select (employees dropdown)
2. **Party Bill TDS** — Party select (customer অথবা supplier dropdown)
3. **VAT Treasury** — কোন party reference লাগবে না, শুধু amount + reference

### Fields
```
- treasury_date (DD-MM-YYYY, DatePickerInput)
- treasury_type (enum: salary_tds | party_tds | vat)
- party_kind (employee | customer | supplier | none)
- party_id (nullable UUID — employee/customer/supplier-এর id)
- party_name_snapshot (display fallback)
- challan_no (text, treasury challan/receipt no)
- challan_date (date)
- bank_name (text, কোন bank-এ deposit)
- amount (numeric)
- period_month (text, e.g. "2025-07" — optional, salary/vat-এর জন্য)
- reference_no (text, optional — bill/voucher ref)
- notes (text)
- status (active | cancelled)
- created_by / created_at / updated_at
```

### UI
- Standard ERP list page: search + filter (type, date range, party) + pagination (25/page)
- Add/Edit dialog with conditional fields based on `treasury_type`:
  - Salary TDS → Employee combobox (searchable)
  - Party Bill TDS → Party-kind toggle + Customer/Supplier combobox
  - VAT → no party field
- Actions: View / Edit / Delete (soft, with permission guard)
- Export: CSV + Print (DD-MM-YYYY format using existing `formatDateDMY`)
- Totals footer: count + sum(amount) of current filtered view

### Backend (Laravel + Supabase parallel — same pattern as customers/suppliers)
- New table `treasury_entries` (Supabase migration + matching Laravel migration with `hasColumn` guards)
- New Laravel `TreasuryController` (index/store/show/update/destroy) under `routes/api.php`
- New Eloquent model `TreasuryEntry`
- Supabase RLS: authenticated read/write; service_role full

### Frontend files
- `src/pages/accounts/TreasuryInformationPage.tsx` (new)
- `src/lib/treasury-api.ts` (CRUD wrapper — Supabase + Laravel bridge aware)
- Register route in `src/App.tsx`
- Add sidebar item in `src/components/AppSidebar.tsx` under Accounts group, guarded by `treasury.view`
- Permission seed: add `treasury` module in `NewModulesRbacSeeder.php` + Supabase permissions migration

### Safety / Non-impact guarantees
- **Pure data table** — no triggers, no auto-posting, no CoA dependency, no voucher creation.
- কোন existing module-এর code touch হবে না except:
  - `App.tsx` (one route add)
  - `AppSidebar.tsx` (one menu item add)
  - RBAC seeder (one new module entry)
- Existing accounting/ledger/voucher logic অপরিবর্তিত — treasury records শুধু এই পেজেই দেখা যাবে।
- Reports (Trial Balance, P&L, Balance Sheet, ledgers) কোন ভাবেই treasury data pull করবে না।

### Migration order
1. Supabase migration: `treasury_entries` table + GRANTs + RLS
2. Laravel migration mirror (for VPS mode)
3. RBAC permissions seed
4. Frontend page + route + sidebar
5. Tests: unit (treasury-api), one Playwright smoke (`e2e/treasury.spec.ts`)

---

কাজ শুরু করার আগে confirm করেন:
- **Q1:** Party Bill TDS-এ party হিসেবে কি **Customer + Supplier দুটোই** allow করব, নাকি শুধু Supplier?
- **Q2:** Treasury entries কি **branch-isolated** হবে (branch_id সহ), নাকি company-wide single list?
- **Q3:** VAT entry-এ কি **monthly Mushak reference** (যেমন Mushak-9.1 challan no) আলাদা field হিসেবে রাখব?
- **Q4:** Permission module name `treasury` ঠিক আছে তো? (Super Admin auto-allowed; অন্যদের জন্য Roles page থেকে assign করতে হবে)
