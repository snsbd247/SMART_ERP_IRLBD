<?php
namespace App\Http\Controllers\SalesWorkflow;

use App\Http\Controllers\BaseController;
use App\Models\SalesInvoiceV2;
use App\Models\VatChallan;
use App\Services\InvoiceProcessingService;
use App\Services\InvoicePaymentService;
use App\Services\DocumentDeleteGuard;
use Illuminate\Http\Request;

class InvoiceV2Controller extends BaseController
{
    public function __construct(
        private InvoiceProcessingService $invoiceService,
        private InvoicePaymentService $paymentService,
    ) {}

    public function index(Request $r)
    {
        $q = SalesInvoiceV2::with('customer')->latest('invoice_date');
        if ($r->customer_id) $q->where('customer_id', $r->customer_id);
        if ($r->status) $q->where('status', $r->status);
        if ($r->from) $q->where('invoice_date', '>=', $r->from);
        if ($r->to) $q->where('invoice_date', '<=', $r->to);
        if ($r->q) $q->where('invoice_number', 'like', "%{$r->q}%");
        return $this->paginated($q->paginate($r->per_page ?? 25));
    }

    public function eligible(Request $r)
    {
        // VAT challans where every DC is ho_received and not yet invoiced
        $q = VatChallan::with('items','deliveryChallans')
            ->where('status', '!=', 'invoiced')
            ->whereDoesntHave('deliveryChallans', function ($sub) {
                $sub->where('status', '!=', 'ho_received');
            });
        if ($r->customer_id) $q->where('customer_id', $r->customer_id);
        if ($r->date) $q->where('challan_date', $r->date);
        return $this->success($q->get());
    }

    public function store(Request $r)
    {
        $r->validate([
            'vat_challan_ids' => 'required|array|min:1',
            'vat_challan_ids.*' => 'required|exists:vat_challans,id',
            'mode' => 'required|in:single,same_day,custom',
        ]);
        $data = array_merge($r->only('invoice_date','notes','branch_id'), ['user_id' => $r->user()?->id]);
        return $this->created($this->invoiceService->create($data, $r->vat_challan_ids, $r->mode));
    }

    public function show(string $id)
    {
        return $this->success(SalesInvoiceV2::with('items.product','challans','payments','tdsEntries','customer','statusLogs','voucher')->findOrFail($id));
    }

    public function payment(Request $r, string $id)
    {
        $r->validate([
            'payment_date' => 'required|date',
            'amount_received' => 'required|numeric|min:0',
            'tds_amount' => 'nullable|numeric|min:0',
            'mode' => 'required|in:cash,bank,cheque,online',
        ]);
        $payment = $this->paymentService->recordPayment(array_merge(
            $r->only('payment_date','amount_received','tds_amount','mode','bank_account_id','reference','notes','tds_certificate_no','tds_certificate_date','branch_id'),
            ['invoice_id' => $id, 'user_id' => $r->user()?->id]
        ));
        return $this->created($payment);
    }

    public function destroy(Request $r, string $id)
    {
        DocumentDeleteGuard::forUser($r->user())->invoice($id);
        SalesInvoiceV2::findOrFail($id)->delete();
        return $this->success(['deleted' => true]);
    }

    /**
     * Mark bill submitted to customer HO. Computes bill_due_date = bill_submitted_at + payment_terms_days.
     */
    public function submitBill(Request $r, string $id)
    {
        $r->validate([
            'bill_submitted_at' => 'required|date',
            'payment_terms_days' => 'nullable|integer|min:0|max:365',
            'bill_submission_ref' => 'nullable|string|max:100',
        ]);
        $inv = SalesInvoiceV2::findOrFail($id);
        $days = (int) ($r->payment_terms_days ?? $inv->payment_terms_days ?? 30);
        $submittedAt = $r->bill_submitted_at;
        $inv->update([
            'bill_submitted_at' => $submittedAt,
            'payment_terms_days' => $days,
            'bill_due_date' => date('Y-m-d', strtotime($submittedAt . " +{$days} days")),
            'bill_submission_ref' => $r->bill_submission_ref,
            'status' => $inv->status === 'posted' ? 'bill_submitted' : $inv->status,
        ]);
        \App\Models\InvoiceStatusLog::create([
            'invoice_id' => $inv->id,
            'new_status' => 'bill_submitted',
            'changed_by' => $r->user()?->id,
            'notes' => "Bill submitted to customer HO (ref: {$r->bill_submission_ref}). Due in {$days} days.",
        ]);
        return $this->success($inv->fresh());
    }
}
