<?php
namespace App\Http\Controllers\Inventory;

use App\Http\Controllers\BaseController;
use App\Models\AuditLog;
use App\Services\FinancialPeriodGuard;
use App\Services\NumberSequenceService;
use App\Services\StockService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Stock Transfer (Inter-warehouse) — Safe Extension.
 * Approve: OUT from source warehouse, IN to destination — atomic, balanced.
 * Writes stock_ledger (immutable), updates warehouse_stock, logs stock_movements.
 */
class StockTransferController extends BaseController
{
    public function __construct(
        private NumberSequenceService $seq,
        private StockService $stock,
        private FinancialPeriodGuard $period,
    ) {}

    public function index(Request $r)
    {
        $q = DB::table('stock_transfers')->orderByDesc('created_at');
        if ($r->status) $q->where('status', $r->status);
        if ($r->from) $q->where('transfer_date', '>=', $r->from);
        if ($r->to)   $q->where('transfer_date', '<=', $r->to);
        return $this->success($q->paginate($r->per_page ?? 25));
    }

    public function show(string $id)
    {
        $row = DB::table('stock_transfers')->where('id', $id)->first();
        if (!$row) return $this->error('Not found', 404);
        $row->items = DB::table('stock_transfer_items')->where('stock_transfer_id', $id)->get();
        return $this->success($row);
    }

    public function store(Request $r)
    {
        $hasItems = is_array($r->input('items')) && count($r->input('items')) > 0;

        if ($hasItems) {
            $r->validate([
                'transfer_date'     => 'required|date',
                'from_warehouse_id' => 'required|exists:warehouses,id',
                'to_warehouse_id'   => 'required|different:from_warehouse_id|exists:warehouses,id',
                'items'             => 'required|array|min:1',
                'items.*.item_id'   => 'required|exists:item_master,id',
                'items.*.quantity'  => 'required|numeric|min:0.01',
            ]);
        } else {
            $r->validate([
                'transfer_date'     => 'required|date',
                'from_warehouse_id' => 'required|exists:warehouses,id',
                'to_warehouse_id'   => 'required|different:from_warehouse_id|exists:warehouses,id',
                'item_id'           => 'required|exists:item_master,id',
                'quantity'          => 'required|numeric|min:0.01',
            ]);
        }

        $this->period->ensureActive($r->transfer_date);

        try { $number = $this->seq->next('stock_transfer'); }
        catch (\Throwable $e) { $number = 'STR-' . date('y') . '-' . substr((string) microtime(true), -5); }

        $id = (string) Str::uuid();

        DB::transaction(function () use ($r, $id, $number, $hasItems) {
            DB::table('stock_transfers')->insert([
                'id' => $id,
                'transfer_number'   => $number,
                'transfer_date'     => $r->transfer_date,
                'from_warehouse_id' => $r->from_warehouse_id,
                'to_warehouse_id'   => $r->to_warehouse_id,
                'item_id'           => $hasItems ? null : $r->item_id,
                'quantity'          => $hasItems ? null : $r->quantity,
                'notes'             => $r->notes,
                'status'            => 'pending',
                'created_by'        => optional($r->user())->id,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]);

            if ($hasItems) {
                $rows = [];
                foreach ($r->input('items') as $line) {
                    $rows[] = [
                        'id'                => (string) Str::uuid(),
                        'stock_transfer_id' => $id,
                        'item_id'           => $line['item_id'],
                        'quantity'          => $line['quantity'],
                        'notes'             => $line['notes'] ?? null,
                        'created_at'        => now(),
                    ];
                }
                DB::table('stock_transfer_items')->insert($rows);
            }
        });

        $row = DB::table('stock_transfers')->where('id', $id)->first();
        $row->items = DB::table('stock_transfer_items')->where('stock_transfer_id', $id)->get();
        return $this->created($row);
    }

    public function destroy(string $id)
    {
        $row = DB::table('stock_transfers')->where('id', $id)->first();
        if (!$row) return $this->error('Not found', 404);
        if (in_array($row->status, ['approved', 'posted'])) {
            return $this->error('Approved transfers cannot be deleted', 422);
        }
        DB::table('stock_transfers')->where('id', $id)->delete();
        return $this->success(['deleted' => true]);
    }

