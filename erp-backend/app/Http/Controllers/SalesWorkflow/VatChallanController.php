<?php
namespace App\Http\Controllers\SalesWorkflow;

use App\Http\Controllers\BaseController;
use App\Models\VatChallan;
use App\Services\VatChallanService;
use App\Services\DocumentDeleteGuard;
use Illuminate\Http\Request;

class VatChallanController extends BaseController
{
    public function __construct(private VatChallanService $service) {}

    public function index(Request $r)
    {
        $q = VatChallan::with('customer', 'items')->latest('challan_date');
        if ($r->customer_id) $q->where('customer_id', $r->customer_id);
        if ($r->status) $q->where('status', $r->status);
        if ($r->from) $q->where('challan_date', '>=', $r->from);
        if ($r->to) $q->where('challan_date', '<=', $r->to);
        if ($r->q) $q->where('challan_number', 'like', "%{$r->q}%");
        return $this->paginated($q->paginate($r->per_page ?? 25));
    }

    public function store(Request $r)
    {
        $r->validate([
            'challan_date' => 'required|date',
            'customer_id' => 'required|exists:customers,id',
            'purchase_order_id' => 'required|exists:purchase_orders,id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:item_master,id',
            'items.*.purchase_order_item_id' => 'required|exists:purchase_order_items,id',
            'items.*.qty' => 'required|numeric|min:0.001',
            'items.*.rate' => 'required|numeric|min:0',
            'items.*.vat_pct' => 'nullable|numeric|min:0|max:100',
        ]);
        $data = array_merge($r->only('challan_date','customer_id','purchase_order_id','vehicle_no','driver_name','source','attachment_url','notes','branch_id','financial_year_id'),
                            ['created_by' => $r->user()?->id]);
        return $this->created($this->service->create($data, $r->items));
    }

    public function poAvailability(string $poId)
    {
        $po = \App\Models\PurchaseOrder::with(['items.product','customer'])->findOrFail($poId);
        return $this->success([
            'id' => $po->id,
            'po_number' => $po->po_number,
            'po_date' => $po->po_date,
            'customer' => $po->customer,
            'items' => $po->items->map(fn($i) => [
                'id' => $i->id,
                'product_id' => $i->product_id,
                'product' => $i->product,
                'qty_ordered' => (float) $i->qty_ordered,
                'qty_delivered' => (float) $i->qty_delivered,
                'qty_remaining' => (float) $i->qty_remaining,
                'rate' => (float) $i->rate,
                'vat_pct' => (float) $i->vat_pct,
            ])->values(),
        ]);
    }

    public function show(string $id)
    {
        return $this->success(VatChallan::with('items.product','items.purchaseOrderItem','customer','purchaseOrder','deliveryChallans')->findOrFail($id));
    }

    public function destroy(Request $r, string $id)
    {
        DocumentDeleteGuard::forUser($r->user())->vatChallan($id);
        $challan = VatChallan::with('items')->findOrFail($id);
        $this->service->delete($challan);
        return $this->success(['deleted' => true]);
    }
}
