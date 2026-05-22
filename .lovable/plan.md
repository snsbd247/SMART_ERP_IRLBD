## লক্ষ্য

বর্তমানে frontend sidebar, ModuleContext, RolesPage `MODULES` list, Laravel routes এবং DatabaseSeeder এর module/permission key গুলো একে অপরের সাথে পুরোপুরি sync নাই। কিছু feature আছে কিন্তু permission key নেই (যেমন messaging, sms, branding, shortcuts, document_numbering, employee portal, financial_summary report ইত্যাদি), আবার কিছু আছে permission key কিন্তু menu/route এ ব্যবহার হচ্ছে না। এই কাজে সব এক জায়গায় normalize করা হবে।

## কী আপডেট হবে

### ১. Canonical Module List (lowercase, একটাই source of truth)

```text
Core:          dashboard, messaging
Accounting:    accounts, journal, payment, receipt, contra
Business:      sales, purchase, customers, suppliers, inventory,
               manufacturing, bank
HRM:           hrm, attendance, leave, payroll, employees, portal
Reports:       reports
Administration: branches, users, roles, financial_years, settings,
                audit_log, backup, sms, branding, shortcuts,
                document_numbering, modules
```

### ২. Frontend

- `src/pages/admin/RolesPage.tsx` — `MODULES` list উপরের canonical list এ আপডেট, groups সহ।
- `src/components/AppSidebar.tsx` — প্রত্যেক menu item এ সঠিক `permission` key বসানো (customers→customers.view, suppliers→suppliers.view, messaging→messaging.view, ইত্যাদি)। বর্তমানে `sales.view` দিয়ে customers protected, সেটা আলাদা করা।
- `src/contexts/ModuleContext.tsx` — `ModuleKey` type এ existing key গুলো রাখা (এগুলো module on/off toggle, permission না)। প্রয়োজন হলে `messaging`, `portal` যোগ করা যাবে।
- `src/components/ProtectedRoute.tsx` — কোনো logic change নেই, শুধু verify।
- `src/App.tsx` route গুলোতে `requiredPermission` ঠিক module key এর সাথে মেলানো।

### ৩. Backend (Laravel `erp-backend`)

- `database/seeders/DatabaseSeeder.php` — `$allModules` array কে canonical list এ আপডেট। Super Admin সব permission পাবে। Staff role এ business + reports view/add/edit, no delete। নতুন `Accountant` ও `HR Manager` preset role যোগ করা।
- `routes/api.php` — নতুন module key গুলোর জন্য missing route middleware বসানো (customers.*, suppliers.*, messaging.*, portal.* ইত্যাদি)। Existing `sales.view` দিয়ে customers protected ছিল → আলাদা করা।
- `app/Models/User.php` `hasPermission` এ action map ইতিমধ্যে আছে — শুধু verify।

### ৪. Live database sync (এই project এর Supabase)

Migration দিয়ে existing `Super Admin` role এ canonical list এর সব module row ensure করা হবে (INSERT … ON CONFLICT DO NOTHING)। কোনো existing data delete হবে না।

## ডেলিভারেবল

1. Updated `src/pages/admin/RolesPage.tsx` (MODULES list)
2. Updated `src/components/AppSidebar.tsx` (per-item permission keys)
3. Updated `erp-backend/database/seeders/DatabaseSeeder.php` (canonical modules + Accountant + HR Manager roles)
4. Updated `erp-backend/routes/api.php` (new permission middlewares)
5. একটি Supabase migration যাতে live Super Admin role এর permission rows complete থাকে

## যা পরিবর্তন হবে না

- কোনো table schema বদল হবে না, business logic বদল হবে না।
- Existing custom roles আগের মতই থাকবে — শুধু RolesPage এ নতুন module গুলো এখন থেকে toggle করা যাবে।
- Super Admin (employee_id = NULL) এর behavior অপরিবর্তিত।
