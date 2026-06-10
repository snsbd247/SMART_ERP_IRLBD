<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Identifies and (optionally) fixes accounting vouchers whose entries are
 * either missing entirely or do not balance (sum(debit) != sum(credit)).
 *
 * Safe by default: shows a report only. Pass --fix to apply repairs.
 *
 *   php artisan vouchers:repair              # dry-run report
 *   php artisan vouchers:repair --fix        # void empty + soft-delete
 *                                              unbalanced posted vouchers
 *   php artisan vouchers:repair --fix --delete-empty
 *                                              # hard-delete empty draft vouchers
 */
class RepairVouchers extends Command
{
    protected $signature = 'vouchers:repair {--fix : Apply repairs (otherwise dry-run)} {--delete-empty : Hard-delete empty draft vouchers when fixing}';
    protected $description = 'Find vouchers with zero entries or unbalanced debit/credit; optionally repair them.';

    public function handle(): int
    {
        $fix = (bool) $this->option('fix');
        $deleteEmpty = (bool) $this->option('delete-empty');

        // 1. Empty vouchers (no entries at all)
        $empty = DB::table('acc_vouchers as v')
            ->leftJoin('voucher_entries as e', 'e.voucher_id', '=', 'v.id')
            ->whereNull('v.deleted_at')
            ->groupBy('v.id', 'v.voucher_number', 'v.voucher_type', 'v.status', 'v.total_amount')
            ->havingRaw('COUNT(e.id) = 0')
            ->select('v.id', 'v.voucher_number', 'v.voucher_type', 'v.status', 'v.total_amount')
            ->get();

        // 2. Unbalanced vouchers
        $unbalanced = DB::table('acc_vouchers as v')
            ->join('voucher_entries as e', 'e.voucher_id', '=', 'v.id')
            ->whereNull('v.deleted_at')
            ->groupBy('v.id', 'v.voucher_number', 'v.voucher_type', 'v.status', 'v.total_amount')
            ->havingRaw('ROUND(SUM(e.debit), 2) <> ROUND(SUM(e.credit), 2)')
            ->select(
                'v.id', 'v.voucher_number', 'v.voucher_type', 'v.status', 'v.total_amount',
                DB::raw('ROUND(SUM(e.debit), 2) as total_debit'),
                DB::raw('ROUND(SUM(e.credit), 2) as total_credit')
            )
            ->get();

        $this->info("Empty vouchers (no entries): {$empty->count()}");
        if ($empty->count()) {
            $this->table(
                ['ID', 'No', 'Type', 'Status', 'Amount'],
                $empty->map(fn ($r) => [$r->id, $r->voucher_number, $r->voucher_type, $r->status, $r->total_amount])->toArray()
            );
        }

        $this->info("Unbalanced vouchers: {$unbalanced->count()}");
        if ($unbalanced->count()) {
            $this->table(
                ['ID', 'No', 'Type', 'Status', 'Amount', 'Debit', 'Credit', 'Diff'],
                $unbalanced->map(fn ($r) => [
                    $r->id, $r->voucher_number, $r->voucher_type, $r->status,
                    $r->total_amount, $r->total_debit, $r->total_credit,
                    round($r->total_debit - $r->total_credit, 2),
                ])->toArray()
            );
        }

        if (! $fix) {
            $this->warn('Dry-run only. Re-run with --fix to apply repairs.');
            return self::SUCCESS;
        }

        DB::transaction(function () use ($empty, $unbalanced, $deleteEmpty) {
            $now = now();

            foreach ($empty as $v) {
                if ($deleteEmpty && $v->status === 'draft') {
                    DB::table('acc_vouchers')->where('id', $v->id)->delete();
                    $this->line(" • Hard-deleted empty draft voucher {$v->voucher_number}");
                } else {
                    // Mark as cancelled + soft-delete so reports don't pick it up
                    DB::table('acc_vouchers')->where('id', $v->id)->update([
                        'prev_status' => $v->status,
                        'status'      => 'cancelled',
                        'deleted_at'  => $now,
                        'updated_at'  => $now,
                    ]);
                    $this->line(" • Cancelled + soft-deleted empty voucher {$v->voucher_number}");
                }
            }

            foreach ($unbalanced as $v) {
                DB::table('acc_vouchers')->where('id', $v->id)->update([
                    'prev_status' => $v->status,
                    'status'      => 'cancelled',
                    'deleted_at'  => $now,
                    'updated_at'  => $now,
                ]);
                $this->line(" • Soft-deleted unbalanced voucher {$v->voucher_number} (debit {$v->total_debit} vs credit {$v->total_credit})");
            }
        });

        $this->info('Repair complete. Re-post the affected transactions from their source module (sales / GRN / payment).');
        return self::SUCCESS;
    }
}
