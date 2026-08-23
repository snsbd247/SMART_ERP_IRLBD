<?php

namespace App\Console\Commands;

use App\Models\AccVoucher;
use App\Services\AccountingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One-time historical fix: convert the 3 known legacy HO journal vouchers
 * that directly credit Factory Petty Cash (1258) in the same voucher as
 * their HO-side accounts — into the two-leg inter-branch-transfer model
 * (see AccountingService::splitVoucherAtAccount()), so Factory's own
 * Account Ledger can reconcile using only FAC-branch data.
 *
 * Deliberately hardcoded to these 3 voucher numbers — this is a narrow,
 * one-time historical correction, not a general-purpose backfill, so it
 * must never accidentally match some other voucher.
 *
 * Safe by default: shows a report only. Pass --fix to apply.
 *
 *   php artisan vouchers:convert-legacy-inter-branch-transfers          # dry-run report
 *   php artisan vouchers:convert-legacy-inter-branch-transfers --fix    # apply
 */
class ConvertLegacyInterBranchTransfers extends Command
{
    protected $signature = 'vouchers:convert-legacy-inter-branch-transfers {--fix : Apply the conversion (otherwise dry-run)}';
    protected $description = 'Split the 3 legacy HO->Factory Petty Cash vouchers into two-leg inter-branch transfers';

    private const TARGET_VOUCHER_NUMBERS = [
        'HO-JV-2026-00004',
        'HO-JV-2026-00147',
        'HO-JV-2026-00148',
    ];

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

        $rows = [];
        $userId = DB::table('users')->orderBy('created_at')->value('id'); // system actor for the audit trail

        foreach (self::TARGET_VOUCHER_NUMBERS as $number) {
            $voucher = AccVoucher::with('entries.account')->where('voucher_number', $number)->whereNull('deleted_at')->first();

            if (!$voucher) {
                $rows[] = [$number, 'SKIP', 'Not found or already converted (deleted_at set)'];
                continue;
            }

            $splitEntry = $voucher->entries->firstWhere('account_id', $splitAccountId);
            if (!$splitEntry) {
                $rows[] = [$number, 'SKIP', 'No entry for account 1258 on this voucher'];
                continue;
            }

            $preview = $voucher->entries->map(fn ($e) => sprintf(
                '%s %s D=%s C=%s',
                $e->account->account_code, $e->account->account_name, $e->debit, $e->credit
            ))->implode("\n");

            $rows[] = [$number, 'WILL SPLIT', "Original entries:\n{$preview}\n-> keeps other entries on HO + new FAC voucher with 1258 (D={$splitEntry->debit} C={$splitEntry->credit}), both balanced via 1259 (Inter-Branch Clearing)."];

            if ($fix) {
                $result = $service->splitVoucherAtAccount(
                    $voucher->id,
                    $splitAccountId,
                    $newBranchId,
                    $userId,
                    'Retroactive conversion to two-leg inter-branch transfer model (Account Ledger reconciliation fix)'
                );
                $this->info("  {$number} -> {$result['original_branch_voucher']->voucher_number} (HO) + {$result['new_branch_voucher']->voucher_number} (FAC)");
            }
        }

        $this->table(['Voucher #', 'Action', 'Detail'], $rows);
        $this->info($fix
            ? 'Done — legacy vouchers converted to the two-leg model.'
            : 'Dry-run — no changes made. Re-run with --fix to apply.');

        return 0;
    }
}
