<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Carbon\Carbon;

/**
 * Purchase-to-Pay cycle smoke test (Purchase Workflow v2).
 *
 *   php artisan purchase-cycle:smoke
 *
 * Flow:
 *   1. Supplier + Item ensured
 *   2. PO v2 (50 units @ ৳200 + 15% VAT = ৳11,500)
 *   3. GRN: receive 50 units → stock_ledger +50
 *   4. Supplier Bill ৳11,500 → balance_due 11,500
 *   5. Supplier Payment ৳7,000 + allocation → bill paid=7000, balance=4500
 *
 * Verifies: stock balance, bill paid_amount, allocation total, supplier outstanding.
 */
class SmokeTestPurchaseCycle extends Command
{
    protected $signature = 'purchase-cycle:smoke {--cleanup}';
    protected $description = 'PO → GRN → Bill → Payment → Stock + Payable integrity';

    public function handle(): int
    {
        $today = Carbon::now()->toDateString();

        // 1. Supplier
        $supplier = DB::table('suppliers')->where('name', 'Demo Supplier Ltd')->first();
        if (! $supplier) {
            $supplierId = (string) Str::uuid();
            DB::table('suppliers')->insert([
                'id' => $supplierId,
                'name' => 'Demo Supplier Ltd',
                'email' => 'demo@supplier.test',
                'phone' => '01800000000',
                'address' => 'Dhaka',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } else {
            $supplierId = $supplier->id;
        }
        $this->info("Supplier: Demo Supplier Ltd ({$supplierId})");

        // 2. Item (reuse Demo Product A from item_master)
        $item = DB::table('item_master')->where('item_code', 'DEMO-PROD-A')->first();
        if (! $item) {
            $this->error('item_master "DEMO-PROD-A" not found. Run SalesWorkflowDemoSeeder first.');
            return self::FAILURE;
        }
        $itemId = $item->id;

        // Snapshot starting stock balance
        $startBalance = (float) DB::table('stock_ledger')
            ->where('item_id', $itemId)
            ->orderByDesc('created_at')
            ->value('balance_quantity') ?? 0;
        $this->info("Starting stock balance for DEMO-PROD-A: {$startBalance}");

        $qty = 50; $rate = 200; $subtotal = $qty * $rate; $vat = $subtotal * 0.15; $total = $subtotal + $vat;

        // 3. PO v2
        $poId = (string) Str::uuid();
        $poNo = 'PO2-DEMO-' . substr(uniqid(), -6);
        DB::table('purchase_orders_v2')->insert([
            'id' => $poId,
            'po_number' => $poNo,
            'po_date' => $today,
            'supplier_id' => $supplierId,
            'currency' => 'BDT',
            'exchange_rate' => 1,
            'subtotal' => $subtotal,
            'vat_amount' => $vat,
            'grand_total' => $total,
            'status' => 'Approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $poItemId = (string) Str::uuid();
        DB::table('purchase_order_items_v2')->insert([
            'id' => $poItemId,
            'po_id' => $poId,
            'line_no' => 1,
            'item_id' => $itemId,
            'item_description' => 'Demo Product A',
            'quantity' => $qty,
            'unit_price' => $rate,
            'vat_percent' => 15,
            'line_total' => $total,
            'received_qty' => 0,
            'billed_qty' => 0,
        ]);
        $this->info("  ✓ PO {$poNo} (qty {$qty} @ ৳{$rate}, grand_total ৳{$total})");

        // 4. GRN
        $grnId = (string) Str::uuid();
        $grnNo = 'GRN-DEMO-' . substr(uniqid(), -6);
        DB::table('grns_v2')->insert([
            'id' => $grnId,
            'grn_no' => $grnNo,
            'grn_date' => $today,
            'po_id' => $poId,
            'supplier_id' => $supplierId,
            'subtotal' => $subtotal,
            'grand_total' => $total,
            'status' => 'Posted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('grn_items_v2')->insert([
            'id' => (string) Str::uuid(),
            'grn_id' => $grnId,
            'po_item_id' => $poItemId,
            'line_no' => 1,
            'item_id' => $itemId,
            'item_description' => 'Demo Product A',
            'ordered_qty' => $qty,
            'received_qty' => $qty,
            'accepted_qty' => $qty,
            'unit_cost' => $rate,
            'line_value' => $subtotal,
        ]);
        DB::table('purchase_order_items_v2')->where('id', $poItemId)->update(['received_qty' => $qty]);

        // Stock ledger entry
        $newBalance = $startBalance + $qty;
        DB::table('stock_ledger')->insert([
            'id' => (string) Str::uuid(),
            'transaction_type' => 'grn',
            'transaction_id' => $grnId,
            'item_id' => $itemId,
            'quantity_in' => $qty,
            'quantity_out' => 0,
            'balance_quantity' => $newBalance,
            'unit_cost' => $rate,
            'total_value' => $subtotal,
            'reference_number' => $grnNo,
            'transaction_date' => $today,
        ]);
        $this->info("  ✓ GRN {$grnNo} received {$qty} units → stock balance {$newBalance}");

        // 5. Supplier Bill
        $billId = (string) Str::uuid();
        $billNo = 'BILL-DEMO-' . substr(uniqid(), -6);
        DB::table('supplier_bills_v2')->insert([
            'id' => $billId,
            'bill_no' => $billNo,
            'bill_date' => $today,
            'supplier_id' => $supplierId,
            'subtotal' => $subtotal,
            'vat_amount' => $vat,
            'grand_total' => $total,
            'paid_amount' => 0,
            'balance_due' => $total,
            'status' => 'Posted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('supplier_bill_items_v2')->insert([
            'id' => (string) Str::uuid(),
            'bill_id' => $billId,
            'po_item_id' => $poItemId,
            'line_no' => 1,
            'item_id' => $itemId,
            'item_description' => 'Demo Product A',
            'quantity' => $qty,
            'unit_price' => $rate,
            'line_total' => $total,
        ]);
        DB::table('purchase_order_items_v2')->where('id', $poItemId)->update(['billed_qty' => $qty]);
        $this->info("  ✓ Bill {$billNo} ৳{$total} (balance_due ৳{$total})");

        // 6. Payment ৳7000
        $payAmount = 7000;
        $paymentId = (string) Str::uuid();
        $payNo = 'SPAY-DEMO-' . substr(uniqid(), -6);
        DB::table('supplier_payments_v2')->insert([
            'id' => $paymentId,
            'payment_no' => $payNo,
            'payment_date' => $today,
            'supplier_id' => $supplierId,
            'payment_mode' => 'bank',
            'amount' => $payAmount,
            'net_amount' => $payAmount,
            'status' => 'Posted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('supplier_payment_allocations')->insert([
            'id' => (string) Str::uuid(),
            'payment_id' => $paymentId,
            'bill_id' => $billId,
            'allocated_amount' => $payAmount,
        ]);
        DB::table('supplier_bills_v2')->where('id', $billId)->update([
            'paid_amount' => $payAmount,
            'balance_due' => $total - $payAmount,
            'status' => 'PartialPaid',
        ]);
        $this->info("  ✓ Payment {$payNo} ৳{$payAmount} allocated to {$billNo}");

        // ─── Verify ───
        $bill = DB::table('supplier_bills_v2')->where('id', $billId)->first();
        $allocTotal = (float) DB::table('supplier_payment_allocations')->where('bill_id', $billId)->sum('allocated_amount');
        $stockAfter = (float) DB::table('stock_ledger')->where('item_id', $itemId)->orderByDesc('created_at')->value('balance_quantity');
        $supplierOutstanding = (float) DB::table('supplier_bills_v2')->where('supplier_id', $supplierId)->sum('balance_due');

        $checks = [
            ['Stock increased by ' . $qty, $startBalance + $qty, $stockAfter],
            ['Bill paid_amount', 7000.00, (float) $bill->paid_amount],
            ['Bill balance_due', $total - 7000, (float) $bill->balance_due],
            ['Allocation total', 7000.00, $allocTotal],
            ['PO received_qty', $qty, (float) DB::table('purchase_order_items_v2')->where('id', $poItemId)->value('received_qty')],
            ['PO billed_qty', $qty, (float) DB::table('purchase_order_items_v2')->where('id', $poItemId)->value('billed_qty')],
        ];

        $rows = [];
        $pass = true;
        foreach ($checks as [$label, $exp, $act]) {
            $ok = abs($exp - $act) < 0.01;
            $pass = $pass && $ok;
            $rows[] = [$label, $exp, $act, $ok ? '✅' : '❌'];
        }
        $this->newLine();
        $this->table(['Check', 'Expected', 'Actual', 'OK?'], $rows);
        $this->line("Supplier outstanding: ৳" . number_format($supplierOutstanding, 2));
        $this->line($pass ? '<info>✅ Purchase cycle PASS</info>' : '<error>❌ Purchase cycle FAIL</error>');

        if ($this->option('cleanup')) {
            DB::table('supplier_payment_allocations')->where('payment_id', $paymentId)->delete();
            DB::table('supplier_payments_v2')->where('id', $paymentId)->delete();
            DB::table('supplier_bill_items_v2')->where('bill_id', $billId)->delete();
            DB::table('supplier_bills_v2')->where('id', $billId)->delete();
            DB::table('stock_ledger')->where('transaction_id', $grnId)->delete();
            DB::table('grn_items_v2')->where('grn_id', $grnId)->delete();
            DB::table('grns_v2')->where('id', $grnId)->delete();
            DB::table('purchase_order_items_v2')->where('po_id', $poId)->delete();
            DB::table('purchase_orders_v2')->where('id', $poId)->delete();
            $this->warn('Cleanup complete.');
        }

        return $pass ? self::SUCCESS : self::FAILURE;
    }
}
