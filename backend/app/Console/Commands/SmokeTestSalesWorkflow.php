<?php

namespace App\Console\Commands;

use App\Services\VatChallanService;
use App\Services\InvoiceProcessingService;
use App\Services\InvoicePaymentService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

/**
 * End-to-end smoke test for the Bangladesh VAT sales workflow.
 *
 *   php artisan sales-workflow:smoke
 *
 * Walks the demo PO through every stage and prints a status table.
 * Requires the SalesWorkflowDemoSeeder to have been run first.
 */
class SmokeTestSalesWorkflow extends Command
{
    protected $signature = 'sales-workflow:smoke {--cleanup : Delete the generated challan/invoice afterwards}';
    protected $description = 'Smoke-test PO → VAT Challan → DC → Receive → Invoice → Payment loop';

    public function handle(
        VatChallanService $vatSvc,
        InvoiceProcessingService $invSvc,
        InvoicePaymentService $paySvc,
    ): int {
        $po = DB::table('purchase_orders')->where('po_number', 'PO-DEMO-0001')->first();
        if (! $po) {
            $this->error('Demo PO not found. Run: php artisan db:seed --class=SalesWorkflowDemoSeeder');
            return self::FAILURE;
        }

        $items = DB::table('purchase_order_items')->where('po_id', $po->id)->get();
        $this->info("PO {$po->po_number} found with {$items->count()} items, grand_total={$po->grand_total}");

        $today = Carbon::now()->toDateString();

        // 1. VAT Challan against PO (full remaining qty)
        $this->line('→ Issuing VAT challan (Mushak 6.3)...');
        $vat = $vatSvc->create([
            'challan_date' => $today,
            'customer_id' => $po->customer_id,
            'purchase_order_id' => $po->id,
            'vehicle_no' => 'DHK-METRO-DEMO-01',
            'driver_name' => 'Demo Driver',
        ], $items->map(fn ($it) => [
            'product_id' => $it->product_id,
            'purchase_order_item_id' => $it->id,
            'qty' => (float) $it->qty_remaining,
            'rate' => (float) $it->rate,
            'vat_pct' => (float) $it->vat_pct,
        ])->all());
        $this->info("  ✓ VAT Challan {$vat->challan_number} (grand_total={$vat->grand_total})");

        // 2. Delivery challans auto-created by VAT challan service — verify
        $dcs = DB::table('delivery_challans')->where('vat_challan_id', $vat->id)->get();
        $this->info("  ✓ {$dcs->count()} delivery challan rows generated");

        // 3. Customer receive + HO receive on each DC
        foreach ($dcs as $dc) {
            DB::table('customer_receives')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'delivery_challan_id' => $dc->id,
                'receive_date' => $today,
                'received_by_name' => 'Smoke Test',
                'created_at' => now(),
            ]);
            DB::table('delivery_challans')->where('id', $dc->id)->update(['status' => 'customer_received']);
            DB::table('ho_receives')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'delivery_challan_id' => $dc->id,
                'ho_receive_date' => $today,
                'created_at' => now(),
            ]);
            DB::table('delivery_challans')->where('id', $dc->id)->update(['status' => 'ho_received']);
        }
        $this->info('  ✓ All DCs marked HO-received');

        // 4. Generate invoice from ready VAT challan
        $this->line('→ Generating invoice...');
        $invoice = $invSvc->create(['invoice_date' => $today], [$vat->id], 'single');
        $this->info("  ✓ Invoice {$invoice->invoice_number} (grand_total={$invoice->grand_total})");

        // 5. Record payment with 5% TDS
        $tds = round($invoice->grand_total * 0.05, 2);
        $cash = round($invoice->grand_total - $tds, 2);
        $this->line("→ Recording payment (cash={$cash}, TDS={$tds})...");
        $paySvc->recordPayment([
            'invoice_id' => $invoice->id,
            'payment_date' => $today,
            'mode'         => 'bank',
            'reference'    => 'SMOKE-TXN-001',
            'amount_received' => $cash,
            'tds_amount'   => $tds,
        ]);

        $invoice->refresh();
        $this->info("  ✓ Payment posted. Invoice status={$invoice->status}, paid={$invoice->paid_amount}, tds={$invoice->tds_amount}");

        $this->newLine();
        $this->table(
            ['Stage', 'Reference', 'Amount'],
            [
                ['Purchase Order', $po->po_number, $po->grand_total],
                ['VAT Challan',    $vat->challan_number, $vat->grand_total],
                ['Delivery',       $dcs->count() . ' DCs', '—'],
                ['Invoice',        $invoice->invoice_number, $invoice->grand_total],
                ['Paid',           'cash + TDS', $cash . ' + ' . $tds],
                ['Status',         $invoice->status, ''],
            ]
        );

        if ($this->option('cleanup')) {
            DB::table('invoice_payments')->where('invoice_id', $invoice->id)->delete();
            DB::table('sales_invoices_v2')->where('id', $invoice->id)->delete();
            DB::table('ho_receives')->whereIn('delivery_challan_id', $dcs->pluck('id'))->delete();
            DB::table('customer_receives')->whereIn('delivery_challan_id', $dcs->pluck('id'))->delete();
            DB::table('delivery_challans')->where('vat_challan_id', $vat->id)->delete();
            DB::table('vat_challan_items')->where('vat_challan_id', $vat->id)->delete();
            DB::table('vat_challans')->where('id', $vat->id)->delete();
            // Restore PO remaining qty
            foreach ($items as $it) {
                DB::table('purchase_order_items')->where('id', $it->id)->update([
                    'qty_delivered' => 0,
                    'qty_remaining' => $it->qty_ordered,
                ]);
            }
            DB::table('purchase_orders')->where('id', $po->id)->update(['status' => 'open']);
            $this->warn('Cleanup complete — demo PO reset to open.');
        }

        $this->info('✅ Smoke test passed.');
        return self::SUCCESS;
    }
}
