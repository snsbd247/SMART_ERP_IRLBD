<?php
namespace App\Http\Controllers\Sales;

use App\Http\Controllers\BaseController;
use App\Models\SalesReturn;
use App\Models\SalesReturnItem;
use App\Services\AccountingService;
use App\Services\NumberSequenceService;
use App\Services\StockService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Sales Returns API — Safe Extension (additive).
 * Endpoints: index, show, store, update, destroy, approve.
 * Approval reverses stock (+qty) and posts Dr "Sales Return" / Cr "Accounts Receivable".
 */
class SalesReturnController extends BaseController
{
    public function __construct(
        private NumberSequenceService $seq,
        private AccountingService $acct,
        private StockService $stock,
    ) {}

    public function index(Request $r)
    {
        $q = SalesReturn::with('customer', 'items.product');
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
        return $this->success(SalesReturn::with('items.product', 'customer')->findOrFail($id));
    }

    public function store(Request $r)
    {
        $r->validate([
            'return_date' => 'required|date',
            'sales_invoice_id' => 'nullable|exists:sales_invoices,id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:item_master,id',
            'items.*.quantity'   => 'required|numeric|min:0.01',
            'items.*.price'      => 'required|numeric|min:0',
        ]);

        return DB::transaction(function () use ($r) {
            $number = $this->seq->next('sales_return');
            $total = collect($r->items)->sum(fn ($i) => ($i['quantity'] * $i['price']));

            $ret = SalesReturn::create([
                'return_number' => $number,
                'return_date'   => $r->return_date,
                'customer_id'   => $r->customer_id,
                'sales_invoice_id' => $r->sales_invoice_id,
                'branch_id'     => $r->branch_id,
                'total_amount'  => $total,
                'reason'        => $r->reason,
                'status'        => 'draft',
                'created_by'    => $r->user()->id,
            ]);
            foreach ($r->items as $it) {
                SalesReturnItem::create([
                    'sales_return_id' => $ret->id,
                    'product_id' => $it['product_id'],
                    'quantity'   => $it['quantity'],
                    'price'      => $it['price'],
                    'total'      => $it['quantity'] * $it['price'],
                ]);
            }
            return $this->created($ret->load('items'));
        });
    }

    public function update(Request $r, string $id)
    {
        $ret = SalesReturn::findOrFail($id);
        if ($ret->status !== 'draft') return $this->error('Only draft returns can be edited', 422);
        $ret->update($r->only('return_date', 'customer_id', 'reason', 'branch_id'));
        return $this->success($ret->fresh('items'));
    }

    public function destroy(string $id)
    {
        $ret = SalesReturn::findOrFail($id);
        if ($ret->status === 'approved') return $this->error('Approved returns cannot be deleted', 422);
        $ret->delete();
        return $this->success(['deleted' => true]);
    }

    public function approve(Request $r, string $id)
    {
        $ret = SalesReturn::with('items')->findOrFail($id);
        if ($ret->status === 'approved') return $this->error('Already approved', 422);

        DB::transaction(function () use ($ret, $r) {
            // Reverse stock: items come back into inventory (+qty)
            $items = $ret->items->map(fn ($i) => ['product_id' => $i->product_id, 'quantity' => $i->quantity])->toArray();
            $this->stock->createBulkMovements($items, 'sales_return', 'sales_return', $ret->id, $ret->branch_id, +1);

            // Accounting: Dr Sales Return, Cr Accounts Receivable
            $this->acct->autoPost(
                'Sales Return', 'Accounts Receivable',
                (float) $ret->total_amount,
                "Sales Return {$ret->return_number}",
                'journal',
                ['date' => $ret->return_date->toDateString(), 'branch_id' => $ret->branch_id, 'user_id' => $r->user()->id],
            );

            $ret->update(['status' => 'approved']);
        });

        return $this->success($ret->fresh('items'));
    }
}
