<?php

namespace App\Console\Commands;

use App\Models\AccVoucher;
use App\Services\AccountingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Historical fix: auto-discovers every legacy voucher that directly
 * credits/debits Factory Petty Cash (1258) from a non-FAC branch in the
 * same voucher as its other (HO-side) accounts, and splits each one into
 * the two-leg inter-branch-transfer model (see
 * AccountingService::splitVoucherAtAccount()), so Factory's own Account
 * Ledger can reconcile using only FAC-branch data for any period.
 *
 * This turned out not to be a handful of one-off vouchers — it's the
 * shape of every HO->Factory Petty Cash funding transfer since the
 * account was created, so the command scans for the pattern rather than
 * a fixed list. Skips anything already converted (soft-deleted) or
 * already FAC-branch, so it's safe to re-run.
 *
 * Safe by default: shows a report only. Pass --fix to apply.
 *
 *   php artisan vouchers:convert-legacy-inter-branch-transfers          # dry-run report
 *   php artisan vouchers:convert-legacy-inter-branch-transfers --fix    # apply
 */
class ConvertLegacyInterBranchTransfers extends Command
{
    protected $signature = 'vouchers:convert-legacy-inter-branch-transfers {--fix : Apply the conversion (otherwise dry-run)}';
    protected $description = 'Split every legacy HO->Factory Petty Cash voucher into two-leg inter-branch transfers';

    private const SPLIT_ACCOUNT_CODE = '1258'; // Factory Petty Cash
    private const NEW_BRANCH_CODE = 'FAC';

    public function handle(AccountingService $service): int
    {
        $fix = (bool) $this->option('fix');

        $splitAccountId = DB::table('chart_of_accounts')->where('account_code', self::SPLIT_ACCOUNT_CODE)->value('id');
        $newBranchId = DB::table('branches')->where('code', self::NEW_BRANCH_CODE)->value('id');
        if (!$splitAccountId || !$newBranchId) {
            $this->error('Could not resolve account 1258 or branch FAC — aborting.');
            return 1;
        }

        $voucherIds = DB::table('voucher_entries as ve')
            ->join('acc_vouchers as v', 've.voucher_id', '=', 'v.id')
            ->where('ve.account_id', $splitAccountId)
            ->whereNull('v.deleted_at')
            ->where(function ($q) use ($newBranchId) {
                $q->whereNull('v.branch_id')->orWhere('v.branch_id', '!=', $newBranchId);
            })
            ->orderBy('v.voucher_date')
            ->pluck('v.id')
            ->unique()
            ->values();

        if ($voucherIds->isEmpty()) {
            $this->info('Nothing to convert — no legacy straddling vouchers found.');
            return 0;
        }

        $userId = DB::table('users')->orderBy('created_at')->value('id'); // system actor for the audit trail
        $rows = [];
        $totalMoved = 0;
        $skipped = 0;

        foreach ($voucherIds as $voucherId) {
            $voucher = AccVoucher::with('entries.account')->find($voucherId);
            if (!$voucher) { $skipped++; continue; }

            $splitEntry = $voucher->entries->firstWhere('account_id', $splitAccountId);
            $sameAccountEntries = $voucher->entries->where('account_id', $splitAccountId)->count();
            if (!$splitEntry || $sameAccountEntries > 1) {
                $rows[] = [$voucher->voucher_number, $voucher->voucher_date, 'SKIP', 'Multiple/no 1258 entries — needs manual review'];
                $skipped++;
                continue;
            }

            $amount = max((float) $splitEntry->debit, (float) $splitEntry->credit);
            $totalMoved += $amount;

            if ($fix) {
                $result = $service->splitVoucherAtAccount(
                    $voucher->id,
                    $splitAccountId,
                    $newBranchId,
                    $userId,
                    'Retroactive conversion to two-leg inter-branch transfer model (Account Ledger reconciliation fix)'
                );
                $rows[] = [$voucher->voucher_number, $voucher->voucher_date, 'SPLIT', "-> {$result['original_branch_voucher']->voucher_number} (HO) + {$result['new_branch_voucher']->voucher_number} (FAC)"];
            } else {
                $rows[] = [$voucher->voucher_number, $voucher->voucher_date, 'WILL SPLIT', number_format($amount, 2) . ' (' . $voucher->entries->count() . ' entries)'];
            }
        }

        $this->table(['Voucher #', 'Date', 'Action', 'Detail'], $rows);
        $this->info(sprintf(
            '%s %d voucher(s), total 1258 amount moved: %s. %s',
            $fix ? 'Converted' : 'Would convert',
            $voucherIds->count() - $skipped,
            number_format($totalMoved, 2),
            $skipped ? "{$skipped} skipped for manual review." : ''
        ));
        if (!$fix) {
            $this->info('Dry-run — no changes made. Re-run with --fix to apply.');
        }

        return 0;
    }
}
