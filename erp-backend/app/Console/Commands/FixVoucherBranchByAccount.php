<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Corrects acc_vouchers.branch_id (and re-derives voucher_number's branch
 * prefix to match) for vouchers that represent genuine Factory-branch
 * spending but were tagged HO at creation time.
 *
 * Two account groups, two rules — confirmed against real data before this
 * was written (see conversation): pure Factory-expense accounts are only
 * ever touched on their spending side in this system, so any voucher
 * touching one is unambiguously Factory spending. Factory Petty Cash is
 * different: HO periodically transfers funds INTO it (credit side — stays
 * HO, it's HO's transfer) and Factory spends OUT of it (debit side —
 * becomes FAC, it's Factory's spend). Getting the two sides of Factory
 * Petty Cash backwards would wrongly relabel HO's own funding vouchers.
 *
 *  - FACTORY_EXPENSE_ACCOUNT_CODES: any voucher touching one, regardless of
 *    debit/credit side, is reclassified to FAC.
 *  - FACTORY_PETTY_CASH_CODE: only vouchers where this account is DEBITED
 *    are reclassified to FAC. Credit-side (HO funding it) is left alone.
 *
 * A voucher already correctly branch-tagged, or one that would be pulled
 * toward more than one branch by these rules, is left untouched.
 *
 * Safe by default: shows a report only. Pass --fix to apply.
 *
 *   php artisan vouchers:fix-branch-by-account              # dry-run report
 *   php artisan vouchers:fix-branch-by-account --fix         # apply
 */
class FixVoucherBranchByAccount extends Command
{
    protected $signature = 'vouchers:fix-branch-by-account {--fix : Apply the correction (otherwise dry-run)}';
    protected $description = "Reclassify a voucher's branch_id (and voucher_number prefix) to FAC when it represents genuine Factory-branch spending";

    private const FACTORY_EXPENSE_ACCOUNT_CODES = ['5301', '5302', '5303', '5304', '5305', '5306', '5307', '5311', '5314'];
    private const FACTORY_PETTY_CASH_CODE = '1258';
    private const TARGET_BRANCH_CODE = 'FAC';

    public function handle(): int
    {
        $fix = (bool) $this->option('fix');

        $facId = DB::table('branches')->where('code', self::TARGET_BRANCH_CODE)->value('id');
        if (!$facId) {
            $this->warn('No branch with code ' . self::TARGET_BRANCH_CODE . ' — nothing to do.');
            return 0;
        }

        $expenseAccountIds = DB::table('chart_of_accounts')
            ->whereIn('account_code', self::FACTORY_EXPENSE_ACCOUNT_CODES)
            ->pluck('id');
        $pettyCashId = DB::table('chart_of_accounts')
            ->where('account_code', self::FACTORY_PETTY_CASH_CODE)
            ->value('id');

        // voucher_id => true, for vouchers matching either rule.
        $matches = [];
        DB::table('voucher_entries')
            ->whereIn('account_id', $expenseAccountIds)
            ->pluck('voucher_id')
            ->each(function ($id) use (&$matches) { $matches[$id] = true; });

        if ($pettyCashId) {
            DB::table('voucher_entries')
                ->where('account_id', $pettyCashId)
                ->where('debit', '>', 0)
                ->pluck('voucher_id')
                ->each(function ($id) use (&$matches) { $matches[$id] = true; });
        }

        $rows = [];
        $totalToFix = 0;

        foreach (array_keys($matches) as $voucherId) {
            $voucher = DB::table('acc_vouchers')->where('id', $voucherId)->first();
            if (!$voucher || $voucher->branch_id === $facId) continue; // already FAC

            $currentCode = DB::table('branches')->where('id', $voucher->branch_id)->value('code');
            $prefix = $currentCode ? "{$currentCode}-" : '';
            $bareNumber = $prefix && str_starts_with($voucher->voucher_number, $prefix)
                ? substr($voucher->voucher_number, strlen($prefix))
                : $voucher->voucher_number;
            $newNumber = self::TARGET_BRANCH_CODE . "-{$bareNumber}";

            $rows[] = [$voucher->voucher_number, $currentCode ?? '(none)', $newNumber];
            $totalToFix++;

            if ($fix) {
                DB::table('acc_vouchers')->where('id', $voucherId)->update([
                    'branch_id' => $facId,
                    'voucher_number' => $newNumber,
                ]);
            }
        }

        if (!empty($rows)) {
            usort($rows, fn ($a, $b) => strcmp($a[0], $b[0]));
            $this->table(['Current Number', 'Current Branch', 'New Number'], $rows);
        }

        $this->info($fix
            ? "Done — reclassified {$totalToFix} voucher(s) to FAC."
            : "Dry-run — {$totalToFix} voucher(s) would be reclassified to FAC. Re-run with --fix to apply.");

        return 0;
    }
}
