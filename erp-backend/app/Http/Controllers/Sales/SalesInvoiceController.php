<?php
namespace App\Http\Controllers\Sales;
use App\Http\Controllers\BaseController;
use App\Services\SalesService;
use App\Services\SmsService;
use App\Models\AuditLog;
use App\Models\SalesInvoice;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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

    /**
     * Flip a draft/legacy invoice to approved. Stock (StockService::createBulkMovements)
     * and the AR/Sales Revenue GL posting are already applied by
     * SalesService::createInvoice() at creation time, so this is a pure status
     * flip — no stock or accounting side effects here.
     */
    public function approve(Request $request, string $id)
    {
        $invoice = SalesInvoice::findOrFail($id);
        if ($invoice->status === 'approved') {
            return $this->error('Already approved', 422);
        }
        if (in_array($invoice->status, ['cancelled', 'deleted', 'paid', 'returned'], true)) {
            return $this->error("Cannot approve an invoice with status '{$invoice->status}'", 422);
        }
        $invoice->update(['status' => 'approved']);
        $this->logAudit($request, 'approve', $invoice);
        return $this->success($invoice->fresh());
    }

    /**
     * Soft cancel. Mirrors VoucherController::deleteApproved()'s conservative
     * "mark + audit log" pattern: it does NOT reverse the stock deduction or
     * the AR/Sales Revenue GL entry already posted at creation — no such
     * reversal helper exists yet in this codebase. A manual reversing stock
     * adjustment / voucher must be created separately if that's needed.
     */
    public function cancel(Request $request, string $id)
    {
        $invoice = SalesInvoice::findOrFail($id);
        if ($invoice->status === 'cancelled') {
            return $this->error('Already cancelled', 422);
        }
        if (in_array($invoice->status, ['paid', 'returned', 'deleted'], true)) {
            return $this->error("Cannot cancel an invoice with status '{$invoice->status}'", 422);
        }
        $oldStatus = $invoice->status;
        $invoice->update(['status' => 'cancelled']);
        $this->logAudit($request, 'cancel', $invoice, [
            'old_status' => $oldStatus,
            'reason' => $request->input('reason'),
        ]);
        return $this->success($invoice->fresh());
    }

    /**
     * Super-Admin-only re-edit of an already-approved invoice's header
     * fields. Items/quantities are intentionally left untouched — they are
     * tied to the stock movements and the AR/Sales Revenue ledger entry
     * already posted at creation, and recalculating those needs
     * stock-reversal logic that doesn't exist elsewhere in this codebase.
     */
    public function editApproved(Request $request, string $id)
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admin can edit an approved invoice', 403);
        }
        $invoice = SalesInvoice::findOrFail($id);
        if ($invoice->status !== 'approved') {
            return $this->error('Invoice is not approved', 422);
        }
        $request->validate([
            'invoice_date' => 'nullable|date',
            'customer_id'  => 'nullable|exists:customers,id',
            'branch_id'    => 'nullable|exists:branches,id',
            'discount'     => 'nullable|numeric|min:0',
            'notes'        => 'nullable|string',
        ]);

        return DB::transaction(function () use ($request, $invoice) {
            $data = $request->only('invoice_date', 'customer_id', 'branch_id', 'discount', 'notes');
            if (array_key_exists('discount', $data) && $data['discount'] !== null) {
                $data['net_amount'] = (float) $invoice->total_amount - (float) $data['discount'];
            }
            $invoice->update($data);
            $this->logAudit($request, 'edit_approved', $invoice);
            return $this->success($invoice->fresh('items'));
        });
    }

    /**
     * Soft "delete" of an approved invoice. sales_invoices has no
     * deleted_at/deleted_by/prev_status columns (unlike acc_vouchers), so —
     * same spirit as VoucherController::deleteApproved() — the previous
     * status and who/when/why is captured in audit_log rather than dedicated
     * columns. Stock/GL effects from creation are NOT reversed automatically.
     */
    public function deleteApproved(Request $request, string $id)
    {
        $invoice = SalesInvoice::findOrFail($id);
        if ($invoice->status === 'deleted') {
            return $this->error('Invoice already deleted', 422);
        }
        $oldStatus = $invoice->status;
        $invoice->update(['status' => 'deleted']);
        $this->logAudit($request, 'delete_approved', $invoice, [
            'old_status' => $oldStatus,
            'reason' => $request->input('reason'),
        ]);
        return $this->success(['deleted' => true, 'id' => $invoice->id]);
    }

    private function logAudit(Request $request, string $action, SalesInvoice $invoice, array $extra = []): void
    {
        try {
            AuditLog::create([
                'user_id'    => optional($request->user())->id,
                'user_name'  => optional($request->user())->name,
                'module'     => 'sales_invoices',
                'action'     => $action,
                'record_id'  => $invoice->id,
                'details'    => json_encode(array_merge([
                    'invoice_number' => $invoice->invoice_number,
                    'status' => $invoice->status,
                ], $extra)),
                'new_data'   => ['status' => $invoice->status],
                'ip_address' => $request->ip(),
                'user_agent' => substr((string) $request->userAgent(), 0, 250),
            ]);
        } catch (\Throwable $e) {
            \Log::warning('audit_log insert failed (sales_invoice): ' . $e->getMessage());
        }
    }
}
