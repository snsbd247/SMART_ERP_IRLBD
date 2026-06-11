<?php
namespace App\Http\Controllers\Purchase;

use App\Http\Controllers\BaseController;
use App\Models\AuditLog;
use App\Models\PurchaseReturn;
use App\Models\PurchaseReturnItem;
use App\Services\AccountingService;
use App\Services\FinancialPeriodGuard;
use App\Services\NumberSequenceService;
use App\Services\StockService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Purchase Returns API — Safe Extension (additive).
 * Approval ships stock OUT (stock_ledger + warehouse_stock) and
 * posts Dr "Accounts Payable" / Cr "Inventory" (purchase reversal).
 */
class PurchaseReturnController extends BaseController
{
    public function __construct(
        private NumberSequenceService $seq,
        private AccountingService $acct,
        private StockService $stock,
        private FinancialPeriodGuard $period,
    ) {}

    public function index(Request $r)
    {
        $q = PurchaseReturn::with('items.product');
        if ($r->branch_id) $q->where('branch_id', $r->branch_id);
        elseif (is_array($r->input('allowed_branch_ids')) && count($r->input('allowed_branch_ids'))) {
            $q->whereIn('branch_id', $r->input('allowed_branch_ids'));
        }
        if ($r->from)   $q->where('return_date', '>=', $r->from);
        if ($r->to)     $q->where('return_date', '<=', $r->to);
        if ($r->status) $q->where('status', $r->status);
        return $this->paginated($q->orderByDesc('return_date')->paginate($r->per_page ?? 25));
    }

    public function show(string $id)
    {
        return $this->success(PurchaseReturn::with('items.product')->findOrFail($id));
    }

    public function store(Request $r)
    {
        $r->validate([
            'return_date'         => 'required|date',
            'supplier_id'         => 'required|exists:suppliers,id',
            'branch_id'           => 'nullable|exists:branches,id',
            'warehouse_id'        => 'nullable|exists:warehouses,id',
            'purchase_id'         => 'nullable|exists:purchases,id',
            'items'               => 'required|array|min:1',
            'items.*.product_id'  => 'required|exists:item_master,id',
            'items.*.quantity'    => 'required|numeric|min:0.01',
            'items.*.unit_price'  => 'required|numeric|min:0',
        ]);

        $this->period->assertOpen($r->return_date, 'purchase return');

        // Cross-check return qty vs original purchased qty (if linked)
        if ($r->purchase_id) {
            $purchased = DB::table('purchase_items')
                ->where('purchase_id', $r->purchase_id)
                ->select('product_id', DB::raw('SUM(quantity) as q'))
                ->groupBy('product_id')->pluck('q', 'product_id');
            foreach ($r->items as $it) {
                $max = (float) ($purchased[$it['product_id']] ?? 0);
                if ((float) $it['quantity'] > $max) {
                    return $this->error("Return quantity ({$it['quantity']}) exceeds purchased quantity ({$max}) for product.", 422);
                }
            }
        }

        return DB::transaction(function () use ($r) {
            $number = $this->seq->next('purchase_return');
            $total = collect($r->items)->sum(fn ($i) => ($i['quantity'] * $i['unit_price']));

            $ret = PurchaseReturn::create([
                'return_number' => $number,
                'return_date'   => $r->return_date,
                'supplier_id'   => $r->supplier_id,
                'purchase_id'   => $r->purchase_id,
                'branch_id'     => $r->branch_id,
                'warehouse_id'  => $r->warehouse_id,
                'total_amount'  => $total,
                'reason'        => $r->reason,
                'status'        => 'draft',
                'created_by'    => $r->user()->id,
            ]);
            foreach ($r->items as $it) {
                PurchaseReturnItem::create([
                    'purchase_return_id' => $ret->id,
                    'product_id'         => $it['product_id'],
                    'quantity'           => $it['quantity'],
                    'unit_price'         => $it['unit_price'],
                    'total'              => $it['quantity'] * $it['unit_price'],
                ]);
            }
            $this->logAudit($r, 'create', $ret, ['return_number' => $number, 'total' => $total]);
            return $this->created($ret->load('items'));
        });
    }

