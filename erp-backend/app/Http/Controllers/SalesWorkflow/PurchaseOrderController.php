<?php
namespace App\Http\Controllers\SalesWorkflow;

use App\Http\Controllers\BaseController;
use App\Models\PurchaseOrder;
use App\Services\DocumentDeleteGuard;
use App\Services\PurchaseOrderService;
use Illuminate\Http\Request;

class PurchaseOrderController extends BaseController
{
    public function __construct(private PurchaseOrderService $service) {}

    public function index(Request $r)
    {
        $q = PurchaseOrder::with('customer', 'items')->latest('po_date');
        if ($r->customer_id) $q->where('customer_id', $r->customer_id);
        if ($r->status) $q->where('status', $r->status);
        if ($r->branch_id) { $q->where('branch_id', $r->branch_id); } elseif (is_array($r->input('allowed_branch_ids')) && count($r->input('allowed_branch_ids'))) { $q->whereIn('branch_id', $r->input('allowed_branch_ids')); }
        if ($r->from) $q->where('po_date', '>=', $r->from);
        if ($r->to) $q->where('po_date', '<=', $r->to);
        if ($r->q) $q->where('po_number', 'like', "%{$r->q}%");
        return $this->paginated($q->paginate($r->per_page ?? 25));
    }

    public function store(Request $r)
    {
        $r->validate([
            'po_date' => 'required|date',
            'customer_id' => 'required|exists:customers,id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:item_master,id',
            'items.*.qty_ordered' => 'required|numeric|min:0.001',
            'items.*.rate' => 'required|numeric|min:0',
            'items.*.vat_pct' => 'nullable|numeric|min:0|max:100',
        ]);
        $data = array_merge($r->only('po_date','customer_id','delivery_date','notes','attachment_url','branch_id','financial_year_id'),
                            ['created_by' => $r->user()?->id]);
        return $this->created($this->service->create($data, $r->items));
    }

    public function show(string $id)
    {
        return $this->success(PurchaseOrder::with('items.product', 'customer', 'amendments')->findOrFail($id));
    }

    public function update(Request $r, string $id)
    {
        $r->validate(['items' => 'required|array|min:1']);
        $data = $r->only('po_date','customer_id','delivery_date','notes','attachment_url');
        return $this->success($this->service->amend($id, $data, $r->items, $r->user()?->id, $r->input('reason', '')));
    }

    public function destroy(Request $r, string $id)
    {
        DocumentDeleteGuard::forUser($r->user())->purchaseOrder($id);
        PurchaseOrder::findOrFail($id)->delete();
        return $this->success(['deleted' => true]);
    }
}
