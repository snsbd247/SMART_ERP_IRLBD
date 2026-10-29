<?php

namespace App\Services;

use App\Models\SalesInvoiceV2;
use App\Models\SalesInvoiceItemV2;
use App\Models\VatChallan;
use App\Models\DeliveryChallan;
use App\Models\InvoiceStatusLog;
use App\Models\FinancialYear;
use Illuminate\Support\Facades\DB;

/**
 * Bangladesh VAT-compliant invoice processing.
 * Supports 3 modes:
 *   - single    : one VAT challan -> one invoice
 *   - same_day  : multiple same-day VAT challans (same customer) -> one invoice
 *   - custom    : arbitrary set of VAT challans (same customer) -> one invoice
 *
 * Eligibility: all delivery challans linked to selected VAT challans must be
 * 'ho_received' (or already invoiced=false). Customer must match across.
 */
class InvoiceProcessingService
{
    public function __construct(
        private NumberSequenceService $seq,
        private AccountingService $accountingService,
        private FinancialPeriodGuard $period,
    ) {}

    public function create(array $data, array $vatChallanIds, string $mode = 'custom'): SalesInvoiceV2
    {
        $this->period->assertOpen($data['invoice_date'] ?? null, 'Invoice');

        if (empty($vatChallanIds)) {
            throw new \InvalidArgumentException('No VAT challans selected for invoicing.');
        }

        $challans = VatChallan::with('items', 'deliveryChallans')->whereIn('id', $vatChallanIds)->get();
        if ($challans->count() !== count($vatChallanIds)) {
            throw new \InvalidArgumentException('One or more VAT challans not found.');
        }

        // Validate same customer
        $custIds = $challans->pluck('customer_id')->unique();
        if ($custIds->count() > 1) {
            throw new \InvalidArgumentException('Selected VAT challans belong to different customers.');
        }
        $customerId = $custIds->first();

        // Validate eligibility: every DC must be ho_received and not invoiced
        foreach ($challans as $c) {
            foreach ($c->deliveryChallans as $dc) {
                if ($dc->status === 'invoiced') {
                    throw new \InvalidArgumentException("Challan {$c->challan_number} already invoiced.");
                }
                if ($dc->status !== 'ho_received') {
                    throw new \InvalidArgumentException("Delivery challan {$dc->dc_number} not yet HO-received (status: {$dc->status}).");
                }
            }
        }

        $invoiceDate = $data['invoice_date'] ?? now()->toDateString();
        $fy = FinancialYear::where('start_date', '<=', $invoiceDate)
            ->where('end_date', '>=', $invoiceDate)->where('is_active', 1)->first();
        if (!$fy) throw new \RuntimeException("No active financial year for {$invoiceDate}");

        return DB::transaction(function () use ($data, $challans, $customerId, $mode, $invoiceDate, $fy) {
            // Aggregate items across challans
            $subtotal = 0; $vatTotal = 0;
            foreach ($challans as $c) {
                $subtotal += $c->subtotal;
                $vatTotal += $c->vat_amount;
            }
            $grand = $subtotal + $vatTotal;

            $invoice = SalesInvoiceV2::create([
                'invoice_number' => $this->seq->next('sales_invoice_v2'),
                'invoice_date' => $invoiceDate,
                'customer_id' => $customerId,
                'mode' => $mode,
                'subtotal' => $subtotal,
                'vat_total' => $vatTotal,
                'grand_total' => $grand,
                'due_amount' => $grand,
                'status' => 'posted',
                'branch_id' => $data['branch_id'] ?? null,
                'financial_year_id' => $fy->id,
                'created_by' => $data['user_id'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]);

            // Copy items
            $sort = 0;
            foreach ($challans as $c) {
                foreach ($c->items as $vci) {
                    SalesInvoiceItemV2::create([
                        'invoice_id' => $invoice->id,
                        'product_id' => $vci->product_id,
                        'qty' => $vci->qty,
                        'rate' => $vci->rate,
                        'vat_pct' => $vci->vat_pct,
                        'line_subtotal' => $vci->line_subtotal,
                        'vat_amount' => $vci->vat_amount,
                        'line_total' => $vci->line_total,
                        'source_vat_challan_item_id' => $vci->id,
                        'sort_order' => $sort++,
                    ]);
                }
                DB::table('invoice_challans')->insert([
                    'id' => (string) \Illuminate\Support\Str::uuid(),
                    'invoice_id' => $invoice->id,
                    'vat_challan_id' => $c->id,
                    'created_at' => now(),
                ]);
                // mark all DCs invoiced
                DeliveryChallan::where('vat_challan_id', $c->id)->update(['status' => 'invoiced']);
                $c->update(['status' => 'invoiced']);
            }

            // Voucher posting: DR AR, CR Sales, CR VAT Payable
            $voucher = $this->postSalesVoucher($invoice);
            if ($voucher) $invoice->update(['voucher_id' => $voucher->id]);

            InvoiceStatusLog::create([
                'invoice_id' => $invoice->id, 'new_status' => 'posted',
                'changed_by' => $data['user_id'] ?? null,
                'notes' => "Consolidated from " . $challans->count() . " VAT challan(s) [mode={$mode}]",
            ]);

            return $invoice->load('items', 'challans');
        });
    }

    private function postSalesVoucher(SalesInvoiceV2 $invoice)
    {
        $ar = $this->resolveAccount('Accounts Receivable');
        $sales = $this->resolveAccount('Sales Revenue') ?: $this->resolveAccount('Sales');
        $vat = $this->resolveAccount('VAT Payable');
        if (!$ar || !$sales || !$vat) return null;

        $entries = [
            ['account_id' => $ar->id,    'debit' => $invoice->grand_total, 'credit' => 0, 'narration' => "Invoice {$invoice->invoice_number}"],
            ['account_id' => $sales->id, 'debit' => 0, 'credit' => $invoice->subtotal,   'narration' => "Sales {$invoice->invoice_number}"],
        ];
        if ($invoice->vat_total > 0) {
            $entries[] = ['account_id' => $vat->id, 'debit' => 0, 'credit' => $invoice->vat_total, 'narration' => "VAT on {$invoice->invoice_number}"];
        }
        return $this->accountingService->createVoucher([
            'voucher_type' => 'journal',
            'voucher_date' => $invoice->invoice_date,
            'description' => "Sales Invoice {$invoice->invoice_number}",
            'branch_id' => $invoice->branch_id,
            'financial_year_id' => $invoice->financial_year_id,
            'created_by' => $invoice->created_by,
        ], $entries, true);
    }

    private function resolveAccount(string $name)
    {
        return \App\Models\ChartOfAccount::whereRaw('LOWER(account_name) = ?', [strtolower($name)])->first();
    }
}