    public function update(Request $r, string $id)
    {
        $ret = PurchaseReturn::findOrFail($id);
        if ($ret->status !== 'draft') return $this->error('Only draft returns can be edited', 422);
        $ret->update($r->only('return_date', 'supplier_id', 'reason', 'branch_id', 'warehouse_id'));
        return $this->success($ret->fresh('items'));
    }

    public function destroy(string $id)
    {
        $ret = PurchaseReturn::findOrFail($id);
        if ($ret->status === 'approved') return $this->error('Approved returns cannot be deleted', 422);
        $ret->delete();
        return $this->success(['deleted' => true]);
    }

    public function approve(Request $r, string $id)
    {
        $ret = PurchaseReturn::with('items')->findOrFail($id);
        if ($ret->status === 'approved') return $this->error('Already approved', 422);

        $this->period->assertOpen($ret->return_date, 'purchase return approval');

        DB::transaction(function () use ($ret, $r) {
            // 1) Stock movements audit
            $items = $ret->items->map(fn ($i) => ['product_id' => $i->product_id, 'quantity' => $i->quantity])->toArray();
            $this->stock->createBulkMovements($items, 'purchase_return', 'purchase_return', $ret->id, $ret->branch_id, -1);

            // 2) Immutable stock_ledger OUT + warehouse_stock decrement
            foreach ($ret->items as $it) {
                $this->stock->createLedgerEntry([
                    'transaction_type' => 'PURCHASE_RETURN',
                    'transaction_id'   => $ret->id,
                    'item_id'          => $it->product_id,
                    'branch_id'        => $ret->branch_id,
                    'warehouse_id'     => $ret->warehouse_id,
                    'quantity_in'      => 0,
                    'quantity_out'     => (float) $it->quantity,
                    'unit_cost'        => (float) $it->unit_price,
                    'reference_number' => $ret->return_number,
                    'transaction_date' => $ret->return_date->toDateString(),
                ]);
                if ($ret->warehouse_id) {
                    $this->stock->updateWarehouseStock($it->product_id, $ret->warehouse_id, -1 * (float) $it->quantity);
                }
            }

            // 3) Accounting: Dr Accounts Payable, Cr Inventory
            $this->acct->autoPost(
                'Accounts Payable', 'Inventory',
                (float) $ret->total_amount,
                "Purchase Return {$ret->return_number}",
                'journal',
                ['date' => $ret->return_date->toDateString(), 'branch_id' => $ret->branch_id, 'user_id' => $r->user()->id],
            );

            $ret->update(['status' => 'approved']);
            $this->logAudit($r, 'approve', $ret, [
                'return_number' => $ret->return_number,
                'total_amount'  => $ret->total_amount,
                'purchase_id'   => $ret->purchase_id,
                'item_count'    => $ret->items->count(),
            ]);
        });

        return $this->success($ret->fresh('items'));
    }

    private function logAudit(Request $r, string $action, PurchaseReturn $ret, array $details = []): void
    {
        try {
            AuditLog::create([
                'user_id'    => optional($r->user())->id,
                'user_name'  => optional($r->user())->name,
                'module'     => 'purchase_returns',
                'action'     => $action,
                'record_id'  => $ret->id,
                'details'    => json_encode(array_merge(['return_id' => $ret->id, 'purchase_id' => $ret->purchase_id], $details)),
                'new_data'   => $action === 'approve' ? ['status' => 'approved'] : null,
                'ip_address' => $r->ip(),
                'user_agent' => substr((string) $r->userAgent(), 0, 250),
            ]);
        } catch (\Throwable $e) {
            \Log::warning('audit_log insert failed (purchase_return): ' . $e->getMessage());
        }
    }
}
