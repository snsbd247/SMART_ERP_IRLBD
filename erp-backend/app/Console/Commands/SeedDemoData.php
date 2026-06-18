<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Carbon\Carbon;
use App\Models\{
    AccVoucher, Attendance, BillOfMaterial, BomItem, Branch, ChartOfAccount,
    CompanySetting, Customer, CustomerReceive, DeliveryChallan, Department,
    Designation, Employee,
    EmployeeFundSetting, FinancialYear, FundTransaction, HoReceive,
    InvoicePayment, InvoiceChallan, ItemCategory, ItemMaster, LeaveRequest,
    LeaveType, NumberSequence, PartyNote, PartyPayment, PaymentAllocation,
    Payroll, Product, ProductCategory, ProductionEntry, ProductionMaterial,
    Purchase, PurchaseItem, PurchaseOrder, PurchaseOrderItem, PurchaseReturn,
    PurchaseReturnItem, SalaryStructure, SalesInvoice, SalesInvoiceItem,
    SalesInvoiceItemV2, SalesInvoiceV2, SalesReturn, SalesReturnItem,
    StockMovement, StockTransfer, Supplier, TdsEntry, Unit, VatChallan,
    VatChallanItem, VoucherEntry, Warehouse
};

class SeedDemoData extends Command
{
    protected $signature = 'demo:seed {--reset : Reset all transactional/demo data first} {--wipe : Wipe transactional/demo data and exit (do not seed)} {--wipe-transactions : Wipe ONLY transactional data, keep all masters & configuration, then exit}';
    protected $description = 'Seed 1-year operational demo data covering all ERP modules';

    // Deterministic RNG state
    private int $_s = 42;

    private function R(): float
    {
        $this->_s = ($this->_s * 1103515245 + 12345) & 0x7fffffff;
        return $this->_s / 2147483648.0;
    }

    private function RI(int $a, int $b): int
    {
        return (int) floor($this->R() * ($b - $a + 1)) + $a;
    }

    private function pick(array $a): mixed
    {
        return $a[(int) floor($this->R() * count($a))];
    }

    private function pickN(array $a, int $n): array
    {
        $c = $a;
        shuffle($c);
        return array_slice($c, 0, min($n, count($c)));
    }

    private function U(): string
    {
        return (string) Str::uuid();
    }

    private function ymd(Carbon $d): string
    {
        return $d->toDateString();
    }

    private function round2(float $n): float
    {
        return round($n, 2);
    }

    // Bulk insert helper. Keep the demo seeder resilient when older installations
    // have additive columns while fresh Laravel installs still use base columns.
    private function bulk(string $table, array $rows, int $chunk = 500): void
    {
        if (empty($rows)) return;
        $rows = array_map(fn (array $row) => $this->normalizeRow($table, $row), $rows);
        foreach (array_chunk($rows, $chunk) as $batch) {
            DB::table($table)->insert($batch);
        }
    }

    private function normalizeRow(string $table, array $row): array
    {
        static $columns = [];
        if (!isset($columns[$table])) {
            $columns[$table] = Schema::hasTable($table) ? Schema::getColumnListing($table) : [];
        }
        $allowed = array_flip($columns[$table]);
        return array_intersect_key($row, $allowed);
    }

    // Master references
    private string $BR_DHK, $BR_CTG, $FY, $WH_DHK, $WH_CTG;
    private string $DEPT, $DESIG;
    private array $branches = [], $customers = [], $suppliers = [], $employees = [];
    private array $products = [], $productMap = [];
    private array $units = [], $categories = [];
    private array $Ac = [];
    private array $lts = [];
    private string $UID;
    private string $fyTag;

    // Accumulators
    private array $vouchers = [], $ventries = [];
    private int $vcJV = 0, $vcPV = 0, $vcRV = 0, $vcCV = 0;
    private int $sc = 0, $pc = 0, $src = 0, $prc = 0, $tc = 0, $prdc = 0;
    private int $poc = 0, $vchc = 0, $dcc = 0, $inv2c = 0, $ipayc = 0, $tdsc = 0, $pmc = 0;
    private array $sList = [], $pList = [];
    private Carbon $fyStart, $fyEnd;

    public function handle(): int
    {
        $this->_s = 42;
        $t0 = microtime(true);
        $this->info('Starting demo data seed...');

        // Resolve admin user
        $admin = DB::table('users')->whereNull('employee_id')->first();
        if (!$admin) {
            $this->error('No Super Admin found. Run php artisan migrate:fresh --seed first.');
            return 1;
        }
        $this->UID = $admin->id;

        if ($this->option('wipe-transactions')) {
            $this->resetTransactionsOnly();
            $this->info('Wipe-transactions mode: transactional data cleared, masters & configuration preserved.');
            return 0;
        }

        if ($this->option('reset') || $this->option('wipe')) {
            $this->resetData();
        }

        if ($this->option('wipe')) {
            $this->info('Wipe-only mode: demo / transactional data cleared. Skipping seed.');
            return 0;
        }

        $this->resolveMasters();
        $this->seedInventory();
        $this->seedParties();
        $this->seedEmployees();
        $this->seedOpeningVoucher();
        $this->seedDailySalesPurchases();
        $this->seedReturns();
        $this->seedPayments();
        $this->seedMonthlyExpensesAndPayroll();
        $this->seedAttendanceAndLeave();
        $this->seedStockTransfers();
        $this->seedManufacturing();
        $this->seedSalesWorkflow();
        $this->seedNumberSequences();
        $this->seedPartyNotes();

        $duration = round((microtime(true) - $t0) * 1000);
        $this->info("Demo seed completed in {$duration}ms.");
        $this->info("Stats: Sales={$this->sc}, Purchases={$this->pc}, Vouchers=" . count($this->vouchers));
        $this->info("Returns: SR={$this->src}, PR={$this->prc}, POs={$this->poc}, InvoicesV2={$this->inv2c}");
        $this->info("Production={$this->prdc}, Transfers={$this->tc}, Payroll=" . count($this->employees) * 12);

        return 0;
    }

    private function resetData(): void
    {
        $this->info('Resetting transactional data...');
        DB::statement('SET FOREIGN_KEY_CHECKS=0');

        $resetGroups = [
            ['voucher_entries','payment_allocations','sales_invoice_items','sales_return_items','purchase_items','purchase_return_items','stock_movements','stock_ledger','stock_transfers','production_materials','bom_items','fund_transactions','employee_fund_settings','overtime_records','leave_requests','attendance','employee_documents','employee_bank_info','employee_education','employee_experience','employee_emergency_contacts','salary_structures','face_data','biometric_logs','payroll','party_notes','login_logs','backup_history','messages','conversation_participants',
             'tds_entries','invoice_payments','invoice_challans','sales_invoice_items_v2','customer_receives','ho_receives','vat_challan_items','purchase_order_items',
             'invoice_status_logs','po_amendments'],
            ['sales_returns','purchase_returns'],
            ['sales_invoices_v2','delivery_challans','vat_challans','purchase_orders'],
            ['acc_vouchers','party_payments','sales_invoices','purchases','production_entries','bill_of_materials','employees','conversations','number_sequences'],
            ['customers','suppliers','item_master','products','raw_materials'],
            ['item_categories','units','warehouses','product_categories'],
        ];

        foreach ($resetGroups as $grp) {
            foreach ($grp as $t) {
                if (DB::getSchemaBuilder()->hasTable($t)) {
                    DB::table($t)->delete();
                }
            }
        }

        DB::statement('SET FOREIGN_KEY_CHECKS=1');
        $this->info('Reset complete.');
    }

    /**
     * Wipe ONLY transactional data. Preserves ALL masters
     * (customers, suppliers, products, item_master, employees, salary_structures,
     * employee_*, bom_items, bill_of_materials) AND configuration
     * (branches, financial_years, chart_of_accounts, item_categories, units,
     * warehouses, product_categories, departments, designations, leave_types,
     * company_setting, users, user_roles, page shortcuts, document numbering, etc.).
     */
    private function resetTransactionsOnly(): void
    {
        $this->info('Resetting transactional data only (masters & configuration preserved)...');
        DB::statement('SET FOREIGN_KEY_CHECKS=0');

        $txnGroups = [
            // Child / dependent rows first
            ['voucher_entries','payment_allocations','sales_invoice_items','sales_return_items','purchase_items','purchase_return_items','purchase_order_items','sales_invoice_items_v2','invoice_status_logs','po_amendments','vat_challan_items','invoice_payments','invoice_challans','tds_entries','customer_receives','ho_receives','stock_movements','stock_ledger','production_materials','fund_transactions','overtime_records','leave_requests','attendance','biometric_logs','login_logs','backup_history','party_notes','messages','conversation_participants','payroll'],
            // Parents
            ['sales_returns','purchase_returns'],
            ['sales_invoices_v2','delivery_challans','vat_challans','purchase_orders','stock_transfers'],
            ['acc_vouchers','party_payments','sales_invoices','purchases','production_entries','conversations','number_sequences'],
        ];

        foreach ($txnGroups as $grp) {
            foreach ($grp as $t) {
                if (DB::getSchemaBuilder()->hasTable($t)) {
                    DB::table($t)->delete();
                }
            }
        }

        DB::statement('SET FOREIGN_KEY_CHECKS=1');
        $this->info('Transactional data reset complete.');
    }

