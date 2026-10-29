<?php

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\BaseController;
use App\Models\AccVoucher;
use App\Models\ChartOfAccount;
use App\Models\Customer;
use App\Models\MoneyReceipt;
use App\Models\MoneyReceiptSetting;
use App\Services\AccountingService;
use App\Services\FinancialPeriodGuard;
use App\Support\NumberToWords;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Money Receipt — a standalone printable cash-memo record. Linking an
 * existing Receipt Voucher keeps it purely a reference (no posting). Leaving
 * "Link Receipt Voucher" empty makes the money receipt itself trigger a real
 * Receipt Voucher (Debit Cash/Bank, Credit the picked "On account of"
 * ledger) — the one deliberate exception to "never touches accounting".
 */
class MoneyReceiptController extends BaseController
{
    public function __construct(
        private AccountingService $accountingService,
        private FinancialPeriodGuard $period,
    ) {}

    public function index(Request $request)
    {
        $query = MoneyReceipt::with([
            'receiptVoucher:id,voucher_number',
            'customer:id,name,address',
            'onAccountLedger:id,account_name,account_code',
            'creator:id,name,username',
        ])
            ->orderBy('receipt_date', 'desc')
            ->orderBy('created_at', 'desc');

        $allowed = $request->input('allowed_branch_ids');
        if (is_array($allowed) && count($allowed) > 0) {
            $query->whereIn('branch_id', $allowed);
        }

        if ($search = trim((string) $request->input('search', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('receipt_no', 'like', "%{$search}%")
                    ->orWhere('received_from', 'like', "%{$search}%")
                    ->orWhere('against_bill_no', 'like', "%{$search}%");
            });
        }
        if ($from = $request->input('from')) {
            $query->where('receipt_date', '>=', $from);
        }
        if ($to = $request->input('to')) {
            $query->where('receipt_date', '<=', $to);
        }

        return $this->paginated($query->paginate($request->input('per_page', 50)));
    }

    public function show(Request $request, string $id)
    {
        $query = MoneyReceipt::with([
            'receiptVoucher:id,voucher_number,voucher_date,total_amount',
            'customer:id,name,address',
            'onAccountLedger:id,account_name,account_code',
            'creator:id,name,username',
        ]);
        $allowed = $request->input('allowed_branch_ids');
        if (is_array($allowed) && count($allowed) > 0) {
            $query->whereIn('branch_id', $allowed);
        }
        return $this->success($query->findOrFail($id));
    }

