# Period-Opening Unification Plan

## Goal
One single source of truth (`computePeriodOpening`) used by every ledger view, the Customer Statement (screen + print + Excel), and the Customer Profile. Add a drilldown that explains the opening number, plus a regression test covering the IFIC Bank July→August carry-forward case.

## 1. New data-layer helper — `src/lib/period-opening.ts`
- `computeAccountPeriodOpening({ accountId, dateFrom, branchId?, statuses? })`
  - Returns `{ opening: number, priorEntries: PriorEntry[], baseOpening: number }`.
  - Loads the account's base `opening_balance` + `opening_balance_type` from `chart_of_accounts`.
  - Calls `fetchAllVoucherEntries` for `[1900-01-01 .. dateFrom-1]` and applies `applyEntry` (Closing = Opening + Credit − Debit).
- `computeCustomerPeriodOpening({ customerId, dateFrom })`
  - Sums invoices (debit) − payments (credit) − returns (credit) strictly before `dateFrom`.
  - Returns `{ opening, priorRows }`.
- Both helpers respect existing ledger formula; no Dr/Cr suffix.

## 2. Consumer refactors
- `AccountLedgerReport.tsx` → already uses inline logic; replace with helper, pass `priorEntries` to drilldown.
- `GeneralLedgerReport.tsx`, `CashBookReport.tsx`, `BankBookReport.tsx` → swap `signedOpeningBalance(acc.opening_balance,…)` for `computeAccountPeriodOpening`. For Cash/Bank these aggregate over multiple accounts — loop the helper and sum.
- `CustomerStatementPage.tsx`:
  - Compute `periodOpening` via `computeCustomerPeriodOpening`.
  - Render an "Opening Balance" row at the top of the table.
  - Running balance starts from `periodOpening`.
  - Excel + print (`printRef`) include the same opening row → automatic parity.
- `CustomerProfilePage.tsx`: same helper for the ledger card so the on-screen number matches the statement.

## 3. Opening-line drilldown
- `src/components/accounts/OpeningDrilldownDialog.tsx`
  - Props: `open`, `onOpenChange`, `title`, `baseOpening`, `priorEntries[]` (date, ref, debit, credit, running).
  - Renders a compact table showing how the base opening + each prior transaction roll into the period opening.
- Wire as a button/icon on the Opening Balance row in `AccountLedgerReport` and `CustomerStatementPage` (other ledgers reuse if trivial).

## 4. Regression test
- `src/pages/reports/__tests__/customer-statement-opening.test.ts`
  - Mocks Supabase responses for IFIC Bank (`account_code` "1025178216121") with July transactions yielding a negative closing.
  - Asserts `computeAccountPeriodOpening({ dateFrom: "2025-08-01" })` returns the July closing.
  - Asserts negative carry through (no sign flip).
- `src/lib/__tests__/period-opening.test.ts` — unit tests for both helpers (positive, negative, no prior entries, branch filter).

## 5. Verification
- Run `vitest` for new tests.
- Manual: open Account Ledger for IFIC Bank with August date range; confirm opening = July closing and drilldown lists July entries.

## Technical notes
- Reuses `fetchAllVoucherEntries` so Supabase/Laravel parity is preserved.
- Day-before calculation uses UTC arithmetic to avoid TZ off-by-one (existing pattern in `AccountLedgerReport`).
- Branch filter is passed through so multi-branch reports stay consistent.
- No DB migrations.

## Files touched
- Added: `src/lib/period-opening.ts`, `src/lib/__tests__/period-opening.test.ts`, `src/components/accounts/OpeningDrilldownDialog.tsx`, `src/pages/reports/__tests__/customer-statement-opening.test.ts`.
- Edited: `AccountLedgerReport.tsx`, `GeneralLedgerReport.tsx`, `CashBookReport.tsx`, `BankBookReport.tsx`, `CustomerStatementPage.tsx`, `CustomerProfilePage.tsx`.
