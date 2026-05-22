<?php
namespace App\Http\Controllers\SalesWorkflow;

use App\Http\Controllers\BaseController;
use App\Models\Dispatch;
use App\Services\DispatchService;
use App\Services\DocumentDeleteGuard;
use Illuminate\Http\Request;

class DispatchController extends BaseController
{
    public function __construct(private DispatchService $service) {}

    public function index(Request $r)
    {
        $q = Dispatch::with('customer', 'items.allocations')->latest('dispatch_date');
        if ($r->customer_id) $q->where('customer_id', $r->customer_id);
        if ($r->status) $q->where('status', $r->status);
        if ($r->branch_id) $q->where('branch_id', $r->branch_id);
        if ($r->q) $q->where('dispatch_number', 'like', "%{$r->q}%");
        return $this->paginated($q->paginate($r->per_page ?? 25));
    }

    public function store(Request $r)
    {
        $r->validate([
            'dispatch_date' => 'required|date',
            'customer_id' => 'required|exists:customers,id',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:item_master,id',
            'items.*.qty' => 'required|numeric|min:0.001',
            'items.*.allocations' => 'required|array|min:1',
            'items.*.allocations.*.po_item_id' => 'required|exists:purchase_order_items,id',
            'items.*.allocations.*.allocated_qty' => 'required|numeric|min:0.001',
        ]);
        $data = array_merge($r->only('dispatch_date','customer_id','vehicle_no','driver_name','driver_phone','notes','branch_id','financial_year_id'),
                            ['created_by' => $r->user()?->id]);
        return $this->created($this->service->create($data, $r->items));
    }

    public function show(string $id)
    {
        return $this->success(Dispatch::with('items.allocations.poItem.po', 'customer')->findOrFail($id));
    }

    public function transition(Request $r, string $id)
    {
        $r->validate(['status' => 'required|in:draft,dispatched,delivered,received,cancelled']);
        return $this->success($this->service->transitionStatus($id, $r->status, $r->user()?->id, $r->input('notes')));
    }

    public function destroy(Request $r, string $id)
    {
        DocumentDeleteGuard::forUser($r->user())->dispatch($id);
        Dispatch::findOrFail($id)->delete();
        return $this->success(['deleted' => true]);
    }
}
