## পুরো ERP সফটওয়্যার অডিট — ৫ ফেজ প্ল্যান

প্রতিটি ফেজ আলাদা মেসেজে execute হবে। এক ফেজ শেষ → রিপোর্ট + fixes → পরের ফেজ। একসাথে সব করলে token limit এ আটকাবে এবং fixes মিস হবে।

---

### Phase 1 — Schema Integrity (Database Layer)
**লক্ষ্য:** কোন টেবিল/কলাম missing আছে কিনা যাচাই।

- Laravel migrations (`erp-backend/database/migrations/`) থেকে expected schema বের করা
- Frontend code (`src/`) এ যত `from('table_name')` এবং `.select('col')` call আছে সব scan করা
- Backend Controllers/Services এ যত table reference আছে সব scan করা
- দুটো list cross-check → missing tables/columns রিপোর্ট
- Migration লিখে missing গুলো add করা (Safe Extension Only)

---

### Phase 2 — Runtime Errors (Console + Network)
**লক্ষ্য:** Live preview এ login করে main pages ঘুরে console + network errors collect।

Route গুলো visit: Dashboard, Accounting (Vouchers, CoA, Ledger), Sales (Invoice, Customer), Purchase (PO, GRN, Bill), Inventory (Item, Stock), HRM (Employee, Attendance, Payroll), Settings, Reports.

প্রতি route এ:
- Console errors/warnings capture
- 4xx/5xx network requests capture
- Failed asset loads capture
- রিপোর্ট তৈরি → critical fixes apply

---

### Phase 3 — CRUD Operations
**লক্ষ্য:** Add/Edit/Delete/View প্রতি module এ কাজ করছে কিনা।

- প্রতিটা core entity তে dummy create → edit → delete cycle
- Form validation errors যাচাই
- 500 errors যা Phase 2 তে miss হয়েছে সেগুলো ধরা
- Backend `GenericTableController` + module-specific controllers এ error handling

---

### Phase 4 — Business Logic Integrity
**লক্ষ্য:** Cross-module flows ভাঙা আছে কিনা।

- Sales Invoice → auto Journal Voucher → CoA balance
- Purchase Bill → Stock Ledger update → Payable
- Payment → FIFO allocation → Party Ledger
- Payroll → Attendance deduction → Salary calculation
- Stock movements → warehouse_stock sync
- Financial period locks
- Branch isolation middleware

---

### Phase 5 — UI/UX Polish & Permissions
**লক্ষ্য:** Final cleanup।

- Broken layouts, overflow, responsive issues
- Permission middleware mismatches (`settings.view` ধরনের 401 cases)
- Empty states, loading states, toast messages
- Sidebar nav broken links
- Document numbering sequences সব module এ সঠিক কিনা

---

### Approval

"Phase 1 শুরু করো" বললে আমি Phase 1 execute করব এবং findings + fixes দিয়ে রিপোর্ট দেব। তারপর "Phase 2" বললে পরেরটা। চাইলে একাধিক phase একসাথে চালাতে বললেও পারি (তবে token budget এ অর্ধেক phase এ আটকে যেতে পারে)।
