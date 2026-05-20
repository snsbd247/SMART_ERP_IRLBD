## Plan: System Diagnostics & Fixes

### 1. New page: `/admin/diagnostics` (System Health)
A single admin-only page with these cards:

**A. RLS / Permission Check**
- Shows current user: id, username, employee_id, super-admin status
- "Run access test" button — runs a SELECT on each critical table (profiles, acc_vouchers, sales_invoices, employees, audit_log, number_sequences, system_settings, module_settings) and shows ✅/❌ with the exact RLS error if blocked
- Friendly Bangla/English message when 403 is detected: "এই টেবিলে অ্যাক্সেস নেই — RLS policy চেক করুন"

**B. Super Admin Validator**
- Single button: "Validate Super Admin Access"
- Calls `is_super_admin(auth.uid())` via RPC + reads `user_roles` + counts protected rows; displays result card (green/red)

**C. Document Numbering Audit**
- Shows null / duplicate voucher_number counts across acc_vouchers, sales_invoices, purchases, party_payments
- "Auto-fix" button — assigns missing/duplicate numbers using next_number sequence
- Re-sync number_sequences.current_number to MAX(serial) found in data

**D. Vouchers Page Status**
- Quick count of acc_vouchers visible to current user; if 0 while DB has rows → shows "RLS blocking" with one-click "Re-grant is_super_admin EXECUTE" instruction

**E. Backup Health**
- Latest backup row (date, size, status)
- "Run backup now" → invokes `create-backup` edge function
- "Restore latest" → invokes `restore-backup` (with confirm dialog)
- Shows backup_settings (auto, retention, last_auto_backup_at)

### 2. Global RLS-aware toast
Add a small helper `handleSupabaseError(error)` in `src/lib/utils.ts` that detects `permission denied`/`42501`/`PGRST301` and shows a friendly toast: "Permission denied — your role may not have access. Visit System Diagnostics."
Wire it into the existing dashboard + vouchers + general settings + document numbering error handlers (replace bare `toast({ ... description: error.message })`).

### 3. Vouchers page auto-load fix
In `src/pages/accounts/AccountingVouchers.tsx`: when query returns 0 rows AND user is super admin → automatically re-query without the active financial-year filter and surface a banner "Showing all FYs (no active FY filter matched)".

### 4. Audit Log enhancements
`src/pages/admin/AuditLogPage.tsx`:
- Add filters: date range, user (dropdown of profiles), module/action
- Add a synthetic source: include rows where `action ILIKE '%denied%' OR '%403%' OR '%rls%'`
- New "RLS Events" tab filtering audit_log + login_logs failures

### 5. Sidebar/Route
Add `/admin/diagnostics` route + nav link under Administration (super-admin only).

### Technical notes
- All data via existing supabase client; no schema changes needed.
- Auto-fix uses existing `nextNumber()` helper from `src/lib/db-utils.ts`.
- Backup buttons call existing edge functions `create-backup` / `restore-backup`.
- No new tables, no migrations.

### Files to create
- `src/pages/admin/DiagnosticsPage.tsx`
- `src/lib/supabase-errors.ts`

### Files to modify
- `src/App.tsx` (route)
- `src/components/AppSidebar.tsx` (nav item)
- `src/pages/accounts/AccountingVouchers.tsx` (fallback query + banner)
- `src/pages/admin/AuditLogPage.tsx` (filters + RLS tab)
- `src/pages/admin/DocumentNumberingPage.tsx` (use friendly error helper)
- `src/pages/admin/GeneralSettingsPage.tsx` (use friendly error helper)
- `src/pages/Dashboard.tsx` (use friendly error helper)
