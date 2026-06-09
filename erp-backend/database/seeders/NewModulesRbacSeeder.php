<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * NewModulesRbacSeeder — idempotent.
 *
 * Adds the following so the VAT / Returns / Stock Adjustment approval flows
 * are not blocked by missing permission rows:
 *  - number_sequences row "stock_adjustment" (ADJ-YY-#####)
 *  - role_permissions rows for the new module keys across every existing
 *    custom_role: sales_returns, purchase_returns, stock_adjustments,
 *    vat_challan, mushak_9_1, tds, requisitions, grn, bill.
 *
 * Permissions granted per role are inferred from the role name:
 *  - Administrator / Accountant => full
 *  - Sales Manager   => sales_returns, vat_challan, mushak_9_1 full; rest view-only
 *  - Purchase Manager => purchase_returns, requisitions, grn, bill, tds full
 *  - Inventory Manager => stock_adjustments full
 *  - everyone else => view only
 *
 * Run: php artisan db:seed --class=NewModulesRbacSeeder
 */
class NewModulesRbacSeeder extends Seeder
{
    private array $modules = [
        'sales_returns', 'purchase_returns', 'stock_adjustments',
        'vat_challan', 'mushak_9_1', 'tds',
        'requisitions', 'grn', 'bill',
    ];

    public function run(): void
    {
        // 1. Ensure the stock_adjustment number sequence exists
        $year = (int) date('Y');
        DB::table('number_sequences')->updateOrInsert(
            ['id' => 'stock_adjustment'],
            ['prefix' => 'ADJ', 'current_number' => 0, 'year' => $year, 'description' => 'Stock Adjustment'],
        );

        // 2. Upsert role_permissions for every existing role
        $roles = DB::table('custom_roles')->get(['id', 'name']);
        foreach ($roles as $role) {
            $full = $this->fullModulesFor($role->name);
            foreach ($this->modules as $mod) {
                $isFull = in_array($mod, $full, true);
                DB::table('role_permissions')->updateOrInsert(
                    ['custom_role_id' => $role->id, 'module' => $mod],
                    [
                        'id'         => (string) Str::uuid(),
                        'can_view'   => 1,
                        'can_add'    => $isFull ? 1 : 0,
                        'can_edit'   => $isFull ? 1 : 0,
                        'can_delete' => $isFull ? 1 : 0,
                    ],
                );
            }
        }

        $this->command?->info('Seeded stock_adjustment sequence and role_permissions for ' . count($this->modules) . ' modules.');
    }

    private function fullModulesFor(string $roleName): array
    {
        $name = strtolower($roleName);
        if (str_contains($name, 'admin') || str_contains($name, 'accountant')) return $this->modules;
        if (str_contains($name, 'sales'))    return ['sales_returns', 'vat_challan', 'mushak_9_1'];
        if (str_contains($name, 'purchase')) return ['purchase_returns', 'requisitions', 'grn', 'bill', 'tds'];
        if (str_contains($name, 'inventory') || str_contains($name, 'store')) return ['stock_adjustments'];
        if (str_contains($name, 'vat'))      return ['vat_challan', 'mushak_9_1', 'tds'];
        return [];
    }
}
