<?php

namespace App\Services;

use App\Models\Dispatch;
use App\Models\DispatchItem;
use App\Models\DispatchPoAllocation;
use App\Models\DispatchStatusLog;
use App\Models\PurchaseOrderItem;
use Illuminate\Support\Facades\DB;

class DispatchService
{
    public function __construct(
        private NumberSequenceService $seq,
        private PurchaseOrderService $poService,
    ) {}

    /**
     * Create dispatch with multi-PO allocation.
     * $items: [{ product_id, qty, allocations: [{ po_item_id, allocated_qty }] }]
     */
    public function create(array $data, array $items): Dispatch
    {
        return DB::transaction(function () use ($data, $items) {
            $totalQty = collect($items)->sum('qty');
            $dispatch = Dispatch::create(array_merge($data, [
                'dispatch_number' => $data['dispatch_number'] ?? $this->seq->next('dispatch'),
                'status' => $data['status'] ?? 'dispatched',
                'total_qty' => $totalQty,
            ]));

            foreach ($items as $idx => $row) {
                $di = DispatchItem::create([
                    'dispatch_id' => $dispatch->id,
                    'product_id' => $row['product_id'],
                    'qty' => $row['qty'],
                    'sort_order' => $idx,
                ]);

                $sumAlloc = collect($row['allocations'] ?? [])->sum('allocated_qty');
                if (abs($sumAlloc - $row['qty']) > 0.001) {
                    throw new \InvalidArgumentException("Allocation mismatch for product {$row['product_id']}: dispatched {$row['qty']} vs allocated {$sumAlloc}");
                }

                foreach (($row['allocations'] ?? []) as $alloc) {
                    $poItem = PurchaseOrderItem::lockForUpdate()->findOrFail($alloc['po_item_id']);
                    if ($alloc['allocated_qty'] > $poItem->qty_remaining + 0.001) {
                        throw new \InvalidArgumentException("Over-allocation on PO item {$poItem->id}: requested {$alloc['allocated_qty']} but only {$poItem->qty_remaining} remaining");
                    }
                    DispatchPoAllocation::create([
                        'dispatch_item_id' => $di->id,
                        'po_item_id' => $poItem->id,
                        'po_id' => $poItem->po_id,
                        'allocated_qty' => $alloc['allocated_qty'],
                    ]);
                    $poItem->update([
                        'qty_delivered' => $poItem->qty_delivered + $alloc['allocated_qty'],
                        'qty_remaining' => max(0, $poItem->qty_remaining - $alloc['allocated_qty']),
                    ]);
                    $this->poService->recomputeStatus($poItem->po_id);
                }
            }
            return $dispatch->load('items.allocations');
        });
    }

    public function transitionStatus(string $dispatchId, string $newStatus, ?string $userId, ?string $notes = null): Dispatch
    {
        return DB::transaction(function () use ($dispatchId, $newStatus, $userId, $notes) {
            $d = Dispatch::findOrFail($dispatchId);
            DispatchStatusLog::create([
                'dispatch_id' => $d->id, 'old_status' => $d->status,
                'new_status' => $newStatus, 'changed_by' => $userId, 'notes' => $notes,
            ]);
            $d->update(['status' => $newStatus]);
            return $d;
        });
    }
}
