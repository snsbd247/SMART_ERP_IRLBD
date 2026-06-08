<?php

namespace App\Services;

use App\Models\InvoicePayment;
use App\Models\TdsEntry;
use App\Models\SalesInvoiceV2;
use App\Models\ChartOfAccount;
use Illuminate\Support\Facades\DB;

class InvoicePaymentService
{
    public function __construct(
        private NumberSequenceService $seq,
        private AccountingService $accountingService,
        private FinancialPeriodGuard $period,
    ) {}

    /**
     * Record a payment against an invoice.
     * amount_received = cash/bank received; tds_amount = withheld by customer.
     * total_settled (against AR) = amount_received + tds_amount.
     */
    public function recordPayment(array $data): InvoicePayment
    {
        $this->period->assertOpen($data['payment_date'] ?? null, 'Payment');
        return DB::transaction(function () use ($data) {
            $invoice = SalesInvoiceV2::lockForUpdate()->findOrFail($data['invoice_id']);
            $received = (float) $data['amount_received'];
            $tds = (float) ($data['tds_amount'] ?? 0);
            $settled = $received + $tds;

            if ($settled <= 0) throw new \InvalidArgumentException('Payment must be greater than zero.');
            if ($settled > $invoice->due_amount + 0.01) {
                throw new \InvalidArgumentException("Payment {$settled} exceeds outstanding {$invoice->due_amount}");
            }

            $payment = InvoicePayment::create([
                'payment_number' => $this->seq->next('invoice_payment'),
                'invoice_id' => $invoice->id,
                'payment_date' => $data['payment_date'] ?? now()->toDateString(),
                'mode' => $data['mode'] ?? 'bank',
                'amount_received' => $received,
                'tds_amount' => $tds,
                'total_settled' => $settled,
                'bank_account_id' => $data['bank_account_id'] ?? null,
                'reference' => $data['reference'] ?? null,
                'notes' => $data['notes'] ?? null,
                'branch_id' => $data['branch_id'] ?? $invoice->branch_id,
                'financial_year_id' => $invoice->financial_year_id,
                'created_by' => $data['user_id'] ?? null,
            ]);

            // TDS entry
            if ($tds > 0) {
                $tdsEntry = TdsEntry::create([
                    'invoice_id' => $invoice->id,
                    'payment_id' => $payment->id,
                    'tds_pct' => $invoice->grand_total > 0 ? round($tds * 100 / $invoice->grand_total, 2) : 0,
                    'tds_amount' => $tds,
                    'certificate_no' => $data['tds_certificate_no'] ?? null,
                    'certificate_date' => $data['tds_certificate_date'] ?? null,
                    'created_by' => $data['user_id'] ?? null,
                ]);
            }

            // Update invoice running totals
            $invoice->paid_amount = $invoice->paid_amount + $received;
            $invoice->tds_amount  = $invoice->tds_amount + $tds;
            $invoice->due_amount  = max(0, $invoice->due_amount - $settled);
            $invoice->status = $invoice->due_amount <= 0.01 ? 'paid' : 'partial_paid';
            $invoice->save();

            // Voucher: DR Bank/Cash, DR TDS Receivable, CR AR
            $voucher = $this->postPaymentVoucher($payment, $invoice);
            if ($voucher) {
                $payment->update(['voucher_id' => $voucher->id]);
                if (isset($tdsEntry)) $tdsEntry->update(['voucher_id' => $voucher->id]);
            }

            return $payment->fresh();
        });
    }

    private function postPaymentVoucher(InvoicePayment $payment, SalesInvoiceV2 $invoice)
    {
        $bankAccountName = $payment->mode === 'cash' ? 'Cash in Hand' : 'Bank Account';
        $bank = $this->resolve($bankAccountName);
        $ar = $this->resolve('Accounts Receivable');
        $tds = $this->resolve('TDS Receivable');

        if (!$bank || !$ar) return null;

        $entries = [];
        if ($payment->amount_received > 0) {
            $entries[] = ['account_id' => $bank->id, 'debit' => $payment->amount_received, 'credit' => 0, 'narration' => "Receipt {$payment->payment_number}"];
        }
        if ($payment->tds_amount > 0 && $tds) {
            $entries[] = ['account_id' => $tds->id, 'debit' => $payment->tds_amount, 'credit' => 0, 'narration' => "TDS on {$invoice->invoice_number}"];
        }
        $entries[] = ['account_id' => $ar->id, 'debit' => 0, 'credit' => $payment->total_settled, 'narration' => "Settle {$invoice->invoice_number}"];

        return $this->accountingService->createVoucher([
            'voucher_type' => 'receipt',
            'voucher_date' => $payment->payment_date,
            'description' => "Payment {$payment->payment_number} for {$invoice->invoice_number}",
            'branch_id' => $payment->branch_id,
            'financial_year_id' => $payment->financial_year_id,
            'created_by' => $payment->created_by,
        ], $entries, true);
    }

    private function resolve(string $name)
    {
        return ChartOfAccount::whereRaw('LOWER(account_name) = ?', [strtolower($name)])->first();
    }
}
