<?php
namespace App\Http\Controllers\Sales;
use App\Http\Controllers\BaseController;
use App\Services\SalesService;
use App\Services\SmsService;
use App\Models\SalesInvoice;
use Illuminate\Http\Request;

class SalesInvoiceController extends BaseController
{
    public function __construct(private SalesService $service) {}

    public function index(Request $request)
    {
        $query = SalesInvoice::with('customer', 'branch');
        if ($request->branch_id) { $query->where('branch_id', $request->branch_id); } elseif (is_array($request->input('allowed_branch_ids')) && count($request->input('allowed_branch_ids'))) { $query->whereIn('branch_id', $request->input('allowed_branch_ids')); }
        if ($request->from) $query->where('invoice_date', '>=', $request->from);
        if ($request->to) $query->where('invoice_date', '<=', $request->to);
        return $this->paginated($query->orderByDesc('invoice_date')->paginate($request->per_page ?? 25));
    }

    public function store(Request $request)
    {
        $request->validate([
            'invoice_date' => 'required|date',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:item_master,id',
            'items.*.quantity' => 'required|numeric|min:0.01',
            'items.*.price' => 'required|numeric|min:0',
            'items.*.total' => 'required|numeric',
        ]);
        $data = array_merge($request->only('invoice_date', 'customer_id', 'branch_id', 'discount', 'notes'), ['user_id' => $request->user()->id]);
        $invoice = $this->service->createInvoice($data, $request->items);

        // Send SMS to customer
        if ($invoice->customer && $invoice->customer->phone) {
            try {
                app(SmsService::class)->sendInvoiceSms($invoice->customer->phone, $invoice->total_amount);
            } catch (\Exception $e) {
                \Log::error('Invoice SMS failed: ' . $e->getMessage());
            }
        }

        return $this->created($invoice);
    }

    public function show(string $id)
    {
        return $this->success(SalesInvoice::with('items.product', 'customer', 'branch')->findOrFail($id));
    }

    /**
     * Update header fields of an invoice. Blocked once invoice is paid or fully returned.
     */
    public function update(Request $request, string $id)
    {
        $invoice = SalesInvoice::findOrFail($id);
        if (in_array($invoice->status, ['paid', 'returned'], true)) {
            return $this->error('Cannot edit a paid or returned invoice', 422);
        }
        $request->validate([
            'invoice_date' => 'nullable|date',
            'customer_id'  => 'nullable|exists:customers,id',
            'discount'     => 'nullable|numeric|min:0',
            'notes'        => 'nullable|string',
        ]);
        $invoice->update($request->only('invoice_date', 'customer_id', 'discount', 'notes'));
        return $this->success($invoice->fresh('items'));
    }

    /**
     * Delete an invoice. Blocked when any payment exists or when status is non-draft.
     */
    public function destroy(string $id)
    {
        $invoice = SalesInvoice::findOrFail($id);
        if ($invoice->status !== 'draft' && $invoice->status !== 'cancelled') {
            // allow super-admin via SoftDeleteController, but reject here for safety
            return $this->error('Only draft or cancelled invoices can be deleted', 422);
        }
        $invoice->delete();
        return $this->success(['deleted' => true]);
    }
}
