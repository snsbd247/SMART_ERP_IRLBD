<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;

/**
 * One-off migration: pull all public-schema data from a Supabase project
 * (REST/PostgREST) into the local MySQL database.
 *
 * Usage:
 *   1. Add to .env temporarily:
 *        SUPABASE_URL=https://ezwsrtsqiumhxukwgiou.supabase.co
 *        SUPABASE_SERVICE_KEY=<service_role_key>
 *   2. Run: php artisan data:pull-from-supabase --truncate
 *   3. Remove the two env vars from .env afterwards.
 *
 * NOTE: This command uses HTTP only — it does NOT add any Supabase SDK
 * to the application, so no permanent linkage is created.
 */
class PullFromSupabase extends Command
{
    protected $signature = 'data:pull-from-supabase
                            {--truncate : Truncate target MySQL tables before import}
                            {--only= : Comma-separated list of tables (default: all)}
                            {--dry-run : Show counts only}';
    protected $description = 'One-off: pull all data from a Supabase project into MySQL via REST API';

    /**
     * Order matters for FK integrity. Children listed AFTER parents.
     */
    private array $tables = [
        // Foundation / config
        'branches', 'company_settings', 'system_settings', 'module_settings',
        'financial_years', 'number_sequences', 'units', 'item_categories',
        'product_categories', 'warehouses', 'stock_groups', 'stock_voucher_types',
        'shifts', 'departments', 'designations', 'sections', 'leave_types',
        'custom_roles', 'role_permissions',
        // Users (profiles -> employees -> user_roles)
        'profiles', 'employees', 'user_roles', 'user_custom_roles',
        'employee_bank_info', 'employee_education', 'employee_emergency_contacts',
        'employee_experience', 'employee_documents', 'employee_fund_settings',
        'salary_structures', 'face_data',
        // Accounting
        'chart_of_accounts', 'ifrs_account_mapping', 'acc_vouchers', 'voucher_entries',
        // Parties
        'customers', 'suppliers', 'party_notes',
        // Inventory / products
        'item_master', 'products', 'raw_materials',
        'stock_batches', 'warehouse_stock', 'stock_ledger', 'stock_movements',
        'stock_transfers', 'physical_stock_entries', 'physical_stock_items',
        'stock_damage_entries', 'stock_damage_items',
        // Manufacturing
        'mfg_processes', 'bill_of_materials', 'bom_items', 'bom_expenses',
        'production_entries', 'production_materials',
        'consumption_entries', 'consumption_items', 'finished_goods_entries',
        // Purchase
        'purchase_orders', 'purchase_order_items', 'po_amendments',
        'purchases', 'purchase_items',
        'purchase_returns', 'purchase_return_items',
        // Sales
        'sales_invoices', 'sales_invoice_items',
        'sales_invoices_v2', 'sales_invoice_items_v2',
        'sales_returns', 'sales_return_items',
        'dispatches', 'dispatch_items', 'dispatch_po_allocations', 'dispatch_status_logs',
        'delivery_challans', 'invoice_challans', 'invoice_payments', 'invoice_status_logs',
        'vat_challans', 'vat_challan_items',
        // Payments
        'party_payments', 'payment_allocations', 'customer_receives', 'ho_receives',
        'tds_entries', 'fund_transactions',
        // HRM
        'attendance', 'overtime_records', 'leave_requests', 'payroll',
        // Misc
        'biometric_devices', 'biometric_logs', 'sms_logs',
        'conversations', 'conversation_participants', 'messages',
        'login_logs', 'user_activities', 'audit_log',
        'page_shortcuts', 'user_favorite_pages',
        'backup_history', 'backup_settings',
    ];

    public function handle(): int
    {
        $url = env('SUPABASE_URL');
        $key = env('SUPABASE_SERVICE_KEY');
        if (!$url || !$key) {
            $this->error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env first.');
            return 1;
        }

        $only = $this->option('only');
        $tables = $only ? array_map('trim', explode(',', $only)) : $this->tables;
        $truncate = (bool) $this->option('truncate');
        $dry = (bool) $this->option('dry-run');

        $totals = ['fetched' => 0, 'inserted' => 0, 'skipped' => 0];

        // Disable FK checks for clean truncate/insert order
        if (!$dry) DB::statement('SET FOREIGN_KEY_CHECKS=0');

        foreach ($tables as $table) {
            if (!Schema::hasTable($table)) {
                $this->warn("SKIP $table (no MySQL table)");
                $totals['skipped']++;
                continue;
            }

            $rows = $this->fetchAll($url, $key, $table);
            if ($rows === null) {
                $this->warn("SKIP $table (not in Supabase or fetch error)");
                $totals['skipped']++;
                continue;
            }

            $totals['fetched'] += count($rows);
            $this->line(sprintf('%-40s fetched=%d', $table, count($rows)));

            if ($dry || empty($rows)) continue;

            if ($truncate) DB::table($table)->truncate();

            // Restrict to columns that actually exist in MySQL
            $cols = Schema::getColumnListing($table);
            $clean = array_map(function ($r) use ($cols) {
                $out = [];
                foreach ($cols as $c) {
                    if (array_key_exists($c, $r)) {
                        $v = $r[$c];
                        $out[$c] = is_array($v) ? json_encode($v) : $v;
                    }
                }
                return $out;
            }, $rows);

            foreach (array_chunk($clean, 200) as $batch) {
                DB::table($table)->insertOrIgnore($batch);
            }
            $totals['inserted'] += count($clean);
        }

        if (!$dry) DB::statement('SET FOREIGN_KEY_CHECKS=1');

        $this->info(sprintf(
            'DONE — fetched=%d inserted=%d skipped_tables=%d',
            $totals['fetched'], $totals['inserted'], $totals['skipped']
        ));
        $this->warn('Remember to REMOVE SUPABASE_URL and SUPABASE_SERVICE_KEY from .env.');
        return 0;
    }

    private function fetchAll(string $url, string $key, string $table): ?array
    {
        $all = [];
        $offset = 0;
        $limit = 1000;
        while (true) {
            $res = Http::withHeaders([
                'apikey' => $key,
                'Authorization' => 'Bearer ' . $key,
                'Accept' => 'application/json',
                'Range-Unit' => 'items',
                'Range' => "$offset-" . ($offset + $limit - 1),
            ])->get(rtrim($url, '/') . "/rest/v1/$table", ['select' => '*']);

            if ($res->status() === 404) return null;
            if (!$res->successful()) {
                $this->error("  $table HTTP {$res->status()}: " . substr($res->body(), 0, 200));
                return null;
            }
            $rows = $res->json() ?? [];
            $all = array_merge($all, $rows);
            if (count($rows) < $limit) break;
            $offset += $limit;
        }
        return $all;
    }
}
