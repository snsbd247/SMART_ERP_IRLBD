<?php
namespace App\Http\Controllers\Purchase;

use App\Http\Controllers\BaseController;
use App\Models\PurchaseReturn;
use App\Models\PurchaseReturnItem;
use App\Services\AccountingService;
use App\Services\NumberSequenceService;
use App\Services\StockService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Purchase Returns API — Safe Extension (additive).
 * Approval reduces stock (-qty) and posts Dr "Accounts Payable" / Cr "Purchase Return".
 */
class PurchaseReturnController extends BaseController
{
    public function __construct(
        private NumberSequenceService $seq,
        private AccountingService $acct,
        private StockService $stock,
    ) {}

    public function index(Request $r)
    {
        $q = PurchaseReturn::with('supplier', 'items.product');
        if ($r->branch_id) $q->where('branch_id', $r->branch_id);
        elseif (is_array($r->input('allowed_branch_ids')) && count($r->input('allowed_branch_ids'))) {
            $q->whereIn('branch_id', $r->input('allowed_branch_ids'));
        }
        if ($r->from) $q->where('return_date', '>=', $r->from);
        if ($r->to)   $q->where('return_date', '<=', $r->to);
        if ($r->status) $q->where('status', $r->status);
        return $this->paginated($q->orderByDesc('return_date')->paginate($r->per_page ?? 25));
    }

    public function show(string $id)
    {
        return $this->success(PurchaseReturn::with('items.product', 'supplier')->findOrFail($id));
    }

    public function store(Request $r)
    {
        $r->validate([
            'return_date' => 'required|date',
            'purchase_id' => 'nullable|exists:purchases,id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:item_master,id',
            'items.*.quantity'   => 'required|numeric|min:0.01',
            'items.*.unit_price' => 'required|numeric|min:0',
        ]);

        return DB::transaction(function () use ($r) {
            $number = $this->seq->next('purchase_return');
            $total = collect($r->items)->sum(fn ($i) => ($i['quantity'] * $i['unit_price']));

            $ret = PurchaseReturn::create([
                'return_number'  => $number,
                'return_date'    => $r->return_date,
                'supplier_id'    => $r->supplier_id,
                'purchase_id'    => $r->purchase_id,
                'branch_id'      => $r->branch_id,
                'total_amount'   => $total,
                'reason'         => $r->reason,
                'status'         => 'draft',
                'created_by'     => $r->user()->id,
            ]);
            foreach ($r->items as $it) {
                PurchaseReturnItem::create([
                    'purchase_return_id' => $ret->id,
                    'product_id' => $it['product_id'],
                    'quantity'   => $it['quantity'],
                    'unit_price' => $it['unit_price'],
                    'total'      => $it['quantity'] * $it['unit_price'],
                ]);
            }
            return $this->created($ret->load('items'));
        });
    }

    public function update(Request $r, string $id)
    {
        $ret = PurchaseReturn::findOrFail($id);
        if ($ret->status !== 'draft') return $this->error('Only draft returns can be edited', 422);
        $ret->update($r->only('return_date', 'supplier_id', 'reason', 'branch_id'));
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

        DB::transaction(function () use ($ret, $r) {
            // Reverse stock: goods go back to supplier (-qty)
            $items = $ret->items->map(fn ($i) => ['product_id' => $i->product_id, 'quantity' => $i->quantity])->toArray();
            $this->stock->createBulkMovements($items, 'purchase_return', 'purchase_return', $ret->id, $ret->branch_id, -1);

            // Accounting: Dr Accounts Payable, Cr Purchase Return
            $this->acct->autoPost(
                'Accounts Payable', 'Purchase Return',
                (float) $ret->total_amount,
                "Purchase Return {$ret->return_number}",
                'journal',
                ['date' => $ret->return_date->toDateString(), 'branch_id' => $ret->branch_id, 'user_id' => $r->user()->id],
            );

            $ret->update(['status' => 'approved']);
        });

        return $this->success($ret->fresh('items'));
    }
}
