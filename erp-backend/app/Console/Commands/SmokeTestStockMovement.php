<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SmokeTestStockMovement extends Command
{
    protected $signature = 'stock:smoke';
    protected $description = 'Smoke test: stock ledger integrity across receipt, transfer & sale';

    public function handle(): int
    {
        $this->info('=== Test #4: Stock Movement ===');

        $itemId = DB::table('item_master')->where('item_code', 'DEMO-PROD-A')->value('id');
        if (!$itemId) { $this->error('Item DEMO-PROD-A missing. Run sales:smoke first.'); return 1; }

        // Pick two warehouses (create dest if only one exists)
        $wh = DB::table('warehouses')->where('is_active', 1)->limit(2)->get();
        if ($wh->count() < 1) { $this->error('No warehouses found.'); return 1; }
        $src = $wh[0];
        $dst = $wh->get(1);
        if (!$dst) {
            $dstId = (string) Str::uuid();
            DB::table('warehouses')->insert([
                'id' => $dstId, 'name' => 'Demo WH-B', 'code' => 'WH-B-' . substr(uniqid(), -4),
                'branch_id' => $src->branch_id, 'is_active' => 1, 'status' => 'active',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $dst = DB::table('warehouses')->where('id', $dstId)->first();
        }

        $today = now()->toDateString();
        $ref = 'STK-SMK-' . substr(uniqid(), -6);

        // 1) Receipt +100 @ src
        $baseBal = (float) (DB::table('stock_ledger')->where('item_id', $itemId)->where('warehouse_id', $src->id)
            ->orderByDesc('created_at')->value('balance_quantity') ?? 0);

        DB::table('stock_ledger')->insert([
            'id' => (string) Str::uuid(), 'transaction_type' => 'RECEIPT', 'item_id' => $itemId,
            'branch_id' => $src->branch_id, 'warehouse_id' => $src->id,
            'quantity_in' => 100, 'quantity_out' => 0, 'balance_quantity' => $baseBal + 100,
            'unit_cost' => 200, 'total_value' => 20000,
            'reference_number' => $ref, 'transaction_date' => $today,
        ]);

        // 2) Transfer 30 src→dst
        $srcAfter = $baseBal + 100 - 30;
        $dstBase = (float) (DB::table('stock_ledger')->where('item_id', $itemId)->where('warehouse_id', $dst->id)
            ->orderByDesc('created_at')->value('balance_quantity') ?? 0);
        $dstAfter = $dstBase + 30;

        DB::table('stock_transfers')->insert([
            'id' => (string) Str::uuid(), 'transfer_number' => 'TRF-SMK-' . substr(uniqid(), -6),
            'transfer_date' => $today, 'from_warehouse_id' => $src->id, 'to_warehouse_id' => $dst->id,
            'item_id' => $itemId, 'quantity' => 30, 'status' => 'completed',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('stock_ledger')->insert([
            ['id' => (string) Str::uuid(), 'transaction_type' => 'TRANSFER_OUT', 'item_id' => $itemId,
             'branch_id' => $src->branch_id, 'warehouse_id' => $src->id,
             'quantity_in' => 0, 'quantity_out' => 30, 'balance_quantity' => $srcAfter,
             'unit_cost' => 200, 'total_value' => 6000, 'reference_number' => $ref, 'transaction_date' => $today],
            ['id' => (string) Str::uuid(), 'transaction_type' => 'TRANSFER_IN', 'item_id' => $itemId,
             'branch_id' => $dst->branch_id, 'warehouse_id' => $dst->id,
             'quantity_in' => 30, 'quantity_out' => 0, 'balance_quantity' => $dstAfter,
             'unit_cost' => 200, 'total_value' => 6000, 'reference_number' => $ref, 'transaction_date' => $today],
        ]);

        // 3) Sale -20 from src
        $srcFinal = $srcAfter - 20;
        DB::table('stock_ledger')->insert([
            'id' => (string) Str::uuid(), 'transaction_type' => 'SALE', 'item_id' => $itemId,
            'branch_id' => $src->branch_id, 'warehouse_id' => $src->id,
            'quantity_in' => 0, 'quantity_out' => 20, 'balance_quantity' => $srcFinal,
            'unit_cost' => 200, 'total_value' => 4000,
            'reference_number' => $ref, 'transaction_date' => $today,
        ]);

        // Verify
        $srcLatest = (float) DB::table('stock_ledger')->where('item_id', $itemId)->where('warehouse_id', $src->id)
            ->orderByDesc('created_at')->value('balance_quantity');
        $dstLatest = (float) DB::table('stock_ledger')->where('item_id', $itemId)->where('warehouse_id', $dst->id)
            ->orderByDesc('created_at')->value('balance_quantity');

        $expectSrc = $baseBal + 100 - 30 - 20;
        $expectDst = $dstBase + 30;
        $okSrc = abs($srcLatest - $expectSrc) < 0.01;
        $okDst = abs($dstLatest - $expectDst) < 0.01;

        $this->table(['Warehouse', 'Expected', 'Actual', 'OK'], [
            [$src->name, $expectSrc, $srcLatest, $okSrc ? '✅' : '❌'],
            [$dst->name, $expectDst, $dstLatest, $okDst ? '✅' : '❌'],
        ]);
        if ($okSrc && $okDst) { $this->info('✅ Stock movement smoke PASS'); return 0; }
        $this->error('❌ Stock movement smoke FAIL'); return 1;
    }
}
