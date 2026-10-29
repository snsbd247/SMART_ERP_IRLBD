<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\ChartOfAccount;

/**
 * Chart of Accounts seeder for IR Limited
 * Source: Independent Auditor's Report (Ahsan Manzur & Co.) AY 2025-2026
 *
 * Structure (4-digit Bangladesh standard):
 *  1xxx Assets   2xxx Liabilities   3xxx Equity   4xxx Income   5xxx COGS   6xxx Expenses
 *
 * Idempotent: uses account_code (unique) — re-run safe.
 * Financial statement note heads are created as ledger heads; opening balances stay zero.
 */
class IRLimitedCoASeeder extends Seeder
{
    public function run(): void
    {
        // [code, name, type, parent_code|null, note_balance, normal_balance_type]
        $accounts = [
            // ============ 1000 ASSETS ============
            ['1000', 'Assets', 'asset', null, 0, 'debit'],

            // ----- 1100 Non-Current Assets -----
            ['1100', 'Non-Current Assets', 'asset', '1000', 0, 'debit'],
            ['1101', 'Property, Plant & Equipment', 'asset', '1100', 50983015, 'debit'],
            ['1102', 'Intangible Assets - ERP Software', 'asset', '1100', 300348, 'debit'],
            ['1103', 'Deferred Tax Assets', 'asset', '1100', 1638120, 'debit'],

            // ----- 1200 Current Assets -----
            ['1200', 'Current Assets', 'asset', '1000', 0, 'debit'],

            // 1210 Inventories
            ['1210', 'Inventories', 'asset', '1200', 0, 'debit'],
            ['1211', 'Raw Materials',                  'asset', '1210', 4514202, 'debit'],
            ['1212', 'Work-in-Progress',               'asset', '1210', 401550,  'debit'],
            ['1213', 'Finished Goods',                 'asset', '1210', 3613948, 'debit'],
            ['1214', 'Raw Material in Transit (PVC)',  'asset', '1210', 360598,  'debit'],
            ['1215', 'Spare Parts & Others',           'asset', '1210', 1429795, 'debit'],

            ['1220', 'Advance Income Tax', 'asset', '1200', 14025298, 'debit'],

            // 1230 Advance, Deposit & Prepayments
            ['1230', 'Advance, Deposit & Prepayments', 'asset', '1200', 0, 'debit'],
            ['1231', 'Demand Note for Power, BG for Gas', 'asset', '1230', 1713021, 'debit'],
            ['1232', 'L/C Margin',                        'asset', '1230', 948212,  'debit'],
            ['1233', 'Advance with Employee',             'asset', '1230', 292802,  'debit'],
            ['1234', 'VAT Current Account (Receivable)',  'asset', '1230', 0,       'debit'],

            // 1240 Accounts Receivable
            ['1240', 'Accounts Receivable', 'asset', '1200', 0, 'debit'],
            ['1241', 'AR - Corbel Chemical Industries',     'asset', '1240', 44355,   'debit'],
            ['1242', 'AR - Emami Bangladesh Limited',       'asset', '1240', 53089,   'debit'],
            ['1243', 'AR - Marico Bangladesh Limited',      'asset', '1240', 7618106, 'debit'],
            ['1244', 'AR - Pidilite Speciality (Pvt) Ltd.', 'asset', '1240', 5764128, 'debit'],
            ['1245', 'AR - Rahimafrooz Battery',            'asset', '1240', 128467,  'debit'],
            ['1246', 'AR - Padma Pet Limited (SESA)',       'asset', '1240', 1103729, 'debit'],
            ['1247', 'AR - Cavinkare',                      'asset', '1240', 41561,   'debit'],
            ['1248', 'AR - Keya Cosmetics Ltd',             'asset', '1240', 5461195, 'debit'],

            // 1250 Cash & Bank Balances
            ['1250', 'Cash & Bank Balances', 'asset', '1200', 0, 'debit'],
            ['1251', 'Cash in Hand', 'asset', '1250', 37199, 'debit'],
            ['1252', 'IFIC Bank Ltd - CD A/C 1025178216001',     'asset', '1250', 1942,   'debit'],
            ['1253', 'Dutch Bangla Bank PLC - 1511100010719',    'asset', '1250', 1809,   'debit'],
            ['1254', 'IPDC FDR - 1001251000056303',              'asset', '1250', 931267, 'debit'],
            ['1255', 'IPDC FDR - 1001251000049290',              'asset', '1250', 979599, 'debit'],
            ['1256', 'Dhaka Bank PLC - 2261000004530',           'asset', '1250', 7652,   'debit'],

            // ============ 2000 LIABILITIES ============
            ['2000', 'Liabilities', 'liability', null, 0, 'credit'],

            // 2100 Non-Current Liabilities
            ['2100', 'Non-Current Liabilities', 'liability', '2000', 0, 'credit'],
            ['2101', 'Long Term Loan - IPDC (Non-current Portion)', 'liability', '2100', 5802532, 'credit'],

            // 2200 Current Liabilities
            ['2200', 'Current Liabilities', 'liability', '2000', 0, 'credit'],

            // 2210 Accounts & Other Payable
            ['2210', 'Accounts & Other Payable', 'liability', '2200', 0, 'credit'],
            ['2211', 'AP - Due for RM (HDPE)',                  'liability', '2210', 2805000, 'credit'],
            ['2212', 'AP - Famous Accessories',                 'liability', '2210', 28500,   'credit'],
            ['2213', 'AP - Concord Association',                'liability', '2210', 19390,   'credit'],
            ['2214', 'AP - Abdul Ali Filling Station (Diesel)', 'liability', '2210', 323120,  'credit'],
            ['2215', 'AP - Redwan Colour (Screen Cloth)',       'liability', '2210', 15600,   'credit'],
            ['2216', 'AP - Colour Plus / Tarik Enterprise',     'liability', '2210', 321313,  'credit'],
            ['2217', 'AP - Q.Pail',                             'liability', '2210', 265943,  'credit'],
            ['2218', 'AP - Klystron Automation Co. Ltd',        'liability', '2210', 107500,  'credit'],

            // 2220 Other Liabilities (accruals)
            ['2220', 'Other Liabilities (Accruals)', 'liability', '2200', 0, 'credit'],
            ['2221', 'Accrued Electricity',                'liability', '2220', 1234692, 'credit'],
            ['2222', 'Accrued Gas',                        'liability', '2220', 31146,   'credit'],
            ['2223', 'Accrued Salary & Allowance',         'liability', '2220', 1393918, 'credit'],
            ['2224', 'Accrued Audit & Professional Fee',   'liability', '2220', 138000,  'credit'],
            ['2225', 'Accrued Wages',                      'liability', '2220', 1013018, 'credit'],
            ['2226', 'Accrued Credit Report',              'liability', '2220', 26875,   'credit'],
            ['2227', 'Withholding VAT & Tax Payables',     'liability', '2220', 410006,  'credit'],
            ['2228', 'VAT Current Account (Payable)',      'liability', '2220', 116358,  'credit'],

            // 2230 Short Term Loans & Borrowings
            ['2230', 'Short Term Loans & Borrowings', 'liability', '2200', 0, 'credit'],
            ['2231', 'CC Loan - IFIC Bank (A/C 121)',           'liability', '2230', 16407763, 'credit'],
            ['2232', 'Term Loan - IFIC-471',                    'liability', '2230', 269362,   'credit'],
            ['2233', 'Loan from MD and MD Relative',            'liability', '2230', 12264000, 'credit'],
            ['2234', 'IFIC Bank Ltd SOD (A/C 0000178216002)',   'liability', '2230', 5397451,  'credit'],
            ['2235', 'IPDC - Current Portion of Long Term Loan','liability', '2230', 4579834,  'credit'],

            ['2240', 'Provision for Income Tax', 'liability', '2200', 8394101, 'credit'],

            // ============ 3000 EQUITY ============
            ['3000', 'Equity', 'equity', null, 0, 'credit'],
            ['3101', 'Share Capital',       'equity', '3000', 1000000,  'credit'],
            ['3102', 'Retained Earnings',   'equity', '3000', 35029585, 'credit'],
            ['3103', 'Revaluation Reserve', 'equity', '3000', 5000000,  'credit'],

            // ============ 4000 INCOME ============
            ['4000', 'Income', 'income', null, 0, 'credit'],
            ['4101', 'Sales Revenue',                     'income', '4000', 0, 'credit'],
            ['4201', 'Other Income - Interest on FDR',    'income', '4000', 0, 'credit'],

            // ============ 5000 COST OF GOODS SOLD ============
            ['5000', 'Cost of Goods Sold', 'expense', null, 0, 'debit'],
            ['5100', 'Raw Material Consumed', 'expense', '5000', 0, 'debit'],
            ['5101', 'Raw Material - Local Purchase (HDPE/LDPE/MB)', 'expense', '5100', 0, 'debit'],
            ['5102', 'Raw Material - Import',                        'expense', '5100', 0, 'debit'],

            ['5200', 'Direct Labour', 'expense', '5000', 0, 'debit'],

            ['5300', 'Manufacturing Overhead', 'expense', '5000', 0, 'debit'],
            ['5301', 'Building Maintenance - Factory',        'expense', '5300', 0, 'debit'],
            ['5302', 'Amortization - Factory',                'expense', '5300', 0, 'debit'],
            ['5303', 'Depreciation - Factory',                'expense', '5300', 0, 'debit'],
            ['5304', 'Electric Expense - Factory',            'expense', '5300', 0, 'debit'],
            ['5305', 'Electricity Bill - Factory',            'expense', '5300', 0, 'debit'],
            ['5306', 'Factory Maintenance',                   'expense', '5300', 0, 'debit'],
            ['5307', 'Gas Bill - Factory',                    'expense', '5300', 0, 'debit'],
            ['5308', 'Diesel & Petroleum for Generator',      'expense', '5300', 0, 'debit'],
            ['5309', 'Generator Repairing & Parts',           'expense', '5300', 0, 'debit'],
            ['5310', 'Lubricants',                            'expense', '5300', 0, 'debit'],
            ['5311', 'Medical Expenses / Donation - Factory', 'expense', '5300', 0, 'debit'],
            ['5312', 'Machine Maintenance Expense',           'expense', '5300', 0, 'debit'],
            ['5313', 'Printing Machine Expense (incl. Chemical)', 'expense', '5300', 0, 'debit'],
            ['5314', 'Factory Staff Salary',                  'expense', '5300', 0, 'debit'],

            // ============ 6000 OPERATING & OTHER EXPENSES ============
            ['6000', 'Operating & Other Expenses', 'expense', null, 0, 'debit'],

            // 6100 Administrative Expenses
            ['6100', 'Administrative Expenses', 'expense', '6000', 0, 'debit'],
            ['6101', 'Audit Fee & Professional Fee', 'expense', '6100', 0, 'debit'],
            ['6102', 'Conveyance',                   'expense', '6100', 0, 'debit'],
            ['6103', 'Canteen & Meal Expense',       'expense', '6100', 0, 'debit'],
            ['6104', 'Amortization - Admin',         'expense', '6100', 0, 'debit'],
            ['6105', 'Depreciation - Admin',         'expense', '6100', 0, 'debit'],
            ['6106', 'Directors Remuneration',       'expense', '6100', 0, 'debit'],
            ['6107', 'Consultant Fee / Fire Plan / Credit Report', 'expense', '6100', 0, 'debit'],
            ['6108', 'Fuel Expense',                 'expense', '6100', 0, 'debit'],
            ['6109', 'License & Renewals (Tax Token, Route Permit, Fitness)', 'expense', '6100', 0, 'debit'],
            ['6110', 'Car Maintenance Expense',      'expense', '6100', 0, 'debit'],
            ['6111', 'Gas Bill - Office',            'expense', '6100', 0, 'debit'],
            ['6112', 'Insurance',                    'expense', '6100', 0, 'debit'],
            ['6113', 'Internet & Mobile',            'expense', '6100', 0, 'debit'],
            ['6114', 'License, Renewal & Registration', 'expense', '6100', 0, 'debit'],
            ['6115', 'Miscellaneous Expenses',       'expense', '6100', 0, 'debit'],
            ['6116', 'Municipal Tax (GCC / DCC)',    'expense', '6100', 0, 'debit'],
            ['6117', 'Newspaper & Periodicals',      'expense', '6100', 0, 'debit'],
            ['6118', 'Office Maintenance',           'expense', '6100', 0, 'debit'],
            ['6119', 'Printing & Stationery',        'expense', '6100', 0, 'debit'],
            ['6120', 'Bad Debt Expenses',            'expense', '6100', 0, 'debit'],
            ['6121', 'Salary & Allowance - Admin',   'expense', '6100', 0, 'debit'],
            ['6122', 'Provision for Advance with Employee', 'expense', '6100', 0, 'debit'],
            ['6123', 'Employee Welfare Fund',        'expense', '6100', 0, 'debit'],
            ['6124', 'Service Charges (Concord)',    'expense', '6100', 0, 'debit'],
            ['6125', 'Electric Bill - Office',       'expense', '6100', 0, 'debit'],
            ['6126', 'WASA Bill',                    'expense', '6100', 0, 'debit'],
            ['6127', 'Software Maintenance Charge',  'expense', '6100', 0, 'debit'],

            // 6200 Selling & Distribution Expenses
            ['6200', 'Selling & Distribution Expenses', 'expense', '6000', 0, 'debit'],
            ['6201', 'Unloading Bill (Labour / Cooli)', 'expense', '6200', 0, 'debit'],
            ['6202', 'Petrol & Diesel for Cover Van',   'expense', '6200', 0, 'debit'],
            ['6203', 'Carton Expenses with Poly',       'expense', '6200', 0, 'debit'],

            // 6300 Financial Expenses
            ['6300', 'Financial Expenses', 'expense', '6000', 0, 'debit'],
            ['6301', 'Interest on UFL Lease',                          'expense', '6300', 0, 'debit'],
            ['6302', 'Interest on Meridian Finance',                   'expense', '6300', 0, 'debit'],
            ['6303', 'Interest on IPDC',                               'expense', '6300', 0, 'debit'],
            ['6304', 'Bank Interest on IFIC Loan (A/C 178216-121)',    'expense', '6300', 0, 'debit'],
            ['6305', 'IFIC Interest - SOD Loan (A/C 002)',             'expense', '6300', 0, 'debit'],
            ['6306', 'Bank / Doc Charges (IFIC/UFL/Meridian/IPDC)',    'expense', '6300', 0, 'debit'],

            // 6400 Tax
            ['6400', 'Income Tax', 'expense', '6000', 0, 'debit'],
            ['6401', 'Provision for Income Tax (Expense)', 'expense', '6400', 0, 'debit'],
            ['6402', 'Deferred Tax (Expense)/Income',      'expense', '6400', 0, 'debit'],
        ];

        $codeToId = [];
        foreach ($accounts as [$code, $name, $type, $parentCode, $_noteBalance, $obType]) {
            $parentId = $parentCode ? ($codeToId[$parentCode] ?? null) : null;

            $acc = ChartOfAccount::firstOrCreate(
                ['account_code' => $code],
                [
                    'account_name' => $name,
                    'account_type' => $type,
                    'parent_id' => $parentId,
                    'opening_balance' => 0,
                    'opening_balance_type' => $obType,
                    'is_active' => 1,
                ]
            );

            // If it already existed, still ensure parent linkage / name updates
            if (! $acc->wasRecentlyCreated) {
                $acc->update([
                    'account_name' => $name,
                    'account_type' => $type,
                    'parent_id' => $parentId,
                    'opening_balance' => 0,
                    'opening_balance_type' => $obType,
                    'is_active' => 1,
                ]);
            }

            $codeToId[$code] = $acc->id;
        }

        $this->command?->info('IR Limited Chart of Accounts seeded: '.count($accounts).' accounts.');
    }
}