    private function resolveMasters(): void
    {
        // Branches
        $brRows = DB::table('branches')->orderBy('created_at')->get(['id','code','name']);
        if ($brRows->isEmpty()) {
            $this->BR_DHK = $this->U();
            $this->BR_CTG = $this->U();
            DB::table('branches')->insert([
                ['id'=>$this->BR_DHK,'code'=>'HQ','name'=>'Head Office','phone'=>'+8801700000000','address'=>'Dhaka','status'=>'active','created_at'=>now(),'updated_at'=>now()],
                ['id'=>$this->BR_CTG,'code'=>'CTG','name'=>'Chittagong Branch','phone'=>'+8801800000000','address'=>'Chittagong','status'=>'active','created_at'=>now(),'updated_at'=>now()],
            ]);
        } else {
            $this->BR_DHK = $brRows[0]->id;
            if (count($brRows) === 1) {
                $this->BR_CTG = $this->U();
                DB::table('branches')->insert(['id'=>$this->BR_CTG,'code'=>'CTG','name'=>'Chittagong Branch','phone'=>'+8801800000000','address'=>'Chittagong','status'=>'active','created_at'=>now(),'updated_at'=>now()]);
            } else {
                $this->BR_CTG = $brRows[1]->id;
            }
        }

        // Financial Year
        $today = now();
        $this->fyStart = Carbon::create($today->year - 1, $today->month, 1);
        $this->fyEnd = Carbon::create($today->year, $today->month, 1)->subDay();
        $fyName = "Demo FY {$this->fyStart->year}-{$this->fyEnd->year}";
        $this->fyTag = substr((string)$this->fyStart->year, 2) . substr((string)$this->fyEnd->year, 2);

        DB::table('financial_years')->where('id', '!=', '00000000-0000-0000-0000-000000000000')->update(['is_active'=>false]);
        $fyExist = DB::table('financial_years')->where('name', $fyName)->first();
        if ($fyExist) {
            $this->FY = $fyExist->id;
            DB::table('financial_years')->where('id', $this->FY)->update([
                'start_date' => $this->ymd($this->fyStart),
                'end_date' => $this->ymd($this->fyEnd),
                'is_active' => true,
            ]);
        } else {
            $this->FY = $this->U();
            DB::table('financial_years')->insert([
                'id' => $this->FY, 'name' => $fyName,
                'start_date' => $this->ymd($this->fyStart),
                'end_date' => $this->ymd($this->fyEnd),
                'is_active' => true,
                'created_at' => now(),
            ]);
        }

        DB::table('company_settings')->where('id', 'default')->update([
            'default_financial_year_id' => $this->FY,
            'default_branch_id' => $this->BR_DHK,
        ]);

        // Departments & Designations
        $depts = DB::table('departments')->get(['id','name']);
        if ($depts->isEmpty()) {
            $this->DEPT = $this->U();
            DB::table('departments')->insert(['id'=>$this->DEPT,'name'=>'Administration','created_at'=>now()]);
        } else {
            $this->DEPT = $depts[0]->id;
        }

        $desigs = DB::table('designations')->get(['id','name']);
        if ($desigs->isEmpty()) {
            $this->DESIG = $this->U();
            DB::table('designations')->insert(['id'=>$this->DESIG,'name'=>'Manager','created_at'=>now()]);
        } else {
            $this->DESIG = $desigs[0]->id;
        }

        // Leave types
        $lts = DB::table('leave_types')->get(['id','name']);
        if ($lts->isEmpty()) {
            $this->lts = [];
            foreach ([['Annual',14],['Sick',10],['Casual',7]] as [$n,$d]) {
                $id = $this->U();
                DB::table('leave_types')->insert(['id'=>$id,'name'=>$n,'days_per_year'=>$d,'created_at'=>now()]);
                $this->lts[] = (object)['id'=>$id,'name'=>$n];
            }
        } else {
            $this->lts = $lts->all();
        }

        // Chart of Accounts
        $coa = DB::table('chart_of_accounts')->where('is_active', true)->pluck('id', 'account_code');
        $need = ['1101','1102','1103','1105','1107','2101','2104','2106','3101','4101','4105','5101','5103','5201','5202','5203','5204','5205','5209','6101','6102'];
        foreach ($need as $c) {
            if (!isset($coa[$c])) {
                throw new \RuntimeException("Missing CoA code {$c}. Re-run Chart of Accounts seed first.");
            }
        }
        $this->Ac = [
            'cash' => $coa['1101'], 'bank' => $coa['1102'], 'ar' => $coa['1103'], 'inv' => $coa['1105'], 'tdsr' => $coa['1107'],
            'ap' => $coa['2101'], 'vatPay' => $coa['2104'], 'pfLiab' => $coa['2106'],
            'cap' => $coa['3101'], 'sales' => $coa['4101'], 'salesRet' => $coa['4105'],
            'pur' => $coa['5101'], 'purRet' => $coa['5103'], 'sal' => $coa['5201'], 'rent' => $coa['5202'], 'util' => $coa['5203'], 'off' => $coa['5204'], 'tr' => $coa['5205'], 'pfExp' => $coa['5209'],
            'vatIn' => $coa['6101'], 'vatOut' => $coa['6102'],
        ];

        // Ensure default child bank accounts exist (idempotent)
        $bankChildren = [
            ['1111', 'EBL Current A/C - 1234567890'],
            ['1112', 'City Bank Current A/C - 9988776655'],
            ['1113', 'BRAC Bank Savings A/C - 4455667788'],
            ['1114', 'HSBC USD A/C - 0011223344'],
        ];
        $this->Ac['banks'] = [];
        foreach ($bankChildren as [$code, $name]) {
            $existing = DB::table('chart_of_accounts')->where('account_code', $code)->value('id');
            if (!$existing) {
                $existing = $this->U();
                DB::table('chart_of_accounts')->insert([
                    'id' => $existing,
                    'account_code' => $code,
                    'account_name' => $name,
                    'account_type' => 'asset',
                    'parent_id'    => $this->Ac['bank'],
                    'opening_balance' => 0,
                    'opening_balance_type' => 'debit',
                    'is_active' => 1,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
            $this->Ac['banks'][$code] = $existing;
        }
    }

    private function seedInventory(): void
    {
        $this->info('Seeding inventory...');

        $this->WH_DHK = $this->U();
        $this->WH_CTG = $this->U();
        $this->bulk('warehouses', [
            ['id'=>$this->WH_DHK,'name'=>'Dhaka Main Warehouse','code'=>'WH-DHK','warehouse_code'=>'WH-DHK','warehouse_name'=>'Dhaka Main Warehouse','branch_id'=>$this->BR_DHK,'is_active'=>1,'status'=>'active','created_at'=>now(),'updated_at'=>now()],
            ['id'=>$this->WH_CTG,'name'=>'Chittagong Warehouse','code'=>'WH-CTG','warehouse_code'=>'WH-CTG','warehouse_name'=>'Chittagong Warehouse','branch_id'=>$this->BR_CTG,'is_active'=>1,'status'=>'active','created_at'=>now(),'updated_at'=>now()],
        ]);

        $ud = [['PCS','Pieces'],['KG','Kilogram'],['LTR','Litre'],['BOX','Box'],['MTR','Meter']];
        foreach ($ud as [$a,$n]) {
            $id = $this->U();
            $this->units[$a] = $id;
            DB::table('units')->insert(['id'=>$id,'name'=>$n,'abbreviation'=>$a,'created_at'=>now(),'updated_at'=>now()]);
        }

        $cd = ['Electronics','Office Supplies','Furniture','Stationery','Hardware'];
        foreach ($cd as $n) {
            $id = $this->U();
            $this->categories[$n] = $id;
            DB::table('product_categories')->insert(['id'=>$id,'name'=>$n,'created_at'=>now(),'updated_at'=>now()]);
            DB::table('item_categories')->insert(['id'=>$id,'name'=>$n,'is_active'=>true,'created_at'=>now(),'updated_at'=>now()]);
        }

        $PD = [
            ['Laptop Pro 15','Electronics','PCS',65000,85000],['Wireless Mouse','Electronics','PCS',450,750],
            ['Mechanical Keyboard','Electronics','PCS',2800,4500],['LED Monitor 24','Electronics','PCS',12000,17500],
            ['USB Hub 4-Port','Electronics','PCS',650,1100],['External SSD 1TB','Electronics','PCS',7500,10500],
            ['Printer Inkjet','Electronics','PCS',8500,12500],['Webcam HD','Electronics','PCS',2200,3500],
            ['Headphones BT','Electronics','PCS',1800,2900],['Power Bank 20000mAh','Electronics','PCS',1500,2400],
            ['A4 Paper Ream','Stationery','BOX',420,600],['Ballpoint Pen Box','Stationery','BOX',180,300],
            ['Stapler Heavy Duty','Office Supplies','PCS',650,950],['File Folder','Stationery','PCS',45,80],
            ['Notebook A5','Stationery','PCS',95,160],['Marker Set','Stationery','BOX',220,350],
            ['Office Chair','Furniture','PCS',8500,13500],['Executive Desk','Furniture','PCS',18500,26000],
            ['Filing Cabinet','Furniture','PCS',9500,14000],['Bookshelf','Furniture','PCS',7800,11500],
            ['UPS 1200VA','Electronics','PCS',5500,7800],['Router WiFi 6','Electronics','PCS',4200,6200],
            ['CAT6 Cable 305m','Hardware','BOX',6500,9200],['RJ45 Connector Pack','Hardware','BOX',350,550],
            ['Toner Cartridge','Office Supplies','PCS',3800,5500],['Light Bulb LED','Hardware','PCS',180,280],
            ['Drill Machine','Hardware','PCS',3800,5500],['Screwdriver Set','Hardware','BOX',850,1300],
            ['CCTV Camera','Electronics','PCS',4500,6500],['Hard Disk 4TB','Electronics','PCS',8500,11800],
        ];

        $products = [];
        $prodRows = [];
        $itemRows = [];
        foreach ($PD as $i => $p) {
            $uid = $this->U();
            $code = 'PRD-' . str_pad((string)($i+1), 4, '0', STR_PAD_LEFT);
            $op = $this->RI(50, 300);
            $products[] = ['id'=>$uid,'iid'=>$uid,'code'=>$code,'name'=>$p[0],'cat'=>$p[1],'unit'=>$p[2],'cp'=>$p[3],'sp'=>$p[4],'op'=>$op];
            $prodRows[] = [
                'id'=>$uid,'product_code'=>$code,'product_name'=>$p[0],'category_id'=>$this->categories[$p[1]],
                'unit'=>$p[2],'cost_price'=>$p[3],'selling_price'=>$p[4],'low_stock_threshold'=>10,'status'=>'active',
                'created_at'=>now(),'updated_at'=>now(),
            ];
            $itemRows[] = [
                'id'=>$uid,'item_code'=>$code,'item_name'=>$p[0],'item_type'=>'product','is_stock_item'=>true,
                'opening_stock'=>$op,'category_id'=>$this->categories[$p[1]],'unit_id'=>$this->units[$p[2]],
                'cost_price'=>$p[3],'selling_price'=>$p[4],'min_stock_level'=>10,'status'=>'active',
                'created_at'=>now(),'updated_at'=>now(),
            ];
        }
        $this->products = $products;
        $this->bulk('products', $prodRows);
        $this->bulk('item_master', $itemRows);
    }

    private function seedParties(): void
    {
        $this->info('Seeding customers & suppliers...');

        $cn = ['Alpha Trading','Beta Enterprises','Gamma Corp','Delta Industries','Epsilon Ltd',
            'Zeta Solutions','Eta Holdings','Theta Group','Iota Tech','Kappa Foods',
            'Lambda Pharma','Mu Textiles','Nu Logistics','Xi Construction','Omicron Retail'];
        $cRows = [];
        foreach ($cn as $i => $n) {
            $id = $this->U();
            $this->customers[] = ['id'=>$id,'name'=>$n];
            $cRows[] = [
                'id'=>$id,'name'=>$n,'phone'=>'+8801'.(700000000+$i*1111),'email'=>strtolower(str_replace(' ','',$n)).'@example.com',
                'address'=>'Dhaka, Bangladesh','status'=>'active','created_at'=>now(),
            ];
        }
        $this->bulk('customers', $cRows);

        $sn = ['ABC Suppliers','XYZ Wholesale','PQR Distributors','LMN Trading','EFG Imports',
            'HIJ Mfg','RST Enterprises','UVW Industries','BDS Tech','GreenLine Foods',
            'Metro Hardware','Capital Stationers'];
        $sRows = [];
        foreach ($sn as $i => $n) {
            $id = $this->U();
            $this->suppliers[] = ['id'=>$id,'name'=>$n];
            $sRows[] = [
                'id'=>$id,'name'=>$n,'phone'=>'+8801'.(800000000+$i*2222),'email'=>strtolower(str_replace(' ','',$n)).'@vendor.com',
                'address'=>'Dhaka, Bangladesh','status'=>'active','created_at'=>now(),
            ];
        }
        $this->bulk('suppliers', $sRows);
    }

    private function seedEmployees(): void
    {
        $this->info('Seeding employees...');

        $fns = ['Rahim','Karim','Salam','Hasan','Nasir','Jamil','Tarek','Imran','Farhad','Mizan','Fatema','Nasrin','Sumi','Ayesha','Rabeya'];
        $lns = ['Ahmed','Khan','Hossain','Islam','Rahman','Chowdhury','Akter','Begum','Sultana','Hoque','Ahmed','Khan','Hossain','Islam','Rahman'];
        $basicChoices = [18000,22000,28000,35000,45000,55000];
        $fyStartIso = $this->ymd($this->fyStart);

        $empRows = [];
        $salRows = [];
        $fundRows = [];
        foreach ($fns as $i => $fn) {
            $basic = $this->pick($basicChoices);
            $join = $i < 10 ? $fyStartIso : $this->ymd(Carbon::create($this->fyStart->year, $this->fyStart->month + $this->RI(1,3), 1));
            $id = $this->U();
            $this->employees[] = ['id'=>$id,'code'=>'EMP-'.(1000+$i+1),'basic'=>$basic,'join'=>$join,'name'=>"{$fn} {$lns[$i]}"];
            $empRows[] = [
                'id'=>$id,'employee_code'=>'EMP-'.(1000+$i+1),'first_name'=>$fn,'last_name'=>$lns[$i],
                'mobile'=>'+8801'.(900000000+$i*333),'email'=>strtolower($fn).$i.'@erp.com',
                'department_id'=>$this->DEPT,'designation_id'=>$this->DESIG,
                'branch_id'=>$i<10?$this->BR_DHK:$this->BR_CTG,
                'joining_date'=>$join,'salary'=>$basic,'employment_type'=>'permanent','status'=>'active',
                'created_at'=>now(),'updated_at'=>now(),
            ];
            $hr = (int) floor($basic * 0.4);
            $med = (int) floor($basic * 0.1);
            $oth = (int) floor($basic * 0.05);
            $salRows[] = [
                'id'=>$this->U(),'employee_id'=>$id,'basic_salary'=>$basic,'house_rent'=>$hr,'medical_allowance'=>$med,
                'other_allowance'=>$oth,'total_salary'=>$basic+$hr+$med+$oth,'effective_from'=>$join,
                'created_at'=>now(),'updated_at'=>now(),
            ];
            $fundRows[] = [
                'id'=>$this->U(),'employee_id'=>$id,'fund_type'=>'provident_fund',
                'calculation_type'=>'percentage','employee_rate'=>10,'employer_rate'=>10,
                'effective_from'=>$join,'is_active'=>true,'created_at'=>now(),'updated_at'=>now(),
            ];
        }
        $this->bulk('employees', $empRows);
        $this->bulk('salary_structures', $salRows);
        $this->bulk('employee_fund_settings', $fundRows);
    }

    private function addV(string $vtype, string $vdate, string $desc, array $entries): string
    {
        $vid = $this->U();
        $total = array_reduce($entries, fn($s,$e) => $s + $e[1], 0.0);
        $pmap = ['journal'=>'JV','payment'=>'PV','receipt'=>'RV','contra'=>'CV'];
        $pfx = $pmap[$vtype];
        $this->{"vc{$pfx}"}++;
        $vn = "{$pfx}-{$this->fyTag}-" . str_pad((string)$this->{"vc{$pfx}"}, 5, '0', STR_PAD_LEFT);

        $this->vouchers[] = [
            'id'=>$vid,'voucher_number'=>$vn,'voucher_type'=>$vtype,'voucher_date'=>$vdate,
            'description'=>$desc,'total_amount'=>$this->round2($total),'status'=>'approved',
            'branch_id'=>$this->BR_DHK,'financial_year_id'=>$this->FY,
            'created_by'=>$this->UID,'approved_by'=>$this->UID,'approved_at'=>$vdate,
            'created_at'=>now(),'updated_at'=>now(),
        ];
        foreach ($entries as $idx => $e) {
            $this->ventries[] = [
                'id'=>$this->U(),'voucher_id'=>$vid,'account_id'=>$e[0],
                'debit'=>$this->round2($e[1]),'credit'=>$this->round2($e[2]),'narration'=>$e[3],'sort_order'=>$idx,
            ];
        }
        return $vid;
    }

    private function seedOpeningVoucher(): void
    {
        $invOpen = array_reduce($this->products, fn($s,$p) => $s + $p['cp'] * $p['op'], 0.0);
        $cashOp = 200000; $bankOp = 800000; $apOp = 150000;
        $capital = $cashOp + $bankOp + $invOpen - $apOp;

        $entries = [
            [$this->Ac['cash'], $cashOp, 0, 'Opening cash'],
        ];

        // Distribute bank opening across the 4 child bank accounts
        $banks = $this->Ac['banks'] ?? [];
        if (!empty($banks)) {
            $splits = [
                '1111' => 300000,
                '1112' => 250000,
                '1113' => 150000,
                '1114' => 100000,
            ];
            foreach ($splits as $code => $amt) {
                if (isset($banks[$code])) {
                    $entries[] = [$banks[$code], $amt, 0, "Opening balance ({$code})"];
                }
            }
        } else {
            $entries[] = [$this->Ac['bank'], $bankOp, 0, 'Opening bank'];
        }

        $entries[] = [$this->Ac['inv'], $invOpen, 0, 'Opening inventory'];
        $entries[] = [$this->Ac['ap'], 0, $apOp, 'Opening payables'];
        $entries[] = [$this->Ac['cap'], 0, $capital, 'Owner capital'];

        $this->addV('journal', $this->ymd($this->fyStart), 'Opening Balance Entry', $entries);
    }

    private function seedDailySalesPurchases(): void
    {
        $this->info('Seeding daily sales & purchases...');
        $VAT_RATE = 0.15;
        $start = $this->fyStart->copy();
        $end = $this->fyEnd->copy();

        $sinv = []; $sitems = []; $pinv = []; $pitems = []; $smov = [];

        for ($d = $start->copy(); $d <= $end; $d->addDay()) {
            if ($d->dayOfWeek === Carbon::FRIDAY) continue;
            $ds = $this->ymd($d);
            $dayCount = $this->RI(2, 4);
            for ($j = 0; $j < $dayCount; $j++) {
                $cust = $this->pick($this->customers);
                $items = $this->pickN($this->products, $this->RI(1, 4));
                $invId = $this->U();
                $subtotal = 0;
                $rows = [];
                foreach ($items as $p) {
                    $qty = $this->RI(1, 8);
                    $price = $p['sp'];
                    $tot = $qty * $price;
                    $subtotal += $tot;
                    $rows[] = [$p['id'],$qty,$price,$tot,$p['iid']];
                }
                $disc = $this->round2($subtotal * $this->pick([0,0,0,0.02,0.05]));
                $net = $this->round2($subtotal - $disc);
                $vat = $this->round2($net * $VAT_RATE);
                $gross = $this->round2($net + $vat);
                $this->sc++;
                $inum = "INV-{$this->fyTag}-" . str_pad((string)$this->sc, 5, '0', STR_PAD_LEFT);
                $sinv[] = [
                    'id'=>$invId,'invoice_number'=>$inum,'invoice_date'=>$ds,'customer_id'=>$cust['id'],
                    'branch_id'=>$this->R()<0.85?$this->BR_DHK:$this->BR_CTG,
                    'total_amount'=>$subtotal,'discount'=>$disc,'net_amount'=>$gross,'status'=>'approved',
                    'created_by'=>$this->UID,'created_at'=>now(),'updated_at'=>now(),
                ];
                foreach ($rows as $r) {
                    $sitems[] = [
                        'id'=>$this->U(),'sales_invoice_id'=>$invId,'product_id'=>$r[4],'quantity'=>$r[1],
                        'price'=>$r[2],'discount'=>0,'total'=>$r[3],
                    ];
                    $smov[] = [
                        'id'=>$this->U(),'product_id'=>$r[4],'item_id'=>$r[4],'warehouse_id'=>$this->WH_DHK,
                        'branch_id'=>$this->BR_DHK,'movement_type'=>'sale','reference_type'=>'sales_invoice',
                        'reference_id'=>$invId,'quantity'=>$r[1],'created_at'=>now(),
                    ];
                }
                $cash = $this->R() < 0.35;
                $dr = $cash ? $this->Ac['cash'] : $this->Ac['ar'];
                $this->addV($cash ? 'receipt' : 'journal', $ds, "Sales Invoice {$inum}", [
                    [$dr, $gross, 0, "Sale to {$cust['name']}"],
                    [$this->Ac['sales'], 0, $net, "Revenue {$inum}"],
                    [$this->Ac['vatOut'], 0, $vat, "Output VAT {$inum}"],
                ]);
                $this->sList[] = ['id'=>$invId,'cid'=>$cust['id'],'date'=>$ds,'net'=>$net,'vat'=>$vat,'gross'=>$gross,'cash'=>$cash,'num'=>$inum];
            }

            if ($this->R() < 0.7) {
                $sup = $this->pick($this->suppliers);
                $items = $this->pickN($this->products, $this->RI(1, 3));
                $pId = $this->U();
                $subtotal = 0;
                $rows = [];
                foreach ($items as $p) {
                    $qty = $this->RI(10, 40);
                    $price = $p['cp'];
                    $tot = $qty * $price;
                    $subtotal += $tot;
                    $rows[] = [$p['id'],$qty,$price,$tot,$p['iid']];
                }
                $vat = $this->round2($subtotal * $VAT_RATE);
                $gross = $this->round2($subtotal + $vat);
                $this->pc++;
                $pnum = "PUR-{$this->fyTag}-" . str_pad((string)$this->pc, 5, '0', STR_PAD_LEFT);
                $credit = $this->R() < 0.6;
                $pinv[] = [
                    'id'=>$pId,'purchase_number'=>$pnum,'purchase_date'=>$ds,'supplier_id'=>$sup['id'],
                    'branch_id'=>$this->BR_DHK,'total_amount'=>$gross,'payment_method'=>$credit?'credit':'cash',
                    'status'=>'approved','created_by'=>$this->UID,'created_at'=>now(),'updated_at'=>now(),
                ];
                foreach ($rows as $r) {
                    $pitems[] = [
                        'id'=>$this->U(),'purchase_id'=>$pId,'product_id'=>$r[4],'quantity'=>$r[1],
                        'unit_price'=>$r[2],'total'=>$r[3],
                    ];
                    $smov[] = [
                        'id'=>$this->U(),'product_id'=>$r[4],'item_id'=>$r[4],'warehouse_id'=>$this->WH_DHK,
                        'branch_id'=>$this->BR_DHK,'movement_type'=>'purchase','reference_type'=>'purchase',
                        'reference_id'=>$pId,'quantity'=>$r[1],'created_at'=>now(),
                    ];
                }
                $cr = $credit ? $this->Ac['ap'] : $this->Ac['cash'];
                $this->addV($credit ? 'journal' : 'payment', $ds, "Purchase {$pnum}", [
                    [$this->Ac['pur'], $subtotal, 0, "Purchase from {$sup['name']}"],
                    [$this->Ac['vatIn'], $vat, 0, "Input VAT {$pnum}"],
                    [$cr, 0, $gross, "Purchase {$pnum}"],
                ]);
                $this->pList[] = ['id'=>$pId,'sid'=>$sup['id'],'date'=>$ds,'subtotal'=>$subtotal,'vat'=>$vat,'gross'=>$gross,'credit'=>$credit,'num'=>$pnum];
            }
        }

        $this->bulk('sales_invoices', $sinv);
        $this->bulk('sales_invoice_items', $sitems);
        $this->bulk('purchases', $pinv);
        $this->bulk('purchase_items', $pitems);
        $this->bulk('stock_movements', $smov);
    }

    private function seedReturns(): void
    {
        $this->info('Seeding returns...');
        $sret = []; $sretItems = [];
        foreach ($this->sList as $s) {
            if ($this->R() > 0.03) continue;
            $items = DB::table('sales_invoice_items')->where('sales_invoice_id', $s['id'])->get();
            if ($items->isEmpty()) continue;
            $rid = $this->U(); $this->src++;
            $rnum = "SRN-{$this->fyTag}-" . str_pad((string)$this->src, 5, '0', STR_PAD_LEFT);
            $retDate = Carbon::parse($s['date'])->addDays($this->RI(3, 15))->toDateString();
            if (Carbon::parse($retDate) > $this->fyEnd) continue;
            $retTotal = 0;
            foreach ($items as $it) {
                $rqty = max(1, (int) floor($it->quantity * 0.3));
                $tot = $this->round2($rqty * $it->price);
                $retTotal += $tot;
                $sretItems[] = [
                    'id'=>$this->U(),'sales_return_id'=>$rid,'product_id'=>$it->product_id,'quantity'=>$rqty,
                    'price'=>$it->price,'total'=>$tot,
                ];
            }
            $sret[] = [
                'id'=>$rid,'return_number'=>$rnum,'return_date'=>$retDate,'sales_invoice_id'=>$s['id'],
                'customer_id'=>$s['cid'],'branch_id'=>$this->BR_DHK,'total_amount'=>$retTotal,
                'reason'=>'Customer return','status'=>'approved','created_by'=>$this->UID,
                'created_at'=>now(),'updated_at'=>now(),
            ];
            $this->addV('journal', $retDate, "Sales Return {$rnum}", [
                [$this->Ac['salesRet'], $retTotal, 0, 'Sales return'],
                [$this->Ac['ar'], 0, $retTotal, 'AR reduction'],
            ]);
        }
        $this->bulk('sales_returns', $sret);
        $this->bulk('sales_return_items', $sretItems);

        $pret = []; $pretItems = [];
        foreach ($this->pList as $p) {
            if ($this->R() > 0.04) continue;
            $items = DB::table('purchase_items')->where('purchase_id', $p['id'])->get();
            if ($items->isEmpty()) continue;
            $rid = $this->U(); $this->prc++;
            $rnum = "PRN-{$this->fyTag}-" . str_pad((string)$this->prc, 5, '0', STR_PAD_LEFT);
            $retDate = Carbon::parse($p['date'])->addDays($this->RI(3, 12))->toDateString();
            if (Carbon::parse($retDate) > $this->fyEnd) continue;
            $retTotal = 0;
            foreach ($items as $it) {
                $rqty = max(1, (int) floor($it->quantity * 0.2));
                $tot = $this->round2($rqty * $it->unit_price);
                $retTotal += $tot;
                $pretItems[] = [
                    'id'=>$this->U(),'purchase_return_id'=>$rid,'product_id'=>$it->product_id,'quantity'=>$rqty,
                    'unit_price'=>$it->unit_price,'total'=>$tot,
                ];
            }
            $pret[] = [
                'id'=>$rid,'return_number'=>$rnum,'return_date'=>$retDate,'purchase_id'=>$p['id'],
                'supplier_id'=>$p['sid'],'branch_id'=>$this->BR_DHK,'total_amount'=>$retTotal,
                'reason'=>'Damaged','status'=>'approved','created_by'=>$this->UID,
                'created_at'=>now(),'updated_at'=>now(),
            ];
            $this->addV('journal', $retDate, "Purchase Return {$rnum}", [
                [$this->Ac['ap'], $retTotal, 0, 'AP reduction'],
                [$this->Ac['purRet'], 0, $retTotal, 'Purchase return'],
            ]);
        }
        $this->bulk('purchase_returns', $pret);
        $this->bulk('purchase_return_items', $pretItems);
    }

    private function seedPayments(): void
    {
        $this->info('Seeding payments...');
        $pays = []; $allocs = [];
        foreach ($this->sList as $s) {
            if ($s['cash']) continue;
            if ($this->R() < 0.78) {
                $pd = Carbon::parse($s['date'])->addDays($this->RI(7, 45));
                if ($pd > $this->fyEnd) continue;
                $fullPay = $this->R() < 0.85;
                $settled = $fullPay ? $s['gross'] : $this->round2($s['gross'] * 0.5);
                $tds = $fullPay && $this->R() < 0.4 ? $this->round2($s['net'] * 0.05) : 0;
                $amt = $this->round2($settled - $tds);
                $pid = $this->U(); $this->pmc++;
                $ref = "RCP-{$this->fyTag}-" . str_pad((string)$this->pmc, 5, '0', STR_PAD_LEFT);
                $method = $this->pick(['cash','bank','mobile_banking']);
                $pays[] = [
                    'id'=>$pid,'party_id'=>$s['cid'],'party_type'=>'customer','payment_date'=>$this->ymd($pd),
                    'amount'=>$settled,'payment_method'=>$method,'reference'=>$ref,'created_by'=>$this->UID,
                    'created_at'=>now(),'updated_at'=>now(),
                ];
                $allocs[] = [
                    'id'=>$this->U(),'payment_id'=>$pid,'invoice_type'=>'sales_invoice','invoice_id'=>$s['id'],
                    'allocated_amount'=>$settled,
                ];
                $cashDr = $method === 'cash' ? $this->Ac['cash'] : $this->Ac['bank'];
                $entries = [[$cashDr, $amt, 0, 'Customer payment']];
                if ($tds > 0) $entries[] = [$this->Ac['tdsr'], $tds, 0, 'TDS deducted by customer'];
                $entries[] = [$this->Ac['ar'], 0, $settled, "AR settle {$s['num']}"];
                $this->addV('receipt', $this->ymd($pd), "Receipt {$ref}", $entries);
            }
        }

        foreach ($this->pList as $p) {
            if (!$p['credit']) continue;
            if ($this->R() < 0.72) {
                $pd = Carbon::parse($p['date'])->addDays($this->RI(10, 50));
                if ($pd > $this->fyEnd) continue;
                $fullPay = $this->R() < 0.8;
                $settled = $fullPay ? $p['gross'] : $this->round2($p['gross'] * 0.5);
                $pid = $this->U(); $this->pmc++;
                $ref = "PAY-{$this->fyTag}-" . str_pad((string)$this->pmc, 5, '0', STR_PAD_LEFT);
                $method = $this->pick(['cash','bank']);
                $pays[] = [
                    'id'=>$pid,'party_id'=>$p['sid'],'party_type'=>'supplier','payment_date'=>$this->ymd($pd),
                    'amount'=>$settled,'payment_method'=>$method,'reference'=>$ref,'created_by'=>$this->UID,
                    'created_at'=>now(),'updated_at'=>now(),
                ];
                $allocs[] = [
                    'id'=>$this->U(),'payment_id'=>$pid,'invoice_type'=>'purchase','invoice_id'=>$p['id'],
                    'allocated_amount'=>$settled,
                ];
                $cashCr = $method === 'cash' ? $this->Ac['cash'] : $this->Ac['bank'];
                $this->addV('payment', $this->ymd($pd), "Payment {$ref}", [
                    [$this->Ac['ap'], $settled, 0, "AP settle {$p['num']}"],
                    [$cashCr, 0, $settled, 'Supplier payment'],
                ]);
            }
        }
        $this->bulk('party_payments', $pays);
        $this->bulk('payment_allocations', $allocs);
    }

    private function seedMonthlyExpensesAndPayroll(): void
    {
        $this->info('Seeding monthly expenses & payroll...');
        $months = [];
        for ($m = $this->fyStart->copy(); $m <= $this->fyEnd; $m->addMonthNoOverflow()) {
            $months[] = $m->copy();
        }

        foreach ($months as $m) {
            $ed = $this->ymd(Carbon::create($m->year, $m->month, $this->RI(3, 7)));
            $rent = 45000; $util = $this->RI(8000, 15000); $off = $this->RI(5000, 12000); $tr = $this->RI(4000, 10000);
            $this->addV('payment', $ed, 'Monthly Rent', [
                [$this->Ac['rent'], $rent, 0, 'Office rent'],
                [$this->Ac['cash'], 0, $rent, 'Rent paid'],
            ]);
            $this->addV('payment', $ed, 'Utility Bills', [
                [$this->Ac['util'], $util, 0, 'Electricity/Internet'],
                [$this->Ac['cash'], 0, $util, 'Utility paid'],
            ]);
            $this->addV('payment', $ed, 'Office Expenses', [
                [$this->Ac['off'], $off, 0, 'Office supplies'],
                [$this->Ac['cash'], 0, $off, 'Office paid'],
            ]);
            $this->addV('payment', $ed, 'Transportation', [
                [$this->Ac['tr'], $tr, 0, 'Transport'],
                [$this->Ac['cash'], 0, $tr, 'Transport paid'],
            ]);
            $dep = $this->RI(50000, 150000);
            $this->addV('contra', $ed, 'Cash Deposit to Bank', [
                [$this->Ac['bank'], $dep, 0, 'Bank deposit'],
                [$this->Ac['cash'], 0, $dep, 'Cash withdraw'],
            ]);
        }

        // Flush vouchers accumulated so far
        $this->flushVouchers();

        $payroll = [];
        $fundTx = [];
        foreach ($months as $m) {
            $eom = Carbon::create($m->year, $m->month, 1)->endOfMonth();
            $pd = $this->ymd($eom);
            $netTot = 0; $pfEmployerTot = 0; $pfEmployeeTot = 0;
            $monthPayroll = [];
            foreach ($this->employees as $e) {
                if (Carbon::parse($e['join']) > $m) continue;
                $hr = (int) floor($e['basic'] * 0.4);
                $med = (int) floor($e['basic'] * 0.1);
                $oth = (int) floor($e['basic'] * 0.05);
                $pfEmployee = (int) floor($e['basic'] * 0.1);
                $pfEmployer = (int) floor($e['basic'] * 0.1);
                $ded = $pfEmployee + $this->pick([0, 0, 500]);
                $gross = $e['basic'] + $hr + $med + $oth;
                $net = $gross - $ded;
                $netTot += $net; $pfEmployeeTot += $pfEmployee; $pfEmployerTot += $pfEmployer;
                $pid = $this->U();
                $payroll[] = [
                    'id'=>$pid,'employee_id'=>$e['id'],'month'=>$m->month,'year'=>$m->year,
                    'basic_salary'=>$e['basic'],'allowances'=>$hr+$med+$oth,'deductions'=>$ded,'net_salary'=>$net,
                    'status'=>'paid','created_at'=>now(),
                ];
                $monthPayroll[] = ['eid'=>$e['id'],'basic'=>$e['basic'],'pfEmp'=>$pfEmployee];
            }
            $grossPayroll = $netTot + $pfEmployeeTot;
            $vid = $this->addV('payment', $pd, "Payroll {$m->format('M Y')}", [
                [$this->Ac['sal'], $grossPayroll, 0, "Gross salary {$m->format('F Y')}"],
                [$this->Ac['pfExp'], $pfEmployerTot, 0, 'PF employer contribution'],
                [$this->Ac['pfLiab'], 0, $pfEmployeeTot + $pfEmployerTot, 'PF liability'],
                [$this->Ac['bank'], 0, $netTot, 'Salary disbursed via bank'],
            ]);
            foreach ($monthPayroll as $r) {
                $fundTx[] = [
                    'id'=>$this->U(),'employee_id'=>$r['eid'],'fund_type'=>'provident_fund','transaction_type'=>'contribution',
                    'employee_amount'=>$r['pfEmp'],'employer_amount'=>$r['pfEmp'],'total_amount'=>$r['pfEmp']*2,
                    'month'=>$m->month,'year'=>$m->year,'voucher_id'=>$vid,'created_by'=>$this->UID,
                    'notes'=>'Monthly PF contribution','created_at'=>now(),
                ];
            }
        }
        $this->bulk('payroll', $payroll);
        $this->bulk('fund_transactions', $fundTx);
        $this->flushVouchers();
    }

    private function flushVouchers(): void
    {
        if (empty($this->vouchers)) return;
        $this->bulk('acc_vouchers', $this->vouchers, 400);
        $this->bulk('voucher_entries', $this->ventries, 600);
        $this->vouchers = [];
        $this->ventries = [];
    }

    private function seedAttendanceAndLeave(): void
    {
        $this->info('Seeding attendance & leave...');
        $att = [];
        for ($d = $this->fyStart->copy(); $d <= $this->fyEnd; $d->addDay()) {
            if ($d->dayOfWeek === Carbon::FRIDAY) continue;
            $ds = $this->ymd($d);
            foreach ($this->employees as $e) {
                if (Carbon::parse($e['join']) > $d) continue;
                $r = $this->R();
                $st = 'present'; $ci = '09:00:00'; $co = '18:00:00';
                if ($r < 0.92) {
                    // present
                } elseif ($r < 0.96) {
                    $st = 'late'; $ci = sprintf('09:%02d:00', $this->RI(15, 55));
                } elseif ($r < 0.98) {
                    $st = 'absent'; $ci = null; $co = null;
                } else {
                    $st = 'leave'; $ci = null; $co = null;
                }
                $att[] = [
                    'id'=>$this->U(),'employee_id'=>$e['id'],'date'=>$ds,'check_in'=>$ci,'check_out'=>$co,'status'=>$st,
                    'created_at'=>now(),
                ];
            }
        }
        $this->bulk('attendance', $att, 800);

        $leaves = [];
        foreach ($this->employees as $e) {
            $n = $this->RI(1, 3);
            for ($i = 0; $i < $n; $i++) {
                $offsetDays = $this->RI(15, 330);
                $s = $this->fyStart->copy()->addDays($offsetDays);
                if ($s > $this->fyEnd) continue;
                $dur = $this->RI(1, 3);
                $en = $s->copy()->addDays($dur - 1);
                $endDate = $en->gt($this->fyEnd) ? $this->fyEnd : $en;
                $leaves[] = [
                    'id'=>$this->U(),'employee_id'=>$e['id'],'leave_type_id'=>$this->pick($this->lts)->id,
                    'start_date'=>$this->ymd($s),'end_date'=>$this->ymd($endDate),
                    'reason'=>$this->pick(['Personal','Family event','Medical','Travel']),
                    'status'=>$this->pick(['approved','approved','approved','pending']),
                    'approved_by'=>$this->UID,
                    'created_at'=>now(),
                ];
            }
        }
        $this->bulk('leave_requests', $leaves);
    }

    private function seedStockTransfers(): void
    {
        $this->info('Seeding stock transfers...');
        $transfers = [];
        $months = [];
        for ($m = $this->fyStart->copy(); $m <= $this->fyEnd; $m->addMonthNoOverflow()) {
            $months[] = $m->copy();
        }
        foreach ($months as $m) {
            $cnt = $this->RI(1, 3);
            for ($i = 0; $i < $cnt; $i++) {
                $td = $this->ymd(Carbon::create($m->year, $m->month, $this->RI(8, 25)));
                $p = $this->pick($this->products);
                $this->tc++;
                $transfers[] = [
                    'id'=>$this->U(),'transfer_number'=>'STR-'.$this->fyTag.'-'.str_pad((string)$this->tc,5,'0',STR_PAD_LEFT),
                    'transfer_date'=>$td,'from_warehouse_id'=>$this->WH_DHK,'to_warehouse_id'=>$this->WH_CTG,
                    'item_id'=>$p['iid'],'quantity'=>$this->RI(5,30),'status'=>'completed',
                    'notes'=>'Branch replenishment','created_by'=>$this->UID,
                    'created_at'=>now(),'updated_at'=>now(),
                ];
            }
        }
        $this->bulk('stock_transfers', $transfers);
    }

    private function seedManufacturing(): void
    {
        $this->info('Seeding manufacturing...');
        $finished = array_slice($this->products, 0, 4);
        $rawPool = array_slice($this->products, 10);
        $boms = []; $bomItemsRows = [];
        foreach ($finished as $i => $fp) {
            $bid = $this->U();
            $rms = $this->pickN($rawPool, 3);
            $bomCost = array_reduce($rms, fn($s,$r) => $s + $r['cp'] * 2, 0.0);
            $boms[] = [
                'id'=>$bid,'bom_number'=>'BOM-'.str_pad((string)($i+1),4,'0',STR_PAD_LEFT),
                'name'=>"{$fp['name']} BOM",'product_id'=>$fp['id'],
                'current_rate'=>$bomCost,'previous_rate'=>0,
                'created_at'=>now(),'updated_at'=>now(),
            ];
            foreach ($rms as $r) {
                $bomItemsRows[] = [
                    'id'=>$this->U(),'bom_id'=>$bid,'material_id'=>$r['id'],'quantity'=>2,'unit'=>'PCS',
                    'wastage_pct'=>5,'unit_price'=>$r['cp'],
                ];
            }
        }
        $this->bulk('bill_of_materials', $boms);
        $this->bulk('bom_items', $bomItemsRows);

        $prodEntries = []; $prodMats = [];
        $months = [];
        for ($m = $this->fyStart->copy(); $m <= $this->fyEnd; $m->addMonthNoOverflow()) {
            $months[] = $m->copy();
        }
        foreach ($months as $m) {
            foreach ($boms as $b) {
                if ($this->R() > 0.6) continue;
                $pd = $this->ymd(Carbon::create($m->year, $m->month, $this->RI(10, 20)));
                $qty = $this->RI(5, 20);
                $rmCost = $this->round2($b['current_rate'] * $qty);
                $labor = $this->round2($qty * 200);
                $elec = $this->round2($qty * 50);
                $total = $this->round2($rmCost + $labor + $elec);
                $pid = $this->U(); $this->prdc++;
                $prodEntries[] = [
                    'id'=>$pid,'production_number'=>'PRD-'.$this->fyTag.'-'.str_pad((string)$this->prdc,5,'0',STR_PAD_LEFT),
                    'production_date'=>$pd,'product_id'=>$b['product_id'],'bom_id'=>$b['id'],'quantity'=>$qty,
                    'branch_id'=>$this->BR_DHK,'raw_material_cost'=>$rmCost,'labor_cost'=>$labor,'electricity_cost'=>$elec,
                    'total_cost'=>$total,'status'=>'completed','created_by'=>$this->UID,
                    'created_at'=>now(),'updated_at'=>now(),
                ];
                $bMats = array_filter($bomItemsRows, fn($x) => $x['bom_id'] === $b['id']);
                foreach ($bMats as $bm) {
                    $prodMats[] = [
                        'id'=>$this->U(),'production_id'=>$pid,'material_id'=>$bm['material_id'],
                        'quantity'=>$bm['quantity']*$qty,'cost'=>$bm['unit_price']*$bm['quantity']*$qty,
                    ];
                }
            }
        }
        $this->bulk('production_entries', $prodEntries);
        $this->bulk('production_materials', $prodMats);
    }

    private function seedSalesWorkflow(): void
    {
        $this->info('Seeding BD VAT sales workflow...');
        $VAT_RATE = 0.15;
        $vehicles = ['DHK-METRO-1234','DHK-METRO-5678','CTG-METRO-9012','DHK-METRO-3456','CTG-METRO-7890'];
        $drivers = ['Karim Mia','Rahim Uddin','Salam Hossain','Jamal Khan','Nasir Ahmed'];

        $POs = []; $POitems = [];
        $VCHs = []; $VCHitems = [];
        $DCs = []; $CRs = []; $HRs = [];
        $INV2 = []; $INV2items = []; $INVCHs = [];
        $IPAYs = []; $TDSs = [];

        for ($d = $this->fyStart->copy(); $d <= $this->fyEnd; $d->addWeek()) {
            $cust = $this->pick($this->customers);
            $its = $this->pickN($this->products, $this->RI(2, 4));
            $poDate = $this->ymd($d);
            $delDate = $this->ymd($d->copy()->addDays($this->RI(2, 7)));
            $poId = $this->U(); $this->poc++;
            $poNum = "PO-{$this->fyTag}-" . str_pad((string)$this->poc, 5, '0', STR_PAD_LEFT);
            $poSub = 0; $poVat = 0;
            $poiData = [];
            foreach ($its as $idx => $p) {
                $qty = $this->RI(20, 80); $rate = $p['sp']; $sub = $qty * $rate; $vat = $this->round2($sub * $VAT_RATE);
                $poSub += $sub; $poVat += $vat;
                $poiData[] = [
                    'id'=>$this->U(),'po_id'=>$poId,'product_id'=>$p['id'],'qty_ordered'=>$qty,'qty_delivered'=>$qty,'qty_remaining'=>0,
                    'rate'=>$rate,'vat_pct'=>15,'line_subtotal'=>$sub,'line_vat'=>$vat,'line_total'=>$sub+$vat,'sort_order'=>$idx,
                ];
            }
            $poGrand = $this->round2($poSub + $poVat);
            $POs[] = [
                'id'=>$poId,'po_number'=>$poNum,'po_date'=>$poDate,'customer_id'=>$cust['id'],'delivery_date'=>$delDate,
                'status'=>'closed','subtotal'=>$this->round2($poSub),'vat_amount'=>$this->round2($poVat),'grand_total'=>$poGrand,
                'notes'=>'Demo PO','branch_id'=>$this->BR_DHK,'financial_year_id'=>$this->FY,'created_by'=>$this->UID,
                'created_at'=>now(),'updated_at'=>now(),
            ];
            $POitems = array_merge($POitems, $poiData);

            $vciByProduct = [];
            foreach ($poiData as $idx => $r) {
                // VAT Challan item (per product)
                $vciId = $this->U();
                $vciByProduct[$r['product_id']] = $vciId;
            }

            // VAT Challan
            $vchId = $this->U(); $this->vchc++;
            $vchNum = "VCH-{$this->fyTag}-" . str_pad((string)$this->vchc, 5, '0', STR_PAD_LEFT);
            $vchDate = $this->ymd(Carbon::parse($poDate)->addDays($this->RI(1, 3)));
            $VCHs[] = [
                'id'=>$vchId,'challan_number'=>$vchNum,'challan_date'=>$vchDate,'customer_id'=>$cust['id'],'purchase_order_id'=>$poId,
                'vehicle_no'=>$this->pick($vehicles),'driver_name'=>$this->pick($drivers),'subtotal'=>$this->round2($poSub),'vat_amount'=>$this->round2($poVat),
                'grand_total'=>$poGrand,'source'=>'purchase_order','status'=>'issued',
                'branch_id'=>$this->BR_DHK,'financial_year_id'=>$this->FY,'created_by'=>$this->UID,
                'created_at'=>now(),'updated_at'=>now(),
            ];

            foreach ($poiData as $idx => $r) {
                $vciId = $vciByProduct[$r['product_id']];
                $VCHitems[] = [
                    'id'=>$vciId,'vat_challan_id'=>$vchId,'product_id'=>$r['product_id'],'purchase_order_item_id'=>$r['id'],'po_qty_consumed'=>$r['qty_ordered'],'qty'=>$r['qty_ordered'],
                    'rate'=>$r['rate'],'vat_pct'=>15,'line_subtotal'=>$r['line_subtotal'],'vat_amount'=>$r['line_vat'],
                    'line_total'=>$r['line_total'],'sort_order'=>$idx,
                ];

                // Delivery Challan
                $this->dcc++;
                $dcId = $this->U();
                $DCs[] = [
                    'id'=>$dcId,'dc_number'=>'DC-'.$this->fyTag.'-'.str_pad((string)$this->dcc,5,'0',STR_PAD_LEFT),'dc_date'=>$vchDate,
                    'vat_challan_id'=>$vchId,'vat_challan_item_id'=>$vciId,'product_id'=>$r['product_id'],'qty'=>$r['qty_ordered'],
                    'customer_id'=>$cust['id'],'status'=>'invoiced','branch_id'=>$this->BR_DHK,'created_by'=>$this->UID,
                    'created_at'=>now(),'updated_at'=>now(),
                ];
                $CRs[] = [
                    'id'=>$this->U(),'delivery_challan_id'=>$dcId,
                    'receive_date'=>$this->ymd(Carbon::parse($vchDate)->addDays($this->RI(1, 2))),
                    'received_by_name'=>$cust['name'],'transport_info'=>'Truck','created_by'=>$this->UID,
                    'created_at'=>now(),
                ];
                $HRs[] = [
                    'id'=>$this->U(),'delivery_challan_id'=>$dcId,
                    'ho_receive_date'=>$this->ymd(Carbon::parse($vchDate)->addDays($this->RI(3, 5))),
                    'verified_by'=>$this->UID,'missing_flag'=>false,
                    'created_at'=>now(),
                ];
            }

            // Invoice v2
            $this->inv2c++;
            $invId = $this->U();
            $invNum = "INV2-{$this->fyTag}-" . str_pad((string)$this->inv2c, 5, '0', STR_PAD_LEFT);
            $invDate = $this->ymd(Carbon::parse($vchDate)->addDays($this->RI(5, 10)));
            $tdsAmt = $this->R() < 0.5 ? $this->round2($poSub * 0.05) : 0;
            $paidAmt = $this->R() < 0.7 ? $this->round2($poGrand - $tdsAmt) : 0;
            $dueAmt = $this->round2($poGrand - $paidAmt - $tdsAmt);
            $invStatus = $dueAmt <= 0.01 ? 'paid' : ($paidAmt > 0 ? 'partial' : 'issued');
            $invVid = $this->addV('journal', $invDate, "Tax Invoice {$invNum}", [
                [$this->Ac['ar'], $poGrand, 0, "AR {$invNum}"],
                [$this->Ac['sales'], 0, $this->round2($poSub), "Sales {$invNum}"],
                [$this->Ac['vatOut'], 0, $this->round2($poVat), "Output VAT {$invNum}"],
            ]);
            $INV2[] = [
                'id'=>$invId,'invoice_number'=>$invNum,'invoice_date'=>$invDate,'customer_id'=>$cust['id'],'mode'=>'single',
                'subtotal'=>$this->round2($poSub),'vat_total'=>$this->round2($poVat),'grand_total'=>$poGrand,
                'paid_amount'=>$paidAmt,'tds_amount'=>$tdsAmt,'due_amount'=>$dueAmt,'status'=>$invStatus,'voucher_id'=>$invVid,
                'branch_id'=>$this->BR_DHK,'financial_year_id'=>$this->FY,'created_by'=>$this->UID,
                'created_at'=>now(),'updated_at'=>now(),
            ];
            foreach ($poiData as $idx => $r) {
                $INV2items[] = [
                    'id'=>$this->U(),'invoice_id'=>$invId,'product_id'=>$r['product_id'],'qty'=>$r['qty_ordered'],'rate'=>$r['rate'],
                    'vat_pct'=>15,'line_subtotal'=>$r['line_subtotal'],'vat_amount'=>$r['line_vat'],'line_total'=>$r['line_total'],
                    'source_vat_challan_item_id'=>$vciByProduct[$r['product_id']],'sort_order'=>$idx,
                ];
            }
            $INVCHs[] = ['id'=>$this->U(),'invoice_id'=>$invId,'vat_challan_id'=>$vchId,'created_at'=>now()];

            // Invoice Payment
            if ($paidAmt > 0) {
                $this->ipayc++;
                $ipId = $this->U();
                $ipNum = "RCP-{$this->fyTag}-" . str_pad((string)$this->ipayc, 5, '0', STR_PAD_LEFT);
                $ipDate = $this->ymd(Carbon::parse($invDate)->addDays($this->RI(7, 30)));
                $mode = $this->pick(['bank','cash','cheque','online']);
                $cashDr = $mode === 'cash' ? $this->Ac['cash'] : $this->Ac['bank'];
                $entries = [[$cashDr, $paidAmt, 0, "Receipt {$ipNum}"]];
                if ($tdsAmt > 0) $entries[] = [$this->Ac['tdsr'], $tdsAmt, 0, 'TDS deducted'];
                $entries[] = [$this->Ac['ar'], 0, $this->round2($paidAmt + $tdsAmt), "AR settle {$invNum}"];
                $ipVid = $this->addV('receipt', $ipDate, "Invoice Payment {$ipNum}", $entries);
                $IPAYs[] = [
                    'id'=>$ipId,'payment_number'=>$ipNum,'invoice_id'=>$invId,'payment_date'=>$ipDate,'mode'=>$mode,
                    'amount_received'=>$paidAmt,'tds_amount'=>$tdsAmt,'total_settled'=>$this->round2($paidAmt+$tdsAmt),
                    'reference'=>'TXN-'.$this->ipayc,'voucher_id'=>$ipVid,'branch_id'=>$this->BR_DHK,'financial_year_id'=>$this->FY,'created_by'=>$this->UID,
                    'created_at'=>now(),
                ];
                if ($tdsAmt > 0) {
                    $this->tdsc++;
                    $TDSs[] = [
                        'id'=>$this->U(),'invoice_id'=>$invId,'payment_id'=>$ipId,'tds_pct'=>5,'tds_amount'=>$tdsAmt,
                        'certificate_no'=>'TDS-'.$this->fyTag.'-'.str_pad((string)$this->tdsc,5,'0',STR_PAD_LEFT),'certificate_date'=>$ipDate,
                        'voucher_id'=>$ipVid,'created_by'=>$this->UID,
                        'created_at'=>now(),
                    ];
                }
            }
        }

        $this->flushVouchers();
        $this->bulk('purchase_orders', $POs);
        $this->bulk('purchase_order_items', $POitems);
        $this->bulk('vat_challans', $VCHs);
        $this->bulk('vat_challan_items', $VCHitems);
        $this->bulk('delivery_challans', $DCs);
        $this->bulk('customer_receives', $CRs);
        $this->bulk('ho_receives', $HRs);
        $this->bulk('sales_invoices_v2', $INV2);
        $this->bulk('sales_invoice_items_v2', $INV2items);
        $this->bulk('invoice_challans', $INVCHs);
        $this->bulk('invoice_payments', $IPAYs);
        $this->bulk('tds_entries', $TDSs);
    }

    private function seedNumberSequences(): void
    {
        $this->info('Updating number sequences...');
        $seqs = [
            ['id'=>'sales_invoice','prefix'=>'INV','current_number'=>$this->sc,'year'=>2026,'description'=>'Sales Invoice'],
            ['id'=>'purchase','prefix'=>'PUR','current_number'=>$this->pc,'year'=>2026,'description'=>'Purchase'],
            ['id'=>'sales_return','prefix'=>'SRN','current_number'=>$this->src,'year'=>2026,'description'=>'Sales Return'],
            ['id'=>'purchase_return','prefix'=>'PRN','current_number'=>$this->prc,'year'=>2026,'description'=>'Purchase Return'],
            ['id'=>'production','prefix'=>'PRD','current_number'=>$this->prdc,'year'=>2026,'description'=>'Production'],
            ['id'=>'stock_transfer','prefix'=>'STR','current_number'=>$this->tc,'year'=>2026,'description'=>'Stock Transfer'],
            ['id'=>'journal_voucher','prefix'=>'JV','current_number'=>$this->vcJV,'year'=>2026,'description'=>'Journal Voucher'],
            ['id'=>'payment_voucher','prefix'=>'PV','current_number'=>$this->vcPV,'year'=>2026,'description'=>'Payment Voucher'],
            ['id'=>'receipt_voucher','prefix'=>'RV','current_number'=>$this->vcRV,'year'=>2026,'description'=>'Receipt Voucher'],
            ['id'=>'contra_voucher','prefix'=>'CV','current_number'=>$this->vcCV,'year'=>2026,'description'=>'Contra Voucher'],
            ['id'=>'purchase_order','prefix'=>'PO','current_number'=>$this->poc,'year'=>2026,'description'=>'Customer Purchase Order'],
            ['id'=>'vat_challan','prefix'=>'VCH','current_number'=>$this->vchc,'year'=>2026,'description'=>'VAT Challan (Mushak 6.3)'],
            ['id'=>'delivery_challan','prefix'=>'DC','current_number'=>$this->dcc,'year'=>2026,'description'=>'Delivery Challan'],
            ['id'=>'sales_invoice_v2','prefix'=>'INV2','current_number'=>$this->inv2c,'year'=>2026,'description'=>'Consolidated Sales Invoice'],
            ['id'=>'invoice_payment','prefix'=>'RCP','current_number'=>$this->ipayc,'year'=>2026,'description'=>'Invoice Payment Receipt'],
            ['id'=>'tds_entry','prefix'=>'TDS','current_number'=>$this->tdsc,'year'=>2026,'description'=>'TDS Entry'],
        ];
        foreach ($seqs as $s) {
            DB::table('number_sequences')->updateOrInsert(['id'=>$s['id']], $s);
        }
    }

    private function seedPartyNotes(): void
    {
        $this->info('Seeding party notes...');
        $noteSnippets = [
            'Reliable client — pays within 15 days.',
            'Requested quarterly statement.',
            'Prefers delivery before noon.',
            'Negotiated 2% discount on bulk orders.',
            'Phone updated; check before next billing.',
        ];
        $notes = [];
        foreach (array_slice($this->customers, 0, 8) as $c) {
            $notes[] = [
                'id'=>$this->U(),'party_id'=>$c['id'],'party_type'=>'customer',
                'note'=>$this->pick($noteSnippets),'created_by'=>$this->UID,'created_at'=>now(),
            ];
        }
        foreach (array_slice($this->suppliers, 0, 5) as $s) {
            $notes[] = [
                'id'=>$this->U(),'party_id'=>$s['id'],'party_type'=>'supplier',
                'note'=>$this->pick($noteSnippets),'created_by'=>$this->UID,'created_at'=>now(),
            ];
        }
        $this->bulk('party_notes', $notes);
    }
}
