<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use App\Models\{Branch, User, CustomRole, RolePermission, FinancialYear, CompanySetting, NumberSequence, ChartOfAccount};

/**
 * Fresh-install seeder.
 *
 * Seeds ONLY the essentials required for first login:
 *   - 1 Branch (FK target for users)
 *   - Roles + Role Permissions (Super Admin, Staff, Accountant, HR Manager, Employee)
 *   - Super Admin user  (admin / Admin@123, employee_id = NULL)
 *   - 1 active Financial Year + Company Settings + Number Sequences
 *   - Bangladesh-standard Chart of Accounts
 *
 * No transactional or master data (no items, employees, suppliers, customers,
 * vouchers, invoices, payroll, etc.). All operational data is created by the
 * user from the UI.
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // ---------- 1. Default Branch ----------
        $branch = Branch::create([
            'code' => 'HQ',
            'name' => 'Head Office',
            'phone' => '',
            'address' => '',
        ]);

        // ---------- 2. Roles & Permissions ----------
        $allModules = [
            // Core
            'dashboard', 'messaging',
            // Accounting
            'accounts', 'journal', 'payment', 'receipt', 'contra',
            // Business
            'sales', 'purchase', 'customers', 'suppliers', 'inventory', 'manufacturing', 'bank',
            // HRM
            'hrm', 'employees', 'attendance', 'leave', 'payroll', 'portal',
            // Reports
            'reports',
            // Administration
            'branches', 'users', 'roles', 'financial_years',
            'settings', 'audit_log', 'backup',
            'sms', 'branding', 'shortcuts', 'document_numbering', 'modules',
        ];

        $superAdmin = CustomRole::create(['name' => 'Super Admin', 'description' => 'Full system access']);
        foreach ($allModules as $mod) {
            RolePermission::create([
                'custom_role_id' => $superAdmin->id, 'module' => $mod,
                'can_view' => 1, 'can_add' => 1, 'can_edit' => 1, 'can_delete' => 1,
            ]);
        }

        $staff = CustomRole::create(['name' => 'Staff', 'description' => 'Standard staff access']);
        foreach (['dashboard', 'messaging', 'accounts', 'journal', 'payment', 'receipt', 'contra', 'sales', 'purchase', 'customers', 'suppliers', 'inventory', 'reports', 'portal'] as $mod) {
            RolePermission::create(['custom_role_id' => $staff->id, 'module' => $mod, 'can_view' => 1, 'can_add' => 1, 'can_edit' => 1, 'can_delete' => 0]);
        }

        $accountant = CustomRole::create(['name' => 'Accountant', 'description' => 'Accounting and finance access']);
        foreach (['dashboard', 'messaging', 'accounts', 'journal', 'payment', 'receipt', 'contra', 'bank', 'customers', 'suppliers', 'reports', 'portal'] as $mod) {
            RolePermission::create(['custom_role_id' => $accountant->id, 'module' => $mod, 'can_view' => 1, 'can_add' => 1, 'can_edit' => 1, 'can_delete' => 0]);
        }

        $hrManager = CustomRole::create(['name' => 'HR Manager', 'description' => 'HRM, attendance and payroll access']);
        foreach (['dashboard', 'messaging', 'hrm', 'employees', 'attendance', 'leave', 'payroll', 'portal', 'reports'] as $mod) {
            RolePermission::create(['custom_role_id' => $hrManager->id, 'module' => $mod, 'can_view' => 1, 'can_add' => 1, 'can_edit' => 1, 'can_delete' => 0]);
        }

        $employee = CustomRole::create(['name' => 'Employee', 'description' => 'Self-service portal access only']);
        foreach (['dashboard', 'messaging', 'portal'] as $mod) {
            RolePermission::create(['custom_role_id' => $employee->id, 'module' => $mod, 'can_view' => 1, 'can_add' => 0, 'can_edit' => 0, 'can_delete' => 0]);
        }

        // ---------- 3. Super Admin user ----------
        $admin = User::create([
            'username' => 'admin',
            'name' => 'System Administrator',
            'email' => 'admin@erp.com',
            'password' => Hash::make('Admin@123'),
            'branch_id' => $branch->id,
            'employee_id' => null, // NULL = Super Admin (bypasses RBAC + branch isolation)
        ]);
        $admin->roles()->attach($superAdmin->id);

        // ---------- 4. Financial Year + Company Settings + Number Sequences ----------
        $fy = FinancialYear::create([
            'name' => 'FY 2025-2026',
            'start_date' => '2025-07-01',
            'end_date'   => '2026-06-30',
            'is_active'  => 1,
        ]);

        CompanySetting::updateOrCreate(['id' => 'default'], [
            'company_name' => 'My Company',
            'currency_code' => 'BDT',
            'currency_symbol' => '৳',
            'currency_name' => 'Bangladeshi Taka',
            'default_branch_id' => $branch->id,
            'default_financial_year_id' => $fy->id,
        ]);

        $sequences = [
            ['id' => 'sales_invoice',    'prefix' => 'INV', 'description' => 'Sales Invoice'],
            ['id' => 'purchase',         'prefix' => 'PUR', 'description' => 'Purchase'],
            ['id' => 'sales_return',     'prefix' => 'SRN', 'description' => 'Sales Return'],
            ['id' => 'purchase_return',  'prefix' => 'PRN', 'description' => 'Purchase Return'],
            ['id' => 'production',       'prefix' => 'PRD', 'description' => 'Production'],
            ['id' => 'stock_transfer',   'prefix' => 'STR', 'description' => 'Stock Transfer'],
            ['id' => 'journal_voucher',  'prefix' => 'JV',  'description' => 'Journal Voucher'],
            ['id' => 'payment_voucher',  'prefix' => 'PV',  'description' => 'Payment Voucher'],
            ['id' => 'receipt_voucher',  'prefix' => 'RV',  'description' => 'Receipt Voucher'],
            ['id' => 'contra_voucher',   'prefix' => 'CV',  'description' => 'Contra Voucher'],
            // New purchase workflow (PR → PO → GRN → Bill → Payment)
            ['id' => 'purchase_requisition', 'prefix' => 'PR',  'description' => 'Purchase Requisition'],
            ['id' => 'purchase_order_v2',    'prefix' => 'PO',  'description' => 'Purchase Order (Workflow)'],
            ['id' => 'grn',                  'prefix' => 'GRN', 'description' => 'Goods Receipt Note'],
            ['id' => 'purchase_bill',        'prefix' => 'BILL','description' => 'Purchase Bill'],
            ['id' => 'bill_payment',         'prefix' => 'BP',  'description' => 'Bill Payment'],
        ];
        foreach ($sequences as $s) {
            NumberSequence::create(array_merge($s, ['current_number' => 0, 'year' => 2026]));
        }

        // ---------- 5. Chart of Accounts (Bangladesh standard) ----------
        $accounts = [
            // [code, name, type, parentCode]
            ['1000', 'Assets', 'asset', null],
            ['1100', 'Current Assets', 'asset', '1000'],
            ['1101', 'Cash in Hand', 'asset', '1100'],
            ['1102', 'Bank Account', 'asset', '1100'],
            // Default child bank accounts (so Bank Accounts page is never empty)
            ['1111', 'EBL Current A/C - 1234567890', 'asset', '1102'],
            ['1112', 'City Bank Current A/C - 9988776655', 'asset', '1102'],
            ['1113', 'BRAC Bank Savings A/C - 4455667788', 'asset', '1102'],
            ['1114', 'HSBC USD A/C - 0011223344', 'asset', '1102'],
            ['1103', 'Accounts Receivable', 'asset', '1100'],
            ['1104', 'Advance to Supplier', 'asset', '1100'],
            ['1105', 'Inventory', 'asset', '1100'],
            ['1106', 'Prepaid Expenses', 'asset', '1100'],
            ['1107', 'TDS Receivable', 'asset', '1100'],
            ['1200', 'Fixed Assets', 'asset', '1000'],
            ['1201', 'Furniture & Fixtures', 'asset', '1200'],
            ['1202', 'Office Equipment', 'asset', '1200'],
            ['1203', 'Vehicles', 'asset', '1200'],
            ['1204', 'Building', 'asset', '1200'],
            ['1205', 'Accumulated Depreciation', 'asset', '1200'],
            ['2000', 'Liabilities', 'liability', null],
            ['2100', 'Current Liabilities', 'liability', '2000'],
            ['2101', 'Accounts Payable', 'liability', '2100'],
            ['2102', 'Supplier Payable', 'liability', '2100'],
            ['2103', 'Accrued Expenses', 'liability', '2100'],
            ['2104', 'VAT Payable', 'liability', '2100'],
            ['2105', 'Loan Payable (Short Term)', 'liability', '2100'],
            ['2106', 'Provident Fund Liability', 'liability', '2100'],
            ['2107', 'Savings Fund Liability', 'liability', '2100'],
            ['2200', 'Long-Term Liabilities', 'liability', '2000'],
            ['2201', 'Bank Loan', 'liability', '2200'],
            ['2202', 'Directors Loan', 'liability', '2200'],
            ['3000', 'Equity', 'equity', null],
            ['3101', 'Owner Capital', 'equity', '3000'],
            ['3102', 'Retained Earnings', 'equity', '3000'],
            ['3103', 'Drawings', 'equity', '3000'],
            ['4000', 'Income', 'income', null],
            ['4101', 'Sales Revenue', 'income', '4000'],
            ['4102', 'Service Income', 'income', '4000'],
            ['4103', 'Other Income', 'income', '4000'],
            ['4104', 'Discount Received', 'income', '4000'],
            ['4105', 'Sales Return', 'income', '4000'],
            ['5000', 'Expenses', 'expense', null],
            ['5100', 'Direct Expenses', 'expense', '5000'],
            ['5101', 'Purchase', 'expense', '5100'],
            ['5102', 'Cost of Goods Sold', 'expense', '5100'],
            ['5103', 'Purchase Return', 'expense', '5100'],
            ['5200', 'Operating Expenses', 'expense', '5000'],
            ['5201', 'Salary Expense', 'expense', '5200'],
            ['5202', 'Rent Expense', 'expense', '5200'],
            ['5203', 'Utility Bills', 'expense', '5200'],
            ['5204', 'Office Expense', 'expense', '5200'],
            ['5205', 'Transportation', 'expense', '5200'],
            ['5206', 'Marketing Expense', 'expense', '5200'],
            ['5207', 'Internet Bill', 'expense', '5200'],
            ['5208', 'Maintenance Expense', 'expense', '5200'],
            ['5209', 'Provident Fund Expense', 'expense', '5200'],
            ['5210', 'Savings Fund Expense', 'expense', '5200'],
            ['5300', 'Financial Expenses', 'expense', '5000'],
            ['5301', 'Bank Charge', 'expense', '5300'],
            ['5302', 'Interest Expense', 'expense', '5300'],
            ['6000', 'VAT & TAX', 'liability', null],
            ['6101', 'Input VAT', 'asset', '6000'],
            ['6102', 'Output VAT', 'liability', '6000'],
        ];

        $parentMap = [];
        foreach ($accounts as [$code, $name, $type, $parentCode]) {
            $acct = ChartOfAccount::create([
                'account_code' => $code,
                'account_name' => $name,
                'account_type' => $type,
                'parent_id'    => $parentCode ? ($parentMap[$parentCode] ?? null) : null,
            ]);
            $parentMap[$code] = $acct->id;
        }

        // ---------- 6. Module Settings (all enabled by default) ----------
        $modules = [
            ['inventory',       'Inventory'],
            ['multi_warehouse', 'Multi Warehouse'],
            ['multi_branch',    'Multi Branch'],
            ['hrm',             'HRM'],
            ['accounts',        'Accounts'],
            ['bank',            'Bank'],
            ['purchase',        'Purchase'],
            ['sales',           'Sales'],
            ['sales_basic',     'Sales (Basic)'],
            ['sales_vat',       'Sales (BD VAT Workflow)'],
            ['reports',         'Reports'],
            ['manufacturing',   'Manufacturing'],
        ];
        $now = now();
        foreach ($modules as [$key, $name]) {
            DB::table('module_settings')->insertOrIgnore([
                'id'          => (string) Str::uuid(),
                'module_key'  => $key,
                'module_name' => $name,
                'is_enabled'  => 1,
                'updated_by'  => null,
                'created_at'  => $now,
                'updated_at'  => $now,
            ]);
        }

        // ---------- 7. Extra Number Sequences (BD VAT workflow) ----------
        // These mirror what the BD VAT migration seeds; insertOrIgnore makes it idempotent.
        $extraSequences = [
            ['id' => 'purchase_order',  'prefix' => 'PO',  'description' => 'Customer Purchase Order'],
            ['id' => 'vat_challan',     'prefix' => 'VCH', 'description' => 'VAT Challan (Mushak 6.3)'],
            ['id' => 'delivery_challan','prefix' => 'DC',  'description' => 'Delivery Challan'],
            ['id' => 'sales_invoice_v2','prefix' => 'INV', 'description' => 'Consolidated Sales Invoice'],
            ['id' => 'invoice_payment', 'prefix' => 'RCP', 'description' => 'Invoice Payment Receipt'],
            ['id' => 'tds_entry',       'prefix' => 'TDS', 'description' => 'TDS Entry'],
        ];
        foreach ($extraSequences as $s) {
            DB::table('number_sequences')->insertOrIgnore(array_merge($s, [
                'current_number' => 0,
                'year' => 2026,
            ]));
        }

        // ---------- 8. Demo Page Shortcuts (keyboard quick-jump codes for every main page) ----------
        $shortcuts = [
            // General
            ['DASH', 'Dashboard', '/', 'general'],
            ['VCS', 'All Vouchers', '/vouchers', 'accounts'],
            ['MSG', 'Messaging', '/messaging', 'messaging'],
            ['PROF', 'My Profile', '/profile', 'general'],
            // Accounts
            ['COA', 'Chart of Accounts', '/accounts/chart', 'accounts'],
            ['AV', 'Accounting Vouchers', '/accounts/vouchers', 'accounts'],
            ['JV', 'Journal Vouchers', '/accounts/vouchers?tab=jv', 'accounts'],
            ['PV', 'Payment Vouchers', '/accounts/vouchers?tab=pv', 'accounts'],
            ['RV', 'Receipt Vouchers', '/accounts/vouchers?tab=rv', 'accounts'],
            ['CV', 'Contra Vouchers', '/accounts/vouchers?tab=cv', 'accounts'],
            // Sales
            ['SAL', 'Sales Invoices', '/sales', 'sales'],
            ['SR', 'Sales Returns', '/sales/returns', 'sales'],
            ['CUS', 'Customers', '/customers', 'customers'],
            // Purchase
            ['PUR', 'Purchases', '/purchase', 'purchase'],
            ['PR', 'Purchase Returns', '/purchase/returns', 'purchase'],
            // New purchase workflow shortcuts
            ['PREQ', 'Requisitions', '/purchase/requisitions', 'purchase'],
            ['PPO',  'Purchase Orders', '/purchase/orders', 'purchase'],
            ['GRN',  'Goods Receipts', '/purchase/grns', 'purchase'],
            ['BILL', 'Purchase Bills', '/purchase/bills', 'purchase'],
            ['SUP', 'Suppliers', '/suppliers', 'suppliers'],
            // Inventory
            ['INV', 'Inventory', '/inventory', 'inventory'],
            ['ITM', 'Items', '/inventory/items', 'inventory'],
            ['CAT', 'Categories', '/inventory/categories', 'inventory'],
            ['SG', 'Stock Groups', '/inventory/stock-groups', 'inventory'],
            ['ICH', 'Inventory Chart', '/inventory/chart', 'inventory'],
            ['UNT', 'Units', '/inventory/units', 'inventory'],
            ['WH', 'Warehouses', '/inventory/warehouses', 'inventory'],
            ['TRF', 'Stock Transfers', '/inventory/transfers', 'inventory'],
            ['ADJ', 'Stock Adjustments', '/inventory/adjustments', 'inventory'],
            ['SL', 'Stock Ledger', '/inventory/stock-ledger', 'inventory'],
            ['PRDS', 'Products', '/products', 'inventory'],
            // Manufacturing
            ['MAT', 'Raw Materials', '/manufacturing/materials', 'manufacturing'],
            ['BOM', 'Bill of Materials', '/manufacturing/bom', 'manufacturing'],
            ['PROD', 'Production', '/manufacturing/production', 'manufacturing'],
            ['MFR', 'Manufacturing Reports', '/manufacturing/reports', 'manufacturing'],
            // Bank
            ['BNK', 'Bank Accounts', '/bank/accounts', 'bank'],
            ['CB', 'Cash Book', '/bank/cashbook', 'bank'],
            // HRM
            ['HRD', 'HRM Dashboard', '/hrm/dashboard', 'hrm'],
            ['EMP', 'Employees', '/hrm/employees', 'employees'],
            ['DEP', 'Departments', '/hrm/departments', 'hrm'],
            ['HSC', 'Sections', '/hrm/sections', 'hrm'],
            ['DES', 'Designations', '/hrm/designations', 'hrm'],
            ['SHF', 'Shifts', '/hrm/shifts', 'hrm'],
            ['ATT', 'Attendance', '/hrm/attendance', 'attendance'],
            ['BIO', 'Biometric Devices', '/hrm/biometric', 'attendance'],
            ['FAR', 'Face Attendance', '/hrm/face-attendance', 'attendance'],
            ['OT', 'Overtime', '/hrm/overtime', 'attendance'],
            ['LV', 'Leave', '/hrm/leave', 'leave'],
            ['PAY', 'Payroll', '/hrm/payroll', 'payroll'],
            ['FND', 'Funds', '/hrm/funds', 'payroll'],
            ['HDOC', 'Employee Documents', '/hrm/documents', 'hrm'],
            ['IDC', 'ID Cards', '/hrm/id-cards', 'hrm'],
            ['HRR', 'HRM Reports', '/hrm/reports', 'reports'],
            ['LA', 'Login Activity', '/hrm/login-activity', 'hrm'],
            // Portal
            ['PD', 'My Dashboard', '/portal/dashboard', 'portal'],
            ['PP', 'My Portal Profile', '/portal/profile', 'portal'],
            ['PA', 'My Attendance', '/portal/attendance', 'portal'],
            ['PL', 'My Leave', '/portal/leave', 'portal'],
            ['PS', 'My Payslips', '/portal/payslips', 'portal'],
            ['PDOC', 'My Documents', '/portal/documents', 'portal'],
            // Reports
            ['RFIN', 'Financial Reports', '/reports/financial', 'reports'],
            ['RFS', 'Financial Summary', '/reports/financial-summary', 'reports'],
            ['RTB', 'Trial Balance', '/reports/trial-balance', 'reports'],
            ['RCAV', 'CoA Vertical', '/reports/chart-of-accounts-vertical', 'reports'],
            ['RIFRS', 'IFRS Statements', '/reports/ifrs-financial-statements', 'reports'],
            ['RPL', 'Profit & Loss', '/reports/profit-loss', 'reports'],
            ['RBS', 'Balance Sheet', '/reports/balance-sheet', 'reports'],
            ['RGL', 'General Ledger', '/reports/general-ledger', 'reports'],
            ['RAL', 'Account Ledger', '/reports/account-ledger', 'reports'],
            ['RPLG', 'Party Ledger', '/reports/party-ledger', 'reports'],
            ['RCB', 'Cash Book Report', '/reports/cash-book', 'reports'],
            ['RBB', 'Bank Book', '/reports/bank-book', 'reports'],
            ['RBR', 'Bank Reconciliation', '/reports/bank-reconciliation', 'reports'],
            ['RJV', 'Journal Voucher Report', '/reports/journal-vouchers', 'reports'],
            ['RPVR', 'Payment Voucher Report', '/reports/payment-vouchers', 'reports'],
            ['RRV', 'Receipt Voucher Report', '/reports/receipt-vouchers', 'reports'],
            ['RCV', 'Contra Voucher Report', '/reports/contra-vouchers', 'reports'],
            ['RAR', 'Accounts Receivable', '/reports/accounts-receivable', 'reports'],
            ['RARA', 'AR Aging', '/reports/ar-aging', 'reports'],
            ['RIA', 'Income Analysis', '/reports/income-analysis', 'reports'],
            ['RAP', 'Accounts Payable', '/reports/accounts-payable', 'reports'],
            ['RAPA', 'AP Aging', '/reports/ap-aging', 'reports'],
            ['REA', 'Expense Analysis', '/reports/expense-analysis', 'reports'],
            ['RSL', 'Stock Ledger Report', '/reports/stock-ledger', 'reports'],
            ['RSR', 'Stock Reports', '/reports/stock-reports', 'reports'],
            ['RSBG', 'Stock by Group', '/reports/stock-by-group', 'reports'],
            ['RLS', 'Low Stock', '/reports/low-stock', 'reports'],
            ['RCS', 'Customer Statement', '/reports/customer-statement', 'reports'],
            ['RSAL', 'Sales Report', '/reports/sales', 'reports'],
            ['RPUR', 'Purchase Report', '/reports/purchase', 'reports'],
            // Admin
            ['USR', 'Users', '/admin/users', 'users'],
            ['ROL', 'Roles', '/admin/roles', 'roles'],
            ['BRN', 'Branches', '/admin/branches', 'branches'],
            ['FY', 'Financial Years', '/admin/financial-years', 'financial_years'],
            ['AUD', 'Audit Log', '/admin/audit-log', 'audit_log'],
            ['BAK', 'Backup', '/admin/backup', 'backup'],
            ['SET', 'Settings', '/admin/settings', 'settings'],
            ['NUM', 'Document Numbering', '/admin/numbering', 'document_numbering'],
            ['SC', 'Page Shortcuts', '/admin/shortcuts', 'shortcuts'],
            ['BRD', 'Branding', '/admin/branding', 'branding'],
            ['SMS', 'SMS Settings', '/admin/sms', 'sms'],
            ['DIA', 'Diagnostics', '/admin/diagnostics', 'settings'],
            ['IM', 'IFRS Mapping', '/admin/ifrs-mapping', 'settings'],
            // Sales (BD VAT)
            ['PO', 'Purchase Orders', '/sales-workflow/po', 'sales'],
            ['VCH', 'VAT Challan (6.3)', '/sales-workflow/vat-challan', 'sales'],
            ['DC', 'Delivery Challan', '/sales-workflow/delivery-challan', 'sales'],
            ['CRV', 'Customer Receive', '/sales-workflow/customer-receive', 'sales'],
            ['HRV', 'HO Receive', '/sales-workflow/ho-receive', 'sales'],
            ['IQ', 'Invoice Queue', '/sales-workflow/invoice-queue', 'sales'],
            ['SWI', 'Sales Invoices (V2)', '/sales-workflow/invoices', 'sales'],
            ['TDS', 'TDS Entries', '/sales-workflow/tds', 'sales'],
            ['SWR', 'Sales Workflow Reports', '/sales-workflow/reports', 'reports'],
            ['RPVC', 'PO vs VAT Challan', '/sales-workflow/reports/po-vs-vat-challan', 'reports'],
            ['RPPO', 'Pending PO', '/sales-workflow/reports/pending-po', 'reports'],
            ['RCST', 'Challan Status', '/sales-workflow/reports/challan-status', 'reports'],
            ['RVR', 'VAT Register', '/sales-workflow/reports/vat-register', 'reports'],
            ['RIR', 'Invoice Register', '/sales-workflow/reports/invoice-register', 'reports'],
            ['RIP', 'Invoice Pending', '/sales-workflow/reports/invoice-pending', 'reports'],
            ['RCOL', 'Collection Report', '/sales-workflow/reports/collection', 'reports'],
            ['RAGE', 'Aging Report', '/sales-workflow/reports/aging', 'reports'],
            ['M91', 'Mushak 9.1', '/sales-workflow/reports/mushak-9-1', 'reports'],
        ];
        foreach ($shortcuts as [$code, $name, $url, $module]) {
            DB::table('page_shortcuts')->updateOrInsert(
                ['shortcut_code' => $code],
                [
                    'id'          => (string) Str::uuid(),
                    'page_name'   => $name,
                    'page_url'    => $url,
                    'module_name' => $module,
                    'is_active'   => 1,
                    'created_at'  => $now,
                    'updated_at'  => $now,
                ]
            );
        }

        // ---------- 9. Demo Configuration Bundle ----------
        // Imports CoA upgrades, IFRS mapping, extra roles/permissions,
        // additional document numbering, and page shortcuts from
        // database/seeders/data/demo_config_seed.json. Idempotent.
        $this->call(DemoConfigSeeder::class);
    }
}


