<?php

namespace App\Services;

use App\Models\VatChallan;
use App\Models\VatChallanItem;
use App\Models\DeliveryChallan;
use Illuminate\Support\Facades\DB;

class VatChallanService
{
    public function __construct(private NumberSequenceService $seq) {}

    /**
     * Create a VAT challan + items. For each item, also auto-create a separate
     * Delivery Challan (Bangladesh rule: one DC per product per VAT challan).
     */
    public function create(array $data, array $items): VatChallan
    {
        return DB::transaction(function () use ($data, $items) {
            [$sub, $vat, $grand] = $this->computeTotals($items);
            $challan = VatChallan::create(array_merge($data, [
                'challan_number' => $data['challan_number'] ?? $this->seq->next('vat_challan'),
                'subtotal' => $sub, 'vat_amount' => $vat, 'grand_total' => $grand,
                'status' => $data['status'] ?? 'issued',
                'source' => $data['source'] ?? 'manual',
            ]));

            foreach ($items as $idx => $row) {
                $lineSub = $row['qty'] * $row['rate'];
                $lineVat = $lineSub * ($row['vat_pct'] ?? 0) / 100;
                $vci = VatChallanItem::create([
                    'vat_challan_id' => $challan->id,
                    'product_id' => $row['product_id'],
                    'qty' => $row['qty'], 'rate' => $row['rate'],
                    'vat_pct' => $row['vat_pct'] ?? 0,
                    'line_subtotal' => $lineSub, 'vat_amount' => $lineVat,
                    'line_total' => $lineSub + $lineVat,
                    'sort_order' => $idx,
                ]);

                DeliveryChallan::create([
                    'dc_number' => $this->seq->next('delivery_challan'),
                    'dc_date' => $challan->challan_date,
                    'vat_challan_id' => $challan->id,
                    'vat_challan_item_id' => $vci->id,
                    'product_id' => $vci->product_id,
                    'qty' => $vci->qty,
                    'customer_id' => $challan->customer_id,
                    'status' => 'issued',
                    'branch_id' => $challan->branch_id,
                    'created_by' => $challan->created_by,
                ]);
            }
            return $challan->load('items', 'deliveryChallans');
        });
    }

    private function computeTotals(array $items): array
    {
        $sub = 0; $vat = 0;
        foreach ($items as $r) {
            $lineSub = $r['qty'] * $r['rate'];
            $sub += $lineSub;
            $vat += $lineSub * ($r['vat_pct'] ?? 0) / 100;
        }
        return [$sub, $vat, $sub + $vat];
    }
}
