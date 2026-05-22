<?php

namespace App\Services;

use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\PoAmendment;
use Illuminate\Support\Facades\DB;

class PurchaseOrderService
{
    public function __construct(private NumberSequenceService $seq, private FinancialPeriodGuard $period) {}

    public function create(array $data, array $items): PurchaseOrder
    {
        $this->period->assertOpen($data['po_date'] ?? null, 'Purchase Order');
        return DB::transaction(function () use ($data, $items) {
            [$subtotal, $vat, $grand] = $this->computeTotals($items);
            $po = PurchaseOrder::create(array_merge($data, [
                'po_number' => $data['po_number'] ?? $this->seq->next('purchase_order'),
                'subtotal' => $subtotal, 'vat_amount' => $vat, 'grand_total' => $grand,
                'status' => $data['status'] ?? 'open',
            ]));
            foreach ($items as $i => $row) {
                $sub = $row['qty_ordered'] * $row['rate'];
                $lineVat = $sub * ($row['vat_pct'] ?? 0) / 100;
                PurchaseOrderItem::create([
                    'po_id' => $po->id,
                    'product_id' => $row['product_id'],
                    'qty_ordered' => $row['qty_ordered'],
                    'qty_delivered' => 0,
                    'qty_remaining' => $row['qty_ordered'],
                    'rate' => $row['rate'],
                    'vat_pct' => $row['vat_pct'] ?? 0,
                    'line_subtotal' => $sub,
                    'line_vat' => $lineVat,
                    'line_total' => $sub + $lineVat,
                    'sort_order' => $i,
                ]);
            }
            return $po->load('items');
        });
    }

    public function amend(string $poId, array $data, array $items, ?string $userId, string $reason = ''): PurchaseOrder
    {
        return DB::transaction(function () use ($poId, $data, $items, $userId, $reason) {
            $po = PurchaseOrder::with('items')->findOrFail($poId);
            $old = $po->toArray();
            // Replace items wholesale (delivered qty preserved by remaining > 0 check)
            $po->items()->delete();
            [$subtotal, $vat, $grand] = $this->computeTotals($items);
            $po->update(array_merge($data, ['subtotal' => $subtotal, 'vat_amount' => $vat, 'grand_total' => $grand]));
            foreach ($items as $i => $row) {
                $sub = $row['qty_ordered'] * $row['rate'];
                $lineVat = $sub * ($row['vat_pct'] ?? 0) / 100;
                PurchaseOrderItem::create([
                    'po_id' => $po->id, 'product_id' => $row['product_id'],
                    'qty_ordered' => $row['qty_ordered'], 'qty_delivered' => $row['qty_delivered'] ?? 0,
                    'qty_remaining' => max(0, $row['qty_ordered'] - ($row['qty_delivered'] ?? 0)),
                    'rate' => $row['rate'], 'vat_pct' => $row['vat_pct'] ?? 0,
                    'line_subtotal' => $sub, 'line_vat' => $lineVat, 'line_total' => $sub + $lineVat,
                    'sort_order' => $i,
                ]);
            }
            PoAmendment::create([
                'po_id' => $po->id, 'amended_by' => $userId,
                'old_data' => $old, 'new_data' => $po->fresh()->load('items')->toArray(),
                'reason' => $reason,
            ]);
            return $po->fresh()->load('items');
        });
    }

    public function recomputeStatus(string $poId): void
    {
        $po = PurchaseOrder::with('items')->findOrFail($poId);
        $totalOrdered = $po->items->sum('qty_ordered');
        $totalDelivered = $po->items->sum('qty_delivered');
        $status = 'open';
        if ($totalDelivered <= 0) $status = 'open';
        elseif ($totalDelivered >= $totalOrdered) $status = 'closed';
        else $status = 'partial';
        $po->update(['status' => $status]);
    }

    private function computeTotals(array $items): array
    {
        $sub = 0; $vat = 0;
        foreach ($items as $r) {
            $lineSub = $r['qty_ordered'] * $r['rate'];
            $sub += $lineSub;
            $vat += $lineSub * ($r['vat_pct'] ?? 0) / 100;
        }
        return [$sub, $vat, $sub + $vat];
    }
}
