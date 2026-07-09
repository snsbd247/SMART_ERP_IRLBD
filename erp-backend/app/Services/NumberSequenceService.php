<?php

namespace App\Services;

use App\Models\NumberSequence;
use App\Models\NumberSequenceFreeItem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class NumberSequenceService
{

    /**
     * Default prefixes for known sequence IDs. Used to self-heal when a row
     * is missing from the number_sequences table (e.g. fresh deployments
     * where the seeder was not re-run after adding a new voucher type).
     */
    private const DEFAULT_PREFIXES = [
        'sales_invoice'         => ['INV',  'Sales Invoice'],
        'purchase'              => ['PUR',  'Purchase'],
        'sales_return'          => ['SRN',  'Sales Return'],
        'purchase_return'       => ['PRN',  'Purchase Return'],
        'production'            => ['PRD',  'Production'],
        'stock_transfer'        => ['STR',  'Stock Transfer'],
        'stock_adjustment'      => ['ADJ',  'Stock Adjustment'],
        'journal_voucher'       => ['JV',   'Journal Voucher'],
        'payment_voucher'       => ['PV',   'Payment Voucher'],
        'receipt_voucher'       => ['RV',   'Receipt Voucher'],
        'contra_voucher'        => ['CV',   'Contra Voucher'],
        'purchase_requisition'  => ['PR',   'Purchase Requisition'],
        'purchase_order_v2'     => ['PO',   'Purchase Order'],
        'grn'                   => ['GRN',  'Goods Receipt Note'],
        'purchase_bill'         => ['BILL', 'Purchase Bill'],
        'bill_payment'          => ['BP',   'Bill Payment'],
        'vat_challan'           => ['VC',   'VAT Challan'],
    ];

    /**
     * Sequences whose generated numbers must stay globally unique against a
     * persisted document table/column. acc_vouchers has a UNIQUE constraint on
     * voucher_number, including soft-deleted/transferred rows, so we must never
     * re-issue a number that still exists there.
     */
    private const COLLISION_SOURCES = [
        'journal_voucher' => ['acc_vouchers', 'voucher_number'],
        'payment_voucher' => ['acc_vouchers', 'voucher_number'],
        'receipt_voucher' => ['acc_vouchers', 'voucher_number'],
        'contra_voucher'  => ['acc_vouchers', 'voucher_number'],
    ];

    /**
     * Get the next number for a sequence and increment atomically.
     * Auto-rolls the year and resets the serial when the calendar year changes.
     * Self-heals if the sequence row is missing.
     */
    public function next(string $sequenceId): string
    {
        return DB::transaction(function () use ($sequenceId) {
            // 1) Try to reuse a released number (free-list, FIFO), but only if
            //    the target table no longer contains that number. Soft-deleted
            //    vouchers still occupy acc_vouchers.voucher_number's UNIQUE key,
            //    so stale free-list rows must be consumed/skipped, not returned.
            if (Schema::hasTable('number_sequence_free_list')) {
                $freedItems = NumberSequenceFreeItem::where('sequence_id', $sequenceId)
                    ->whereNull('consumed_at')
                    ->orderBy('released_at')
                    ->lockForUpdate()
                    ->get();

                foreach ($freedItems as $freed) {
                    $freed->consumed_at = now();
                    $freed->save();

                    if (!$this->documentNumberExists($sequenceId, $freed->number)) {
                        return $freed->number;
                    }
                }
            }

            $seq = NumberSequence::lockForUpdate()->find($sequenceId);

            if (!$seq) {
                [$prefix, $description] = self::DEFAULT_PREFIXES[$sequenceId]
                    ?? [
                        strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $sequenceId) ?: 'DOC', 0, 3)),
                        ucwords(str_replace('_', ' ', $sequenceId)),
                    ];

                NumberSequence::create([
                    'id'             => $sequenceId,
                    'prefix'         => $prefix,
                    'description'    => $description,
                    'current_number' => 0,
                    'year'           => (int) date('Y'),
                ]);
                $seq = NumberSequence::lockForUpdate()->findOrFail($sequenceId);
            }

            $currentYear = (int) date('Y');
            if ((int) $seq->year !== $currentYear) {
                $seq->year = $currentYear;
                $seq->current_number = 0;
            }

            // Permanent drift repair: before issuing a new document number,
            // bring the counter up to the actual maximum serial already present
            // in the source table. This avoids long skip loops and keeps
            // number_sequences.current_number transactionally consistent.
            $actualMax = $this->actualMaxSerial($sequenceId, $seq->prefix, (int) $seq->year);
            if ($actualMax > (int) $seq->current_number) {
                $seq->current_number = $actualMax;
            }

            $seq->current_number = (int) $seq->current_number + 1;

            // Final collision guard for malformed/manual imports or holes above
            // the calculated max. Keep advancing until the candidate is free.
            $candidate = sprintf('%s-%d-%s', $seq->prefix, $seq->year, str_pad((string) $seq->current_number, 5, '0', STR_PAD_LEFT));
            if (isset(self::COLLISION_SOURCES[$sequenceId])) {
                [$tbl, $col] = self::COLLISION_SOURCES[$sequenceId];
                if (Schema::hasTable($tbl)) {
                    $guard = 0;
                    while (DB::table($tbl)->where($col, $candidate)->exists() && $guard++ < 10000) {
                        $seq->current_number = (int) $seq->current_number + 1;
                        $candidate = sprintf('%s-%d-%s', $seq->prefix, $seq->year, str_pad((string) $seq->current_number, 5, '0', STR_PAD_LEFT));
                    }
                }
            }

            $seq->save();
            return $candidate;
        });
    }

    /**
     * Release a previously issued number back to the free-list so the very
     * next call to next() for the same sequence returns it.
     * No-op if the free-list table hasn't been migrated yet.
     */
    public function release(string $sequenceId, string $number, ?string $releasedBy = null): void
    {
        if (!Schema::hasTable('number_sequence_free_list')) return;

        if ($this->documentNumberExists($sequenceId, $number)) return;

        NumberSequenceFreeItem::create([
            'sequence_id' => $sequenceId,
            'number'      => $number,
            'released_by' => $releasedBy,
            'released_at' => now(),
        ]);
    }

    private function documentNumberExists(string $sequenceId, string $number): bool
    {
        if (!isset(self::COLLISION_SOURCES[$sequenceId])) return false;

        [$tbl, $col] = self::COLLISION_SOURCES[$sequenceId];
        if (!Schema::hasTable($tbl)) return false;

        return DB::table($tbl)->where($col, $number)->exists();
    }

    private function actualMaxSerial(string $sequenceId, string $prefix, int $year): int
    {
        if (!isset(self::COLLISION_SOURCES[$sequenceId])) return 0;

        [$tbl, $col] = self::COLLISION_SOURCES[$sequenceId];
        if (!Schema::hasTable($tbl)) return 0;

        $pattern = sprintf('/^%s-%d-(\d+)$/', preg_quote($prefix, '/'), $year);

        return DB::table($tbl)
            ->where($col, 'like', "{$prefix}-{$year}-%")
            ->pluck($col)
            ->reduce(function (int $max, $value) use ($pattern) {
                return preg_match($pattern, (string) $value, $m)
                    ? max($max, (int) $m[1])
                    : $max;
            }, 0);
    }
}
