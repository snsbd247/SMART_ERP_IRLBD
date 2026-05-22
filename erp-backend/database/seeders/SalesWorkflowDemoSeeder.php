<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Carbon\Carbon;

/**
 * Idempotent demo seed for the Bangladesh VAT sales workflow.
 *
 * Creates (if missing):
 *  - 1 demo customer (Acme Traders Ltd) with BIN
 *  - 2 demo products (cement bag, steel rod) with 15% VAT
 *  - 1 sample Purchase Order with 2 line items
 *
 * Safe to re-run: looks up by name / po_number before inserting.
 * Run with:  php artisan db:seed --class=SalesWorkflowDemoSeeder
 */
class SalesWorkflowDemoSeeder extends Seeder
{
    public function run(): void
    {
        $today = Carbon::now()->toDateString();

        // ---- Customer ----
        $customerId = DB::table('customers')->where('name', 'Acme Traders Ltd (Demo)')->value('id');
        if (! $customerId) {
            $customerId = (string) Str::uuid();
            DB::table('customers')->insert([
                'id'         => $customerId,
                'name'       => 'Acme Traders Ltd (Demo)',
                'phone'      => '+8801700000000',
                'email'      => 'demo@acme.test',
                'address'    => 'Dhaka, Bangladesh',
                'bin'        => '000123456-0101',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // ---- Products ----
        $productIds = [];
        foreach ([
            ['Demo Cement Bag (50kg)', 'DEMO-CEM-50', 520.00, 15],
            ['Demo Steel Rod 12mm',   'DEMO-STL-12', 95.00,  15],
        ] as [$name, $sku, $rate, $vat]) {
            $pid = DB::table('products')->where('sku', $sku)->value('id');
            if (! $pid) {
                $pid = (string) Str::uuid();
                DB::table('products')->insert([
                    'id'         => $pid,
                    'name'       => $name,
                    'sku'        => $sku,
                    'unit'       => 'pc',
                    'sale_price' => $rate,
                    'vat_pct'    => $vat,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
            $productIds[] = ['id' => $pid, 'rate' => $rate, 'vat' => $vat];
        }

        // ---- Purchase Order ----
        $poNumber = 'PO-DEMO-0001';
        $existing = DB::table('purchase_orders')->where('po_number', $poNumber)->first();
        if ($existing) {
            $this->command?->info("Demo PO {$poNumber} already exists — skipping.");
            return;
        }

        $poId = (string) Str::uuid();
        $qty1 = 100; $qty2 = 50;
        $sub1 = $qty1 * $productIds[0]['rate'];
        $vat1 = $sub1 * $productIds[0]['vat'] / 100;
        $sub2 = $qty2 * $productIds[1]['rate'];
        $vat2 = $sub2 * $productIds[1]['vat'] / 100;
        $subtotal = $sub1 + $sub2;
        $vatAmt   = $vat1 + $vat2;

        DB::table('purchase_orders')->insert([
            'id'           => $poId,
            'po_number'    => $poNumber,
            'po_date'      => $today,
            'customer_id'  => $customerId,
            'delivery_date'=> $today,
            'status'       => 'open',
            'subtotal'     => $subtotal,
            'vat_amount'   => $vatAmt,
            'grand_total'  => $subtotal + $vatAmt,
            'notes'        => 'Auto-generated demo PO for smoke testing.',
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        foreach ([
            [$productIds[0], $qty1, $sub1, $vat1],
            [$productIds[1], $qty2, $sub2, $vat2],
        ] as $i => [$p, $qty, $sub, $vat]) {
            DB::table('purchase_order_items')->insert([
                'id'            => (string) Str::uuid(),
                'po_id'         => $poId,
                'product_id'    => $p['id'],
                'qty_ordered'   => $qty,
                'qty_delivered' => 0,
                'qty_remaining' => $qty,
                'rate'          => $p['rate'],
                'vat_pct'       => $p['vat'],
                'line_subtotal' => $sub,
                'line_vat'      => $vat,
                'line_total'    => $sub + $vat,
                'sort_order'    => $i,
            ]);
        }

        $this->command?->info("Seeded demo PO {$poNumber} for customer Acme Traders Ltd.");
    }
}
