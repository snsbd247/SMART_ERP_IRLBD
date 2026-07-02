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
}
