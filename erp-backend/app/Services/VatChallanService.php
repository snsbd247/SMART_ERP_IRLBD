<?php

namespace App\Services;

use App\Models\VatChallan;
use App\Models\VatChallanItem;
use App\Models\DeliveryChallan;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use Illuminate\Support\Facades\DB;

/**
 * Bangladesh-VAT Sales Workflow — VAT Challan service.
 *
 * Rules:
 * - A VAT Challan MUST be linked to a Purchase Order (partial deliveries supported).
 * - Each PO can have multiple VAT Challans until all qty_ordered is delivered.
 * - Each line item consumes from a specific purchase_order_item; qty consumed
 *   may be less than or equal to (qty_ordered - qty_delivered).
 * - Auto-creates one Delivery Challan per VAT Challan item (BD compliance).
 * - On delete, restores qty_delivered/qty_remaining on the PO items.
 */
class VatChallanService
{
    public function __construct(private NumberSequenceService $seq, private FinancialPeriodGuard $period, private StockService $stock) {}

    public function create(array $data, array $items): VatChallan
    {
        $this->period->assertOpen($data['challan_date'] ?? null, 'VAT Challan');

        return DB::transaction(function () use ($data, $items) {
            $poId = $data['purchase_order_id'] ?? null;
            if (!$poId) {
                throw new \InvalidArgumentException('VAT Challan must be issued against a Purchase Order.');
            }
            $po = PurchaseOrder::with('items')->lockForUpdate()->findOrFail($poId);
            if ($po->customer_id !== ($data['customer_id'] ?? $po->customer_id)) {
                $data['customer_id'] = $po->customer_id;
            }

            // Validate qty against PO availability
            foreach ($items as $row) {
                $poItemId = $row['purchase_order_item_id'] ?? null;
                if (!$poItemId) {
                    throw new \InvalidArgumentException('Each VAT challan item must reference a purchase_order_item_id.');
                }
                $poi = PurchaseOrderItem::lockForUpdate()->findOrFail($poItemId);
                if ($poi->po_id !== $po->id) {
                    throw new \InvalidArgumentException("PO item {$poItemId} does not belong to PO {$po->po_number}");
                }
                $remaining = (float) $poi->qty_remaining;
                if ((float) $row['qty'] > $remaining + 0.0001) {
                    throw new \InvalidArgumentException("Qty {$row['qty']} for product exceeds PO remaining {$remaining}.");
                // Negative-stock guard: ensure on-hand qty supports the outflow.
                $this->stock->assertSufficient(
                    $row['product_id'],
                    $data['warehouse_id'] ?? null,
                    (float) $row['qty'],
                    "product {$row['product_id']}"
                );
            }

            [$sub, $vat, $grand] = $this->computeTotals($items);

            $challan = VatChallan::create(array_merge($data, [
                'challan_number' => $data['challan_number'] ?? $this->seq->next('vat_challan'),
                'subtotal' => $sub, 'vat_amount' => $vat, 'grand_total' => $grand,
                'status' => $data['status'] ?? 'issued',
                'source' => 'purchase_order',
            ]));

            foreach ($items as $idx => $row) {
                $lineSub = $row['qty'] * $row['rate'];
                $lineVat = $lineSub * ($row['vat_pct'] ?? 0) / 100;
                $vci = VatChallanItem::create([
                    'vat_challan_id' => $challan->id,
                    'product_id' => $row['product_id'],
                    'purchase_order_item_id' => $row['purchase_order_item_id'] ?? null,
                    'qty' => $row['qty'],
                    'po_qty_consumed' => $row['purchase_order_item_id'] ?? null ? $row['qty'] : 0,
                    'rate' => $row['rate'],
                    'vat_pct' => $row['vat_pct'] ?? 0,
                    'line_subtotal' => $lineSub, 'vat_amount' => $lineVat,
                    'line_total' => $lineSub + $lineVat,
                    'sort_order' => $idx,
                ]);

                // Decrement PO availability
                if (!empty($row['purchase_order_item_id'])) {
                    $poi = PurchaseOrderItem::find($row['purchase_order_item_id']);
                    if ($poi) {
                        $poi->qty_delivered = (float) $poi->qty_delivered + (float) $row['qty'];
                        $poi->qty_remaining = max(0, (float) $poi->qty_ordered - (float) $poi->qty_delivered);
                        $poi->save();
                    }
                }

                // Auto-create per-product Delivery Challan
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

            // Update PO status if fully delivered
            $po->refresh()->load('items');
            $remainingTotal = (float) $po->items->sum('qty_remaining');
            $deliveredTotal = (float) $po->items->sum('qty_delivered');
            if ($remainingTotal <= 0.0001) {
                $po->update(['status' => 'closed']);
            } elseif ($deliveredTotal > 0) {
                $po->update(['status' => 'partial']);
            }

            return $challan->load('items', 'deliveryChallans');
        });
    }

    public function delete(VatChallan $challan): void
    {
        DB::transaction(function () use ($challan) {
            // Restore PO availability
            foreach ($challan->items as $item) {
                if ($item->purchase_order_item_id) {
                    $poi = PurchaseOrderItem::find($item->purchase_order_item_id);
                    if ($poi) {
                        $poi->qty_delivered = max(0, (float) $poi->qty_delivered - (float) $item->qty);
                        $poi->qty_remaining = max(0, (float) $poi->qty_ordered - (float) $poi->qty_delivered);
                        $poi->save();
                    }
                }
            }
            if ($challan->purchase_order_id) {
                app(PurchaseOrderService::class)->recomputeStatus($challan->purchase_order_id);
            }
            $challan->deliveryChallans()->delete();
            $challan->items()->delete();
            $challan->delete();
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
