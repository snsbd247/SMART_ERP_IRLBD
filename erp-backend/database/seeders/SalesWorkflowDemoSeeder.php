<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Seeds a deterministic demo Purchase Order (PO-DEMO-0001) so that
 * `php artisan sales-workflow:smoke` can run end-to-end.
 *
 * Idempotent: re-running resets the PO to its open state.
 */
class SalesWorkflowDemoSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();

        // 1. Demo customer
        $customer = DB::table('customers')->where('name', 'Demo Customer Ltd')->first();
        if (! $customer) {
            $customerId = (string) Str::uuid();
            DB::table('customers')->insert([
                'id' => $customerId,
                'name' => 'Demo Customer Ltd',
                'email' => 'demo@customer.test',
                'phone' => '01700000000',
                'address' => 'Dhaka, Bangladesh',
                'status' => 'active',
                'created_at' => $now,
            ]);
        } else {
            $customerId = $customer->id;
        }

        // 2. Demo items (item_master is the FK target for purchase_order_items.product_id)
        $productIds = [];
        foreach ([
            ['code' => 'DEMO-PROD-A', 'name' => 'Demo Product A', 'rate' => 1000.00],
            ['code' => 'DEMO-PROD-B', 'name' => 'Demo Product B', 'rate' => 500.00],
        ] as $p) {
            $existing = DB::table('item_master')->where('item_code', $p['code'])->first();
            if ($existing) {
                $productIds[] = ['id' => $existing->id, 'rate' => $p['rate']];
                continue;
            }
            $pid = (string) Str::uuid();
            DB::table('item_master')->insert([
                'id' => $pid,
                'item_code' => $p['code'],
                'item_name' => $p['name'],
                'item_type' => 'product',
                'cost_price' => $p['rate'] * 0.7,
                'selling_price' => $p['rate'],
                'opening_stock' => 1000,
                'min_stock_level' => 10,
                'is_stock_item' => 1,
                'status' => 'active',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $productIds[] = ['id' => $pid, 'rate' => $p['rate']];
        }

        // 3. Reset/insert PO-DEMO-0001
        $poNumber = 'PO-DEMO-0001';
        $existingPo = DB::table('purchase_orders')->where('po_number', $poNumber)->first();
        if ($existingPo) {
            // Clean child rows and reset
            DB::table('purchase_order_items')->where('po_id', $existingPo->id)->delete();
            DB::table('po_amendments')->where('po_id', $existingPo->id)->delete();
            $poId = $existingPo->id;
            DB::table('purchase_orders')->where('id', $poId)->update([
                'status' => 'open',
                'po_date' => $now->toDateString(),
                'subtotal' => 0,
                'vat_amount' => 0,
                'grand_total' => 0,
                'updated_at' => $now,
            ]);
        } else {
            $poId = (string) Str::uuid();
            DB::table('purchase_orders')->insert([
                'id' => $poId,
                'po_number' => $poNumber,
                'po_date' => $now->toDateString(),
                'customer_id' => $customerId,
                'delivery_date' => $now->copy()->addDays(7)->toDateString(),
                'status' => 'open',
                'subtotal' => 0,
                'vat_amount' => 0,
                'grand_total' => 0,
                'notes' => 'Demo PO seeded for sales-workflow smoke test',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // 4. PO line items (qty 10 each, VAT 15%)
        $subtotal = 0; $vatTotal = 0;
        $rows = [];
        foreach ($productIds as $idx => $p) {
            $qty = 10;
            $rate = $p['rate'];
            $lineSub = $qty * $rate;
            $vatPct = 15.00;
            $lineVat = round($lineSub * $vatPct / 100, 2);
            $lineTotal = $lineSub + $lineVat;
            $subtotal += $lineSub;
            $vatTotal += $lineVat;
            $rows[] = [
                'id' => (string) Str::uuid(),
                'po_id' => $poId,
                'product_id' => $p['id'],
                'qty_ordered' => $qty,
                'qty_delivered' => 0,
                'qty_remaining' => $qty,
                'rate' => $rate,
                'vat_pct' => $vatPct,
                'line_subtotal' => $lineSub,
                'line_vat' => $lineVat,
                'line_total' => $lineTotal,
                'sort_order' => $idx,
            ];
        }
        DB::table('purchase_order_items')->insert($rows);
        DB::table('purchase_orders')->where('id', $poId)->update([
            'subtotal' => $subtotal,
            'vat_amount' => $vatTotal,
            'grand_total' => $subtotal + $vatTotal,
        ]);

        $this->command?->info("✅ Seeded PO {$poNumber} for customer Demo Customer Ltd (grand_total=" . ($subtotal + $vatTotal) . ")");
    }
}
