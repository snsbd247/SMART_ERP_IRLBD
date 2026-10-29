<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * NewModulesRbacSeeder — DEPRECATED / NO-OP.
 *
 * Previously seeded 9 module keys (sales_returns, purchase_returns,
 * stock_adjustments, vat_challan, mushak_9_1, tds, requisitions, grn, bill)
 * that are NOT in the canonical 33-module list maintained in
 *   src/pages/admin/RolesPage.tsx  (frontend canonical authority)
 *   database/seeders/DatabaseSeeder.php (fresh-install canonical authority)
 *   database/seeders/data/demo_config_seed.json (demo-import canonical authority)
 *
 * Those module keys were detected at runtime as "orphan permissions" by the
 * Roles & Permissions admin page. Running this seeder would re-introduce
 * them, so it is intentionally a no-op now.
 *
 * It still ensures the `stock_adjustment` number sequence exists, since that
 * is needed by the working Stock Adjustment feature and is not module-related.
 */
class NewModulesRbacSeeder extends Seeder
{
    public function run(): void
    {
        // Ensure the stock_adjustment number sequence exists (kept – not orphan).
        $year = (int) date('Y');
        DB::table('number_sequences')->updateOrInsert(
            ['id' => 'stock_adjustment'],
            ['prefix' => 'ADJ', 'current_number' => 0, 'year' => $year, 'description' => 'Stock Adjustment'],
        );

        // Defensive cleanup: remove any leftover orphan module rows from older runs.
        DB::table('role_permissions')
            ->whereIn('module', [
                'sales_returns', 'purchase_returns', 'stock_adjustments',
                'vat_challan', 'mushak_9_1', 'tds',
                'requisitions', 'grn', 'bill',
            ])
            ->delete();

        $this->command?->info('NewModulesRbacSeeder is a no-op (canonical module list maintained by DatabaseSeeder / demo_config_seed.json). Orphan permissions cleaned.');
    }
}