    public function approve(Request $r, string $id)
    {
        $row = DB::table('stock_transfers')->where('id', $id)->first();
        if (!$row) return $this->error('Not found', 404);
        if (in_array($row->status, ['approved', 'posted'])) return $this->error('Already approved', 422);
        if ($row->status === 'cancelled') return $this->error('Cancelled transfer', 422);

        $this->period->ensureActive($row->transfer_date);

        // Pre-check: source warehouse must have enough stock
        $available = $this->stock->getBalance($row->item_id, $row->from_warehouse_id);
        if ($available < (float) $row->quantity) {
            return $this->error("Insufficient stock at source warehouse (available: {$available})", 422);
        }

        DB::transaction(function () use ($row, $r) {
            $qty = (float) $row->quantity;
            $branchId = DB::table('warehouses')->where('id', $row->from_warehouse_id)->value('branch_id');

            // OUT from source
            $this->stock->createLedgerEntry([
                'transaction_type'  => 'stock_transfer_out',
                'transaction_id'    => $row->id,
                'item_id'           => $row->item_id,
                'branch_id'         => $branchId,
                'warehouse_id'      => $row->from_warehouse_id,
                'quantity_in'       => 0,
                'quantity_out'      => $qty,
                'reference_number'  => $row->transfer_number,
                'transaction_date'  => $row->transfer_date,
            ]);
            $this->stock->updateWarehouseStock($row->item_id, $row->from_warehouse_id, -$qty);

            // IN to destination
            $toBranch = DB::table('warehouses')->where('id', $row->to_warehouse_id)->value('branch_id');
            $this->stock->createLedgerEntry([
                'transaction_type'  => 'stock_transfer_in',
                'transaction_id'    => $row->id,
                'item_id'           => $row->item_id,
                'branch_id'         => $toBranch,
                'warehouse_id'      => $row->to_warehouse_id,
                'quantity_in'       => $qty,
                'quantity_out'      => 0,
                'reference_number'  => $row->transfer_number,
                'transaction_date'  => $row->transfer_date,
            ]);
            $this->stock->updateWarehouseStock($row->item_id, $row->to_warehouse_id, $qty);

            // Movement audit trail (both legs)
            $this->stock->createBulkMovements(
                [['product_id' => $row->item_id, 'quantity' => $qty]],
                'transfer_out', 'stock_transfer', $row->id, $branchId, -1,
            );
            $this->stock->createBulkMovements(
                [['product_id' => $row->item_id, 'quantity' => $qty]],
                'transfer_in', 'stock_transfer', $row->id, $toBranch, +1,
            );

            DB::table('stock_transfers')->where('id', $row->id)->update([
                'status' => 'approved', 'updated_at' => now(),
            ]);

            $u = $r->user();
            AuditLog::create([
                'user_id'    => optional($u)->id,
                'user_name'  => optional($u)->name,
                'module'     => 'inventory',
                'action'     => 'stock_transfer.approve',
                'record_id'  => $row->id,
                'details'    => "Approved {$row->transfer_number}: qty {$qty} from {$row->from_warehouse_id} → {$row->to_warehouse_id}",
                'new_data'   => [
                    'transfer_number' => $row->transfer_number,
                    'item_id'         => $row->item_id,
                    'quantity'        => $qty,
                    'from_warehouse_id' => $row->from_warehouse_id,
                    'to_warehouse_id'   => $row->to_warehouse_id,
                    'transfer_date'   => $row->transfer_date,
                ],
                'ip_address' => $r->ip(),
                'user_agent' => substr((string) $r->userAgent(), 0, 255),
            ]);
        });

        return $this->success(DB::table('stock_transfers')->where('id', $id)->first());
    }

    public function cancel(Request $r, string $id)
    {
        $row = DB::table('stock_transfers')->where('id', $id)->first();
        if (!$row) return $this->error('Not found', 404);
        if ($row->status === 'cancelled') return $this->error('Already cancelled', 422);
        if (in_array($row->status, ['approved', 'posted'])) {
            return $this->error('Approved transfers cannot be cancelled (use reverse entry)', 422);
        }
        DB::table('stock_transfers')->where('id', $id)->update([
            'status' => 'cancelled', 'notes' => trim(($row->notes ?? '') . "\nCancelled: " . ($r->reason ?? '')),
            'updated_at' => now(),
        ]);

        $u = $r->user();
        AuditLog::create([
            'user_id'    => optional($u)->id,
            'user_name'  => optional($u)->name,
            'module'     => 'inventory',
            'action'     => 'stock_transfer.cancel',
            'record_id'  => $id,
            'details'    => "Cancelled {$row->transfer_number}" . ($r->reason ? " — reason: {$r->reason}" : ''),
            'old_data'   => ['status' => $row->status],
            'new_data'   => ['status' => 'cancelled', 'reason' => $r->reason],
            'ip_address' => $r->ip(),
            'user_agent' => substr((string) $r->userAgent(), 0, 255),
        ]);

        return $this->success(DB::table('stock_transfers')->where('id', $id)->first());
    }
}