    /**
     * GET /v1/money-receipts/customers/{customerId}/receipt-vouchers
     * Receipt Vouchers that actually touch this customer's own ledger
     * (customers.receivable_account_id) — used to populate "Link Receipt
     * Voucher" scoped to the selected customer. Empty when the customer has
     * no receivable ledger configured; that's expected, not an error — the
     * money receipt just auto-creates its own voucher in that case.
     */
    public function receiptVouchersForCustomer(Request $request, string $customerId)
    {
        $customer = Customer::find($customerId);
        if (!$customer || !$customer->receivable_account_id) {
            return $this->success([]);
        }

        // Some older receipts were posted against the customer's PARENT
        // "AR - <name>" ledger rather than their own dedicated sub-ledger
        // (e.g. code 1244 vs the customer's 1244001) — match both so those
        // still show up here.
        $ledgerIds = [$customer->receivable_account_id];
        $parentId = ChartOfAccount::where('id', $customer->receivable_account_id)->value('parent_id');
        if ($parentId) {
            $ledgerIds[] = $parentId;
        }

        $query = AccVoucher::where('voucher_type', 'receipt')
            ->whereNull('deleted_at')
            ->whereHas('entries', function ($q) use ($ledgerIds) {
                $q->whereIn('account_id', $ledgerIds);
            });

        $allowed = $request->input('allowed_branch_ids');
        if (is_array($allowed) && count($allowed) > 0) {
            $query->whereIn('branch_id', $allowed);
        }

        $vouchers = $query->orderBy('voucher_date', 'desc')->limit(200)->get(['id', 'voucher_number', 'voucher_date', 'total_amount']);
        return $this->success($vouchers);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'receipt_voucher_id' => 'nullable|uuid',
            'customer_id' => 'nullable|uuid',
            'received_from' => 'required|string|max:191',
            'address' => 'nullable|string',
            'on_account_of' => 'nullable|string',
            'on_account_ledger_id' => 'required_without:receipt_voucher_id|nullable|uuid',
            'payment_mode' => 'required|in:cash,cheque,po,dd',
            'payment_ref_no' => 'nullable|string|max:100',
            'receipt_date' => 'required|date',
            'against_bill_no' => 'nullable|string|max:100',
            'against_bill_date' => 'nullable|date',
            'amount' => 'required|numeric|min:0.01',
            'branch_id' => 'nullable|uuid',
        ]);

        $branchId = $this->resolveBranchId($request, $data['branch_id'] ?? null);

        $receipt = DB::transaction(function () use ($data, $branchId, $request) {
            $receiptNo = $this->issueNextNumber();

            $receiptVoucherId = $data['receipt_voucher_id'] ?? null;
            if (!$receiptVoucherId) {
                $voucher = $this->autoCreateReceiptVoucher($data, $branchId, $request->user());
                $receiptVoucherId = $voucher->id;
            }

            return MoneyReceipt::create([
                'receipt_no' => $receiptNo,
                'receipt_voucher_id' => $receiptVoucherId,
                'customer_id' => $data['customer_id'] ?? null,
                'received_from' => $data['received_from'],
                'address' => $data['address'] ?? null,
                'on_account_of' => $data['on_account_of'] ?? null,
                'on_account_ledger_id' => $data['on_account_ledger_id'] ?? null,
                'payment_mode' => $data['payment_mode'],
                'payment_ref_no' => $data['payment_ref_no'] ?? null,
                'receipt_date' => $data['receipt_date'],
                'against_bill_no' => $data['against_bill_no'] ?? null,
                'against_bill_date' => $data['against_bill_date'] ?? null,
                'amount' => $data['amount'],
                'amount_in_words' => NumberToWords::taka((float) $data['amount']),
                'branch_id' => $branchId,
                'verify_code' => (string) Str::uuid(),
                'created_by' => $request->user()?->id,
            ]);
        });

        return $this->created($receipt->load([
            'receiptVoucher:id,voucher_number',
            'customer:id,name,address',
            'onAccountLedger:id,account_name,account_code',
            'creator:id,name,username',
        ]));
    }

    public function update(Request $request, string $id)
    {
        $receipt = MoneyReceipt::findOrFail($id);

        $data = $request->validate([
            'receipt_voucher_id' => 'nullable|uuid',
            'customer_id' => 'nullable|uuid',
            'received_from' => 'required|string|max:191',
            'address' => 'nullable|string',
            'on_account_of' => 'nullable|string',
            'on_account_ledger_id' => 'required_without:receipt_voucher_id|nullable|uuid',
            'payment_mode' => 'required|in:cash,cheque,po,dd',
            'payment_ref_no' => 'nullable|string|max:100',
            'receipt_date' => 'required|date',
            'against_bill_no' => 'nullable|string|max:100',
            'against_bill_date' => 'nullable|date',
            'amount' => 'required|numeric|min:0.01',
            'branch_id' => 'nullable|uuid',
        ]);

        $data['branch_id'] = $this->resolveBranchId($request, $data['branch_id'] ?? $receipt->branch_id);
        $data['amount_in_words'] = NumberToWords::taka((float) $data['amount']);

        DB::transaction(function () use (&$data, $receipt, $request) {
            // Never silently re-post: if no RV is linked in the submitted data,
            // keep whatever this receipt already has. Only auto-create a
            // voucher the first time a receipt ends up with no link at all.
            if (empty($data['receipt_voucher_id'])) {
                if ($receipt->receipt_voucher_id) {
                    $data['receipt_voucher_id'] = $receipt->receipt_voucher_id;
                } else {
                    $voucher = $this->autoCreateReceiptVoucher($data, $data['branch_id'], $request->user());
                    $data['receipt_voucher_id'] = $voucher->id;
                }
            }

            $receipt->update($data);
        });

        return $this->success($receipt->fresh([
            'receiptVoucher:id,voucher_number',
            'customer:id,name,address',
            'onAccountLedger:id,account_name,account_code',
            'creator:id,name,username',
        ]));
    }

    public function destroy(string $id)
    {
        MoneyReceipt::findOrFail($id)->delete();
        return $this->success(null, 'Deleted');
    }

    public function getSettings()
    {
        $setting = MoneyReceiptSetting::find('default');
        $last = (int) ($setting->last_number ?? 0);
        return $this->success([
            'last_number' => $last,
            'next_number' => $this->formatNumber($last + 1),
        ]);
    }

    public function updateSettings(Request $request)
    {
        $data = $request->validate(['last_number' => 'required|integer|min:0']);

        $setting = DB::transaction(function () use ($data) {
            $setting = MoneyReceiptSetting::lockForUpdate()->find('default');
            if (!$setting) {
                $setting = MoneyReceiptSetting::create(['id' => 'default', 'last_number' => 0]);
                $setting = MoneyReceiptSetting::lockForUpdate()->find('default');
            }
            $setting->last_number = $data['last_number'];
            $setting->save();
            return $setting;
        });

        return $this->success([
            'last_number' => (int) $setting->last_number,
            'next_number' => $this->formatNumber((int) $setting->last_number + 1),
        ]);
    }

    /**
     * Debit Cash in Hand (Cash mode) or Bank Account (Cheque/P.O/D.D), Credit
     * the "On account of" ledger the user picked. Same account-name lookup
     * + AccountingService::createVoucher() pattern InvoicePaymentService
     * already uses for auto-posted receipts.
     */
    private function autoCreateReceiptVoucher(array $data, ?string $branchId, $user): AccVoucher
    {
        $this->period->assertOpen($data['receipt_date'] ?? null, 'Money Receipt');

        $debitAccountName = $data['payment_mode'] === 'cash' ? 'Cash in Hand' : 'Bank Account';
        $debitAccount = ChartOfAccount::whereRaw('LOWER(account_name) = ?', [strtolower($debitAccountName)])->first();
        if (!$debitAccount) {
            throw new \RuntimeException("Cannot auto-create Receipt Voucher: '{$debitAccountName}' ledger not found in Chart of Accounts.");
        }
        if (empty($data['on_account_ledger_id'])) {
            throw new \RuntimeException('Select an "On account of" ledger, or link an existing Receipt Voucher.');
        }

        $amount = (float) $data['amount'];
        $description = 'Money Receipt' . (!empty($data['received_from']) ? " — {$data['received_from']}" : '');

        return $this->accountingService->createVoucher([
            'voucher_type' => 'receipt',
            'voucher_date' => $data['receipt_date'],
            'description' => $description,
            'branch_id' => $branchId,
            'financial_year_id' => $this->period->resolveOrCreateId($data['receipt_date']),
            'created_by' => $user?->id,
            'source_module' => 'money_receipt',
        ], [
            ['account_id' => $debitAccount->id, 'debit' => $amount, 'credit' => 0, 'narration' => $description],
            ['account_id' => $data['on_account_ledger_id'], 'debit' => 0, 'credit' => $amount, 'narration' => $description],
        ], true);
    }

    private function resolveBranchId(Request $request, ?string $branchId): ?string
    {
        $allowed = $request->input('allowed_branch_ids');
        if (is_array($allowed) && count($allowed) > 0) {
            if (empty($branchId) || !in_array($branchId, $allowed, true)) {
                return $allowed[0];
            }
        }
        return $branchId ?: $request->user()?->branch_id;
    }

    /**
     * Atomically issues the next receipt number. Plain incrementing digits
     * (no prefix/year) to mirror the physical receipt book the user is
     * replacing — e.g. "070", continuing from a starting point set in
     * Settings (input 069 → next issued is 070).
     */
    private function issueNextNumber(): string
    {
        $setting = MoneyReceiptSetting::lockForUpdate()->find('default');
        if (!$setting) {
            $setting = MoneyReceiptSetting::create(['id' => 'default', 'last_number' => 0]);
            $setting = MoneyReceiptSetting::lockForUpdate()->find('default');
        }

        $next = (int) $setting->last_number + 1;
        // Guard against a manually-edited duplicate still sitting in the table.
        $guard = 0;
        while (MoneyReceipt::withTrashed()->where('receipt_no', $this->formatNumber($next))->exists() && $guard++ < 10000) {
            $next++;
        }

        $setting->last_number = $next;
        $setting->save();

        return $this->formatNumber($next);
    }

    private function formatNumber(int $number): string
    {
        return str_pad((string) $number, 3, '0', STR_PAD_LEFT);
    }
}
