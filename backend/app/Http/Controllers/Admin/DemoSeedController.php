<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class DemoSeedController extends BaseController
{
    /**
     * Transactional table list — kept in sync with SeedDemoData::resetTransactionsOnly().
     */
    public const TRANSACTIONAL_TABLES = [
        'lc_charges','purchase_return_items_v2','supplier_payment_allocations','supplier_bill_items_v2',
        'grn_items_v2','po_amendments_v2','po_pr_links','purchase_order_items_v2','purchase_requisition_items',
        'purchase_approval_history','purchase_audit_log',
        'purchase_returns_v2','supplier_payments_v2','supplier_bills_v2','grns_v2','lc_documents',
        'purchase_orders_v2','purchase_requisitions',
        'voucher_entries','payment_allocations','sales_invoice_items','sales_return_items','purchase_items',
        'purchase_return_items','purchase_order_items','sales_invoice_items_v2','invoice_status_logs',
        'po_amendments','vat_challan_items','invoice_payments','invoice_challans','tds_entries',
        'customer_receives','ho_receives','stock_movements','stock_ledger','production_materials',
        'fund_transactions','overtime_records','leave_requests','attendance','biometric_logs','login_logs',
        'backup_history','party_notes','messages','conversation_participants','payroll',
        'stock_adjustments','physical_stock_items','stock_damage_items','consumption_items','sms_logs',
        'user_activities','warehouse_stock','stock_batches',
        'sales_returns','purchase_returns','physical_stock_entries','stock_damage_entries',
        'consumption_entries','finished_goods_entries',
        'sales_invoices_v2','delivery_challans','vat_challans','purchase_orders','stock_transfers',
        'acc_vouchers','party_payments','sales_invoices','purchases','production_entries',
        'conversations','number_sequences',
    ];

    /**
     * Master/configuration tables that must NOT be touched by "Reset Transactions Only".
     */
    public const PRESERVED_TABLES = [
        'customers','suppliers','products','item_master','raw_materials','item_categories','units',
        'warehouses','product_categories','stock_groups','branches','financial_years','chart_of_accounts',
        'ifrs_account_mapping','departments','designations','leave_types','employees','employee_documents',
        'employee_bank_info','employee_education','employee_experience','employee_emergency_contacts',
        'employee_fund_settings','salary_structures','bill_of_materials','bom_items','bom_expenses',
        'company_settings','module_settings','system_settings','user_roles','user_custom_roles',
        'custom_roles','role_permissions','users','profiles','page_shortcuts','user_favorite_pages',
        'user_theme_preferences','backup_settings','purchase_settings','purchase_types','purchase_coa_mapping',
        'purchase_approval_matrix','mfg_processes','shifts','sections','biometric_devices','stock_voucher_types',
        'face_data','audit_log',
    ];

    public function run(Request $request): JsonResponse
    {
        if (!$request->user() || !$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can seed demo data.', 403);
        }

        @set_time_limit(600);
        @ini_set('memory_limit', '512M');

        $mode   = $request->input('mode', 'full');
        $dryRun = (bool) $request->input('dry_run', false);

        if (!in_array($mode, ['full', 'reset', 'transactions'], true)) {
            return $this->error('Invalid demo seed mode.', 422);
        }
        // Dry-run only makes sense for "transactions" mode right now.
        if ($dryRun && $mode !== 'transactions') {
            return $this->error('Dry-run is only supported for the "transactions" mode.', 422);
        }

        $this->audit($request, $mode, $dryRun ? 'dry_run_started' : 'started', 'Demo seed action started.');

        try {
            // Auto-run any pending migrations before touching data (skipped on dry-run).
            $migrationInfo = null;
            if (!$dryRun) {
                $migrationInfo = $this->ensureMigrationsUpToDate();
            }

            if ($dryRun && $mode === 'transactions') {
                $preview = $this->previewTransactionWipe();
                $this->audit($request, $mode, 'dry_run_success', 'Dry-run preview generated.', ['preview' => $preview]);
                return $this->success([
                    'success'    => true,
                    'mode'       => $mode,
                    'dry_run'    => true,
                    'preview'    => $preview,
                    'migrations' => $migrationInfo,
                ], 'Dry-run: tables that WOULD be cleared (nothing was deleted).');
            }

            $args = match ($mode) {
                'reset'        => ['--wipe' => true],
                'transactions' => ['--wipe-transactions' => true],
                default        => ['--reset' => true],
            };
            $exitCode = Artisan::call('demo:seed', $args);
            $output   = Artisan::output();

            if ($exitCode !== 0) {
                Log::error('demo:seed failed', ['output' => $output]);
                $this->audit($request, $mode, 'failed', 'Demo seeder failed. Check logs.', ['output' => trim($output)]);
                return $this->error('Demo seeder failed. Check logs.', 500);
            }

            $stats = $this->collectStats();
            $message = match ($mode) {
                'reset'        => 'Demo data reset successfully',
                'transactions' => 'Transactional data cleared successfully (masters & configuration preserved)',
                default        => 'Demo data seeded successfully',
            };
            $this->audit($request, $mode, 'success', $message, [
                'stats'      => $stats,
                'output'     => trim($output),
                'migrations' => $migrationInfo,
            ]);

            return $this->success([
                'success'    => true,
                'mode'       => $mode,
                'stats'      => $stats,
                'output'     => trim($output),
                'migrations' => $migrationInfo,
            ], $message);
        } catch (\Throwable $e) {
            Log::error('demo:seed exception: ' . $e->getMessage());
            $this->audit($request, $mode, 'failed', $e->getMessage());
            return $this->error('Seeder error: ' . $e->getMessage(), 500);
        }
    }

    /**
     * GET /v1/admin/demo/audit-tables
     * Returns the live inventory of transactional vs. preserved tables along with row counts.
     */
    public function auditTables(Request $request): JsonResponse
    {
        if (!$request->user() || !$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can view this report.', 403);
        }

        $txn = [];
        $txnTotal = 0;
        foreach (self::TRANSACTIONAL_TABLES as $t) {
            $exists = Schema::hasTable($t);
            $count  = 0;
            if ($exists) {
                try { $count = (int) DB::table($t)->count(); } catch (\Throwable $e) { $count = -1; }
            }
            $txnTotal += max(0, $count);
            $txn[] = ['table' => $t, 'exists' => $exists, 'rows' => $count, 'will_wipe' => $exists];
        }

        $preserved = [];
        foreach (self::PRESERVED_TABLES as $t) {
            $exists = Schema::hasTable($t);
            $count  = 0;
            if ($exists) {
                try { $count = (int) DB::table($t)->count(); } catch (\Throwable $e) { $count = -1; }
            }
            $preserved[] = ['table' => $t, 'exists' => $exists, 'rows' => $count];
        }

        return $this->success([
            'transactional' => $txn,
            'preserved'     => $preserved,
            'summary'       => [
                'transactional_tables' => count(self::TRANSACTIONAL_TABLES),
                'transactional_rows'   => $txnTotal,
                'preserved_tables'     => count(self::PRESERVED_TABLES),
                'generated_at'         => now()->toIso8601String(),
            ],
        ], 'Table audit report');
    }

    /**
     * GET /v1/admin/demo/audit-log/export?format=csv
     * Streams Reset/Seed audit log entries as CSV.
     */
    public function auditExport(Request $request): StreamedResponse
    {
        abort_unless($request->user() && $request->user()->isSuperAdmin(), 403, 'Super Admins only.');

        $rows = DB::table('audit_log')
            ->where('module', 'backup')
            ->whereIn('action', [
                'demo_seed_full','demo_seed_reset','demo_seed_transactions_only',
                'demo_reset','demo_reset_transactions_only',
            ])
            ->orderByDesc('created_at')
            ->limit(5000)
            ->get();

        $filename = 'demo-seed-audit-' . now()->format('Ymd-His') . '.csv';

        return response()->streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['created_at','user_name','action','details','ip_address','user_agent']);
            foreach ($rows as $r) {
                fputcsv($out, [
                    $r->created_at ?? '',
                    $r->user_name ?? '',
                    $r->action ?? '',
                    $r->details ?? '',
                    $r->ip_address ?? '',
                    $r->user_agent ?? '',
                ]);
            }
            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /**
     * Run `migrate --force` if any migrations are pending. Returns a short status payload.
     */
    private function ensureMigrationsUpToDate(): array
    {
        try {
            Artisan::call('migrate:status');
            $statusOut = Artisan::output();
            $pending = (bool) preg_match('/\|\s*Pending\s*\|/i', $statusOut);
            if (!$pending) {
                return ['status' => 'up_to_date', 'ran' => 0];
            }
            Artisan::call('migrate', ['--force' => true]);
            $migrateOut = Artisan::output();
            return [
                'status' => 'migrated',
                'output' => trim($migrateOut),
            ];
        } catch (\Throwable $e) {
            Log::warning('auto-migrate before demo seed failed: ' . $e->getMessage());
            return ['status' => 'error', 'error' => $e->getMessage()];
        }
    }

    /**
     * Dry-run preview: count rows in every transactional table without deleting.
     */
    private function previewTransactionWipe(): array
    {
        $rows = [];
        $totalRows = 0;
        $tablesToWipe = 0;
        foreach (self::TRANSACTIONAL_TABLES as $t) {
            $exists = Schema::hasTable($t);
            $count  = 0;
            if ($exists) {
                try { $count = (int) DB::table($t)->count(); } catch (\Throwable $e) { $count = -1; }
                $tablesToWipe++;
                $totalRows += max(0, $count);
            }
            $rows[] = ['table' => $t, 'exists' => $exists, 'rows' => $count];
        }
        return [
            'tables'           => $rows,
            'tables_to_wipe'   => $tablesToWipe,
            'total_rows'       => $totalRows,
            'preserved_tables' => count(self::PRESERVED_TABLES),
        ];
    }

    private function audit(Request $request, string $mode, string $status, string $details, array $payload = []): void
    {
        try {
            if (!Schema::hasTable('audit_log')) return;
            $user = $request->user();
            DB::table('audit_log')->insert([
                'id'         => (string) Str::uuid(),
                'user_id'    => $user?->id,
                'user_name'  => $user?->name ?? $user?->email ?? 'System',
                'module'     => 'backup',
                'action'     => match ($mode) {
                    'reset'        => 'demo_seed_reset',
                    'transactions' => 'demo_seed_transactions_only',
                    default        => 'demo_seed_full',
                },
                'record_id'  => null,
                'details'    => sprintf('[%s] mode=%s timestamp=%s user=%s. %s', $status, $mode, now()->toIso8601String(), $user?->email ?? $user?->name ?? 'System', $details),
                'new_data'   => json_encode(array_merge(['mode' => $mode, 'status' => $status, 'timestamp' => now()->toIso8601String()], $payload)),
                'ip_address' => $request->ip(),
                'user_agent' => substr((string) $request->userAgent(), 0, 250),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('demo seed audit insert failed: ' . $e->getMessage());
        }
    }

    private function collectStats(): array
    {
        $tables = [
            'vouchers'          => 'acc_vouchers',
            'sales'             => 'sales_invoices',
            'sales_v2'          => 'sales_invoices_v2',
            'purchases'         => 'purchase_orders',
            'vat_challans'      => 'vat_challans',
            'delivery_challans' => 'delivery_challans',
            'payments'          => 'party_payments',
            'customers'         => 'customers',
            'suppliers'         => 'suppliers',
            'employees'         => 'employees',
            'payroll'           => 'payroll',
            'productions'       => 'production_entries',
            'party_notes'       => 'party_notes',
        ];
        $stats = [];
        foreach ($tables as $key => $table) {
            try { $stats[$key] = DB::table($table)->count(); } catch (\Throwable $e) { $stats[$key] = 0; }
        }
        return $stats;
    }
}
