
## Voucher Type Change (Transfer) — Plan

### Goal
Accounting Vouchers-এ ভুল টাইপে (যেমন Payment) পোস্ট হয়ে যাওয়া ভাওচার-কে আরেক টাইপে (যেমন Journal) "Change/Transfer" করা যাবে। পুরাতন ভাওচার auto-delete হবে এবং তার সিরিয়াল নাম্বার পরবর্তী নতুন এন্ট্রিতে পুনঃব্যবহারযোগ্য (reusable) থাকবে।

### 1. UI (frontend only)
`src/pages/accounts/AccountingVouchers.tsx`-এর row actions-এ নতুন **"Change Type"** বাটন (icon: `ArrowLeftRight`)।
- শুধুমাত্র draft বা approved ভাওচারে দেখাবে, deleted-এ না।
- Permission: `vouchers.edit` + target-type-এর `vouchers.<type>.create` — না থাকলে disabled + tooltip।
- ক্লিকে ছোট Dialog:
  - Current type (read-only), New type dropdown (journal/payment/receipt/contra ছাড়া বাকি সব)।
  - Reason textarea (required, audit log-এ যাবে)।
  - Confirm বাটন → `changeVoucherType(id, newType, reason)` কল।

### 2. Backend flow (Laravel — primary path)
নতুন endpoint: `POST /api/vouchers/{id}/change-type` → `VoucherController@changeType`।

`AccountingService::changeVoucherType($id, $newType, $userId, $reason)`:
1. Load original voucher + entries + branch/FY/date/description/amount।
2. Validate:
   - Voucher exists, status ∈ {draft, approved}, not deleted।
   - newType ∈ allowed types এবং current type থেকে আলাদা।
   - User has permission for both source delete এবং target create।
3. `DB::transaction`-এর ভেতরে:
   a. **Release old number**: `NumberSequenceService::release($oldSeqId, $oldVoucherNumber)` — নিচে দেখুন।
   b. `createVoucher([...same data, voucher_type=newType], entries, autoApprove=wasApproved)` — নতুন type-এর sequence থেকে fresh number নেবে।
   c. পুরাতন voucher-কে **hard delete** (entries cascade)। কারণ soft-delete করলে unique voucher_number conflict এড়ানো সহজ, আর reuse সহজ — নিচে "সিরিয়াল রিলিজ" section দেখুন।
   d. `AuditLog` + `VoucherApprovalHistory` দুইটাতেই লগ: action=`change_type`, before=`{type, number}`, after=`{type, number}`, note=reason।
4. Response: new voucher payload।

### 3. Serial number release / reuse — সবচেয়ে সংবেদনশীল অংশ
`number_sequences` টেবিলে প্রতি type-এর জন্য `current_number` monotonic counter আছে। "সিরিয়াল যেনো পরবর্তী এন্ট্রিতে ব্যবহার হয়" — এর সবচেয়ে নিরাপদ implementation:

**Option A (recommended): Free-list table**
- নতুন লাইট টেবিল `number_sequence_free_list(id, sequence_id, number, released_by, released_at)`।
- Release করলে row insert।
- `NumberSequenceService::next($seqId)` প্রথমে free-list থেকে সবচেয়ে ছোট number pop করবে (FOR UPDATE lock); খালি হলে `current_number`+1 এবং counter increment।
- এতে gap হবে না, পুরাতন Payment number ঠিক পরবর্তী Payment এন্ট্রি পাবে।
- Multi-user safe (row-level lock), existing sequence flow-এ কোনো breaking change নাই।

Frontend-এর `voucher-api.ts`-এ শুধুমাত্র `changeVoucherType()` wrapper যোগ হবে; existing create/edit/delete path অপরিবর্তিত।

### 4. Supabase mode
VPS/Laravel বাদে Supabase mode-ও চালু আছে। ওখানে edge function `voucher-api`-তে একই লজিক port করা হবে — আলাদা migration-এ `number_sequence_free_list` public table তৈরি (GRANT + RLS: শুধু `authenticated` select/insert, service_role all)। Change-type action edge function-এর মাধ্যমে atomic হবে।

### 5. অন্য মডিউলে impact — যা ভাঙবে না
- **Auto-posted vouchers** (Sales invoice → auto Receipt, Purchase → auto Payment ইত্যাদি): "Change Type" UI-তে flag `auto_posted=true` হলে বাটন **hidden**। কারণ auto-posted ভাওচার source document-এর সাথে tied; type বদলালে reconciliation ভাঙবে। (এর জন্য `acc_vouchers`-এ ছোট `source_module` কলাম আগে থেকেই আছে — না থাকলে check করে decide করব।)
- Trial Balance / Ledger / Balance formula: entries অপরিবর্তিত (same debits/credits, same accounts, same date, same amount) — তাই কোনো report drift নাই।
- Approval history: পুরাতন voucher-এর history archive হিসেবে নতুন voucher-এ copy হবে, plus নতুন `change_type` entry।
- Financial year lock: locked FY-এর ভাওচারে Change Type block হবে (existing edit-lock reuse)।
- Soft-delete flow, purge flow, permission matrix — কোনোটা পরিবর্তন হবে না।

### 6. Files to touch (আনুমানিক)
Backend:
- `erp-backend/app/Services/AccountingService.php` — `changeVoucherType()` মেথড।
- `erp-backend/app/Services/NumberSequenceService.php` — `release()` + updated `next()` (free-list first)।
- `erp-backend/app/Http/Controllers/VoucherController.php` — `changeType()` action + permission check।
- `erp-backend/routes/api.php` — নতুন রুট।
- `erp-backend/database/migrations/…_create_number_sequence_free_list.php`।

Frontend:
- `src/pages/accounts/AccountingVouchers.tsx` — row action + dialog।
- `src/lib/voucher-api.ts` — `changeVoucherType()` wrapper (Laravel + Supabase dual path)।
- `src/components/accounts/ChangeVoucherTypeDialog.tsx` (new)।

Supabase:
- 1 migration for `number_sequence_free_list` + GRANT + RLS।
- `supabase/functions/voucher-api/index.ts` — `change-type` handler।

Tests:
- Unit: `NumberSequenceService` free-list pop order + concurrency।
- Feature: change-type happy path + old number reuse + auto-posted block + FY-lock block।
- E2E: create Payment → change to Journal → create new Payment → assert new Payment picks up released number।

### 7. Rollout safety
- Feature flag env `VITE_ENABLE_VOUCHER_TYPE_CHANGE` (default OFF)।
- ON না হলে UI বাটন hide, backend endpoint 403 — কিছু ভাঙবে না।
- Prod-এ backend ও DB deploy → smoke test → flag ON।

---

কনফার্ম করেন এগুলা:
1. **Serial reuse strategy** — free-list approach (recommended) ঠিক আছে, নাকি চান পুরাতন number *পরের যেকোনো* এন্ট্রিতে না গিয়ে *ঠিক পরের change-type action*-এই যাবে?
2. **Auto-posted vouchers** (Sales/Purchase থেকে auto তৈরি হওয়া Receipt/Payment) — Change Type সম্পূর্ণ block, নাকি Super Admin-কে allow?
3. **পুরাতন voucher** — hard delete (recommended, cleaner) নাকি soft-delete + মার্ক "transferred to <new number>"?

কনফার্ম পেলে implement করব।
