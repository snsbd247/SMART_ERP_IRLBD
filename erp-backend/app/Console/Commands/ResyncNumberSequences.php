<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Backfill number_sequences.current_number so it matches the real max serial
 * in the target table for each (prefix, year). Prevents duplicate-key errors
 * caused by the counter drifting behind manually-imported or restored rows.
 *
 * Usage:
 *   php artisan sequences:resync              # all mapped sequences
 *   php artisan sequences:resync --dry-run    # show what would change
 *   php artisan sequences:resync --id=journal_voucher
 */
class ResyncNumberSequences extends Command
{
    protected $signature = 'sequences:resync {--id=} {--dry-run}';
    protected $description = 'Resync number_sequences.current_number with actual max serial in source tables';

    /**
     * sequence_id => [source_table, source_column]
     */
    private const SOURCES = [
        'journal_voucher' => ['acc_vouchers', 'voucher_number'],
        'payment_voucher' => ['acc_vouchers', 'voucher_number'],
        'receipt_voucher' => ['acc_vouchers', 'voucher_number'],
        'contra_voucher'  => ['acc_vouchers', 'voucher_number'],
    ];

    public function handle(): int
    {
        $only = $this->option('id');
        $dry  = (bool) $this->option('dry-run');
        $rows = [];

        foreach (self::SOURCES as $seqId => [$tbl, $col]) {
            if ($only && $only !== $seqId) continue;

            $seq = DB::table('number_sequences')->where('id', $seqId)->first();
            if (!$seq) { $this->warn("Skip {$seqId}: no sequence row"); continue; }

            $pattern = $seq->prefix . '-' . $seq->year . '-%';
            $max = DB::table($tbl)
                ->where($col, 'like', $pattern)
                ->selectRaw("MAX(CAST(SUBSTRING_INDEX({$col}, '-', -1) AS UNSIGNED)) as m")
                ->value('m');
            $max = (int) ($max ?? 0);

            $before = (int) $seq->current_number;
            $after  = max($before, $max);
            $rows[] = [$seqId, $seq->prefix, $seq->year, $before, $max, $after, $after > $before ? 'BUMP' : 'OK'];

            if (!$dry && $after > $before) {
                DB::table('number_sequences')->where('id', $seqId)->update([
                    'current_number' => $after,
                ]);
            }
        }

        $this->table(['Sequence', 'Prefix', 'Year', 'Counter', 'Actual Max', 'New Counter', 'Status'], $rows);
        $this->info($dry ? 'Dry-run complete — no changes written.' : 'Resync complete.');
        return 0;
    }
}
