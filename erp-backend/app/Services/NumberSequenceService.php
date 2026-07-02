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
     * Get the next number for a sequence and increment atomically.
     * Auto-rolls the year and resets the serial when the calendar year changes.
     * Self-heals if the sequence row is missing.
     */
    public function next(string $sequenceId): string
    {
        return DB::transaction(function () use ($sequenceId) {
            // 1) Try to reuse a released number (free-list, FIFO). Safe: consumed_at is set
            //    atomically inside the same transaction so concurrent callers cannot claim it.
            if (Schema::hasTable('number_sequence_free_list')) {
                $freed = NumberSequenceFreeItem::where('sequence_id', $sequenceId)
                    ->whereNull('consumed_at')
                    ->orderBy('released_at')
                    ->lockForUpdate()
                    ->first();
                if ($freed) {
                    $freed->consumed_at = now();
                    $freed->save();
                    return $freed->number;
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

            $seq->current_number = (int) $seq->current_number + 1;
            $seq->save();

            $num = str_pad((string) $seq->current_number, 5, '0', STR_PAD_LEFT);
            return "{$seq->prefix}-{$seq->year}-{$num}";
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
        NumberSequenceFreeItem::create([
            'sequence_id' => $sequenceId,
            'number'      => $number,
            'released_by' => $releasedBy,
            'released_at' => now(),
        ]);
    }
}

}
