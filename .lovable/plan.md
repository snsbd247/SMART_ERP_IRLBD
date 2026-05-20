# Inventory Module Restructure Plan

আপনার আপলোড করা ছবি অনুযায়ী Inventory module কে তিনটি সেকশনে সাজাবো: **Master**, **Transactions**, এবং **Reports**। নিচে কোন কোন স্ক্রিন/ফিচার বানাতে হবে এবং কোনগুলো ইতিমধ্যে আছে সেটা ম্যাপ করলাম।

## 1. Module Layout (Inventory Landing Page)

নতুন একটি `/inventory` ল্যান্ডিং পেইজ — ৩টি কলাম (Master / Transactions / Reports), প্রতিটি বাটনে ক্লিক করলে রিলেটেড পেইজে যাবে। ঠিক আপলোড করা ছবির মতো বেগুনি হেডার সহ।

## 2. Master Section

| বাটন | Status | কাজ |
|---|---|---|
| Stock Groups | ✅ আছে (ItemCategoriesPage) | লিঙ্ক করব |
| Stock Categories | ✅ আছে | লিঙ্ক করব |
| Stock Items | ✅ আছে (ItemMasterPage) | লিঙ্ক করব |
| Measurement Unit | ✅ আছে (UnitsPage) | লিঙ্ক করব |
| Voucher Types | 🆕 নতুন | Stock voucher type config |
| MFG. Process | 🆕 নতুন | Production process master |
| Batch/Log Entry | 🆕 নতুন | Batch/lot tracking master |

## 3. Transactions Section

| বাটন | Status | কাজ |
|---|---|---|
| Consumption | 🆕 নতুন | কাঁচামাল consumption entry |
| Finished Goods | 🆕 নতুন | Production output entry |
| MFG. Voucher | ✅ আংশিক (ProductionPage) | Refactor + লিঙ্ক |
| Stock Damage | 🆕 নতুন | Damage/loss entry → stock কমাবে |
| Physical Stock | 🆕 নতুন | Physical count → adjustment |
| Stock Transfer | ✅ আছে | লিঙ্ক করব |

## 4. Reports Section

| বাটন | Status |
|---|---|
| Item Master | 🆕 |
| Stock Summary | ✅ (StockReportsPage) |
| Location Summary | 🆕 |
| Voucher Reports | 🆕 |
| Stock Movement | ✅ (StockLedger) |
| Stock Reorder | ✅ আংশিক (LowStockPage) |
| Stock Minimum | 🆕 |
| Slow/Fast Moving | 🆕 |
| Out of Stock | 🆕 |
| Profitability | 🆕 |
| Store Ledger | ✅ (StockLedger) |
| Cost Estimation | 🆕 (BOM-linked) |
| Batch Report | 🆕 |
| Stock Transfer Register | 🆕 |
| MIS Report | 🆕 |

## 5. Database Changes

নতুন টেবিল (Supabase migration):
- `stock_voucher_types` — voucher type config
- `mfg_processes` — manufacturing process master
- `stock_batches` — batch/lot tracking (item_id, batch_no, mfg_date, exp_date, qty)
- `consumption_entries` + items
- `finished_goods_entries` + items
- `stock_damage_entries` + items
- `physical_stock_entries` + items (with system_qty vs counted_qty)

সব transaction টেবিল `stock_movements` এ entry লিখবে যাতে existing Stock Ledger সব সোর্স থেকে ডাটা পায়।

## 6. Flow Fix

- প্রতিটি transaction (consumption, finished goods, damage, physical adjustment, transfer) → অটো stock_movements + warehouse_stock আপডেট
- Number sequencing প্রতিটির জন্য (CONS, FG, DMG, PHY prefix)
- Status: draft / posted / cancelled, posted হওয়ার পরে stock impact
- Reports সব transaction source aggregate করে দেখাবে

## 7. Implementation Order

কাজের পরিমাণ অনেক বড়। আমি ৩ ফেইজে ভাগ করব:

**Phase 1 (এই turn):** Landing page + সব existing পেইজ লিঙ্ক + ৪টি critical transaction (Consumption, Finished Goods, Stock Damage, Physical Stock) — DB migration + UI

**Phase 2:** বাকি Master (Voucher Types, MFG Process, Batch Entry)

**Phase 3:** সব নতুন Reports

---

**প্রশ্ন:** Phase 1 দিয়ে শুরু করব? নাকি অন্য priority আছে (যেমন আগে Reports, পরে Transactions)?
