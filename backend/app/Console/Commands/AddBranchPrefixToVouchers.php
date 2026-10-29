<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One-time backfill: prepend each voucher's branch code to its
 * voucher_number — "PV-2026-00971" (Factory branch) becomes
 * "FAC-PV-2026-00971". Idempotent: only touches rows that don't already
 * start with "<code>-", so it's safe to run more than once.
 *
 * Safe by default: shows a report only. Pass --fix to apply.
 *
 *   php artisan vouchers:add-branch-prefix              # dry-run report
 *   php artisan vouchers:add-branch-prefix --fix         # apply
 */
class AddBranchPrefixToVouchers extends Command
{
    protected $signature = 'vouchers:add-branch-prefix {--fix : Apply the update (otherwise dry-run)}';
    protected $description = 'Prepend each voucher\'s branch code to its voucher_number, e.g. PV-2026-00971 -> FAC-PV-2026-00971';

    public function handle(): int
    {
        $fix = (bool) $this->option('fix');

        $branches = DB::table('branches')->whereNotNull('code')->where('code', '!=', '')->get(['id', 'code', 'name']);
        if ($branches->isEmpty()) {
            $this->warn('No branches with a code set — nothing to do.');
            return 0;
        }

        $rows = [];
        $totalToUpdate = 0;

        foreach ($branches as $branch) {
            $query = DB::table('acc_vouchers')
                ->where('branch_id', $branch->id)
                ->where('voucher_number', 'not like', "{$branch->code}-%");

            $count = (clone $query)->count();
            $totalToUpdate += $count;
            $samples = (clone $query)->orderBy('voucher_number')->limit(3)->pluck('voucher_number');

            $rows[] = [
                $branch->code,
                $branch->name,
                $count,
                $samples->map(fn ($n) => "{$n} -> {$branch->code}-{$n}")->implode("\n") ?: '—',
            ];

            if ($fix && $count > 0) {
                DB::transaction(function () use ($query, $branch) {
                    // Re-fetch id + current number inside the transaction so we
                    // update exact rows with their own current value, rather
                    // than re-running the WHERE against a moving target.
                    $targets = (clone $query)->get(['id', 'voucher_number']);
                    foreach ($targets as $row) {
                        DB::table('acc_vouchers')
                            ->where('id', $row->id)
                            ->update(['voucher_number' => "{$branch->code}-{$row->voucher_number}"]);
                    }
                });
            }
        }

        $noBranch = DB::table('acc_vouchers')->whereNull('branch_id')->count();

        $this->table(['Branch Code', 'Branch Name', 'Vouchers to prefix', 'Sample (before -> after)'], $rows);
        if ($noBranch > 0) {
            $this->warn("{$noBranch} voucher(s) have no branch assigned — left unprefixed.");
        }
        $this->info($fix
            ? "Done — prefixed {$totalToUpdate} voucher(s)."
            : "Dry-run — {$totalToUpdate} voucher(s) would be prefixed. Re-run with --fix to apply.");

        return 0;
    }
}
