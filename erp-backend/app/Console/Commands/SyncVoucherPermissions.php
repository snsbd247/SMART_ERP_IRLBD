<?php

namespace App\Console\Commands;

use App\Support\VoucherPermissions;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Reconciles the `vouchers` umbrella module with the per-type modules
 * (journal/payment/receipt/contra) for every custom role.
 *
 * For each role and each action (can_view/can_add/can_edit/can_delete):
 *   granted = OR( vouchers.<action>, journal.<action>, payment.<action>, receipt.<action>, contra.<action> )
 * The resulting flag is then written back to every one of those rows so
 * the backend (which honors any one of them) and the UI (which usually
 * shows only "vouchers") stay in lock-step.
 *
 * Safe to re-run.
 */
class SyncVoucherPermissions extends Command
{
    protected $signature = 'permissions:sync-vouchers {--dry-run : Show changes without writing}';
    protected $description = 'Reconcile vouchers/journal/payment/receipt/contra permissions across every custom role';

    public function handle(): int
    {
        $modules = array_merge(VoucherPermissions::UMBRELLA_MODULES, VoucherPermissions::TYPES);
        $cols = ['can_view', 'can_add', 'can_edit', 'can_delete'];
        $dry = (bool) $this->option('dry-run');

        $roles = DB::table('custom_roles')->pluck('id');
        $touched = 0;

        foreach ($roles as $roleId) {
            $rows = DB::table('role_permissions')
                ->where('custom_role_id', $roleId)
                ->whereIn('module', $modules)
                ->get()
                ->keyBy('module');

            // Compute OR across whatever modules exist.
            $merged = [];
            foreach ($cols as $c) {
                $merged[$c] = 0;
                foreach ($modules as $m) {
                    if (isset($rows[$m]) && (int) $rows[$m]->$c === 1) { $merged[$c] = 1; break; }
                }
            }

            // Write back to every module so UI and backend agree.
            foreach ($modules as $m) {
                $existing = $rows[$m] ?? null;
                $needsChange = !$existing || array_filter($cols, fn($c) => (int) ($existing->$c ?? 0) !== $merged[$c]);
                if (!$needsChange) continue;
                $touched++;
                if ($dry) {
                    $this->line("  role={$roleId} module={$m} -> " . json_encode($merged));
                    continue;
                }
                DB::table('role_permissions')->updateOrInsert(
                    ['custom_role_id' => $roleId, 'module' => $m],
                    array_merge($merged, ['updated_at' => now()])
                );
            }
        }

        $this->info(($dry ? '[dry-run] ' : '') . "Reconciled {$touched} role_permission rows across " . count($roles) . ' roles.');
        return self::SUCCESS;
    }
}
