<?php
namespace App\Http\Controllers\Purchase;
use App\Http\Controllers\BaseController;
use App\Services\PurchaseService;
use App\Models\Purchase;
use Illuminate\Http\Request;

class PurchaseController extends BaseController
{
    public function __construct(private PurchaseService $service) {}

    public function index(Request $request)
    {
        $query = Purchase::with('supplier', 'branch');
        if ($request->branch_id) { $query->where('branch_id', $request->branch_id); } elseif (is_array($request->input('allowed_branch_ids')) && count($request->input('allowed_branch_ids'))) { $query->whereIn('branch_id', $request->input('allowed_branch_ids')); }
        if ($request->from) $query->where('purchase_date', '>=', $request->from);
        if ($request->to) $query->where('purchase_date', '<=', $request->to);
        return $this->paginated($query->orderByDesc('purchase_date')->paginate($request->per_page ?? 25));
    }

    public function store(Request $request)
    {
        $request->validate([
            'purchase_date' => 'required|date',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:item_master,id',
            'items.*.quantity' => 'required|numeric|min:0.01',
            'items.*.unit_price' => 'required|numeric|min:0',
            'items.*.total' => 'required|numeric',
        ]);
        $data = array_merge($request->only('purchase_date', 'supplier_id', 'branch_id', 'payment_method', 'notes'), ['user_id' => $request->user()->id]);
        return $this->created($this->service->createPurchase($data, $request->items));
    }

    public function show(string $id)
    {
        return $this->success(Purchase::with('items.product', 'supplier', 'branch')->findOrFail($id));
    }
}
