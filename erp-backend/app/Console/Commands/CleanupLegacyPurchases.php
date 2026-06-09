<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\AuditLog;

/**
 * Scheduled cleanup of legacy `purchases` / `purchase_items` rows.
 *
 * Safety rules:
 *   1. Only rows older than the verification window (default 60 days) are touched.
 *   2. The new workflow tables (`purchase_bills`, `grns`) must contain at least
 *      one row before deletion runs — otherwise we abort to avoid wiping data
 *      while migration is incomplete.
 *   3. Failures emit an audit_log entry tagged `cleanup_failed` so monitors alert.
 *
 * Usage:
 *   php artisan legacy:cleanup-purchases --dry-run
 *   php artisan legacy:cleanup-purchases --days=60
 */
class CleanupLegacyPurchases extends Command
{
    protected $signature = 'legacy:cleanup-purchases {--dry-run} {--days=60}';
    protected $description = 'Verify and remove legacy purchases/purchase_items rows after verification window.';

    public function handle(): int
    {
        $days   = (int) $this->option('days');
        $dryRun = (bool) $this->option('dry-run');
        $cutoff = now()->subDays($days)->toDateString();

        try {
            // Pre-flight: ensure new workflow has data before removing legacy.
            $bills = DB::table('purchase_bills')->count();
            $grns  = DB::table('grns')->count();
            if ($bills === 0 || $grns === 0) {
                $this->warn("Aborting: new workflow tables look empty (bills=$bills, grns=$grns).");
                $this->logAudit('cleanup_aborted', "Empty new workflow: bills=$bills grns=$grns");
                return self::FAILURE;
            }

            $oldPurchases = DB::table('purchases')->where('created_at', '<', $cutoff)->count();
            $oldItems     = DB::table('purchase_items')
                ->whereIn('purchase_id', function ($q) use ($cutoff) {
                    $q->select('id')->from('purchases')->where('created_at', '<', $cutoff);
                })->count();

            $this->info("Eligible for cleanup (cutoff $cutoff): purchases=$oldPurchases items=$oldItems");

            if ($dryRun) {
                $this->info('Dry run — no changes made.');
                return self::SUCCESS;
            }

            DB::transaction(function () use ($cutoff) {
                DB::table('purchase_items')
                    ->whereIn('purchase_id', function ($q) use ($cutoff) {
                        $q->select('id')->from('purchases')->where('created_at', '<', $cutoff);
                    })->delete();
                DB::table('purchases')->where('created_at', '<', $cutoff)->delete();
            });

            $this->logAudit('cleanup_succeeded',
                "Removed legacy purchases<$cutoff: $oldPurchases rows, $oldItems items");
            $this->info('Cleanup complete.');
            return self::SUCCESS;
        } catch (\Throwable $e) {
            Log::error('Legacy cleanup failed', ['exception' => $e]);
            $this->logAudit('cleanup_failed', $e->getMessage());
            $this->error('Failed: ' . $e->getMessage());
            return self::FAILURE;
        }
    }

    private function logAudit(string $action, string $details): void
    {
        try {
            AuditLog::create([
                'user_id'   => null,
                'user_name' => 'scheduler',
                'module'    => 'legacy_cleanup',
                'action'    => $action,
                'details'   => $details,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Audit log write failed: ' . $e->getMessage());
        }
    }
}
