## Goal
Replace the four separate tabs (Journal / Payment / Receipt / Contra) on the Accounting Vouchers page with a single unified list. Add a "Type" column showing which voucher kind each row is. The "New Voucher" button opens a small picker to choose which voucher type to create, then opens the existing entry dialog for that type.

No changes to backend, database, posting logic, permissions, or other modules — purely a UI/UX consolidation on `src/pages/accounts/AccountingVouchers.tsx`.

## Changes

### 1. `src/pages/accounts/AccountingVouchers.tsx`
- Remove the `<Tabs>` / `TabsList` / `TabsTrigger` / `TabsContent` wrapping around the voucher table. Keep a single table rendered once.
- Replace `activeTab` semantics with a `typeFilter` state ("all" | "journal" | "payment" | "receipt" | "contra"), rendered as a small Select above the table (defaulting to "all") so users can still narrow down if they want.
- The row list combines all voucher types the user has permission to view (uses existing `allowedTypes` filter).
- Add a **Type** column in the table with a small colored badge (JV / PV / RV / CV) so the voucher kind is instantly visible.
- Search/filter/pagination logic stays the same but now spans all allowed types.
- "New Voucher" button opens a new small dialog listing the four voucher types (only those the user has create permission for via `canCreateForType`). Selecting one sets the "creating type" and opens the existing entry dialog exactly as before.
- Editing / printing / transferring / permission checks continue to use `voucher.voucher_type` (already the case).
- Any place that previously fell back to `activeTab` for the type is switched to require an explicit type (from the picker for create, from the row for edit).

### 2. Route/nav
- No route or sidebar changes. The page stays at its current path; only the internal layout changes.

## Out of scope
- Backend controllers, permissions middleware, voucher posting, reports pages (Journal/Payment/Receipt/Contra reports keep their separate report pages — user only asked about the entry screen).
- Database schema.
- Other modules.

## Risk / safeguards
- Type picker only lists types the user can create — preserves RBAC.
- Edit/delete/restore still resolve permissions off each voucher's own `voucher_type`, unchanged.
- Existing tests (`AccountingVouchers.currbal.test.tsx`, `financial-year-filter.test.ts`) will be re-run; adjust selectors only if they targeted tab elements.

Approve to proceed.