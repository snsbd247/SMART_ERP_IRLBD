<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Verify BD VAT Sales Workflow FK constraints + orphan rows + row counts.
 *
 * Usage on VPS:
 *   php artisan migrate
 *   php artisan sw:verify-fks
 *   php artisan sw:verify-fks --json > /tmp/sw-fk-report.json
 */
class VerifySalesWorkflowFks extends Command
{
    protected $signature = 'sw:verify-fks {--json : Output JSON instead of table}';
    protected $description = 'Verify Sales Workflow FK constraints, orphans, and row counts';

    /** @var array<int, array{table:string,column:string,ref:string,fk:string}> */
    private array $checks = [
        ['table' => 'purchase_orders',         'column' => 'customer_id', 'ref' => 'customers',       'fk' => 'purchase_orders_customer_id_fkey'],
        ['table' => 'purchase_order_items',    'column' => 'product_id',  'ref' => 'item_master',     'fk' => 'purchase_order_items_product_id_fkey'],
        ['table' => 'vat_challans',            'column' => 'customer_id', 'ref' => 'customers',       'fk' => 'vat_challans_customer_id_fkey'],
        ['table' => 'vat_challan_items',       'column' => 'product_id',  'ref' => 'item_master',     'fk' => 'vat_challan_items_product_id_fkey'],
        ['table' => 'delivery_challans',       'column' => 'customer_id', 'ref' => 'customers',       'fk' => 'delivery_challans_customer_id_fkey'],
        ['table' => 'delivery_challans',       'column' => 'product_id',  'ref' => 'item_master',     'fk' => 'delivery_challans_product_id_fkey'],
        ['table' => 'sales_invoices_v2',       'column' => 'customer_id', 'ref' => 'customers',       'fk' => 'sales_invoices_v2_customer_id_fkey'],
        ['table' => 'sales_invoice_items_v2',  'column' => 'product_id',  'ref' => 'item_master',     'fk' => 'sales_invoice_items_v2_product_id_fkey'],
    ];

    public function handle(): int
    {
        $rows = [];
        $hasIssue = false;

        foreach ($this->checks as $c) {
            $tableExists = Schema::hasTable($c['table']);
            $colExists   = $tableExists && Schema::hasColumn($c['table'], $c['column']);

            $fkPresent = false;
            $orphans   = null;
            $total     = null;

            if ($tableExists && $colExists) {
                $fkPresent = (bool) DB::selectOne(
                    "SELECT 1 AS ok FROM information_schema.TABLE_CONSTRAINTS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?",
                    [$c['table'], $c['fk']]
                );

                $total = (int) DB::table($c['table'])->count();

                $orphans = (int) DB::selectOne(
                    "SELECT COUNT(*) AS n FROM `{$c['table']}` t
                     LEFT JOIN `{$c['ref']}` r ON r.id = t.`{$c['column']}`
                     WHERE t.`{$c['column']}` IS NOT NULL AND r.id IS NULL"
                )->n;
            }

            $status = !$tableExists ? 'NO TABLE'
                    : (!$colExists ? 'NO COLUMN'
                    : (($fkPresent && $orphans === 0) ? 'OK'
                    : (!$fkPresent ? 'FK MISSING' : "ORPHANS={$orphans}")));

            if (!in_array($status, ['OK', 'NO TABLE', 'NO COLUMN'], true)) {
                $hasIssue = true;
            }

            $rows[] = [
                'table'   => $c['table'],
                'column'  => $c['column'],
                'ref'     => $c['ref'],
                'fk'      => $fkPresent ? 'YES' : 'NO',
                'rows'    => $total ?? '-',
                'orphans' => $orphans ?? '-',
                'status'  => $status,
            ];
        }

        if ($this->option('json')) {
            $this->line(json_encode(['ok' => !$hasIssue, 'checks' => $rows], JSON_PRETTY_PRINT));
        } else {
            $this->table(['Table', 'Column', 'Ref', 'FK', 'Rows', 'Orphans', 'Status'], $rows);
            $this->line('');
            $this->line($hasIssue ? '<fg=yellow>Some checks need attention. Re-run: php artisan migrate</>' : '<fg=green>All Sales Workflow FK checks passed.</>');
        }

        return $hasIssue ? self::FAILURE : self::SUCCESS;
    }
}
