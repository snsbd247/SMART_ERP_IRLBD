<?php
namespace App\Http\Controllers\Inventory;

use App\Http\Controllers\BaseController;
use App\Services\AccountingService;
use App\Services\FinancialPeriodGuard;
use App\Services\NumberSequenceService;
use App\Services\StockService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Stock Adjustments API — Safe Extension (additive).
 * Backs the generic `stock_adjustments` table without touching existing direct-supabase paths.
 * On approve: writes a stock_movement (±qty) and posts a balanced journal voucher.
 */
class StockAdjustmentController extends BaseController
{
    public function __construct(
        private NumberSequenceService $seq,
        private AccountingService $acct,
        private StockService $stock,
        private FinancialPeriodGuard $period,
    ) {}

    public function index(Request $r)
    {
        $q = DB::table('stock_adjustments')->orderByDesc('created_at');
        if ($r->branch_id) $q->where('branch_id', $r->branch_id);
        if ($r->from) $q->where('adjustment_date', '>=', $r->from);
        if ($r->to)   $q->where('adjustment_date', '<=', $r->to);
        if ($r->status) $q->where('status', $r->status);
        return $this->success($q->paginate($r->per_page ?? 25));
    }

    public function show(string $id)
    {
        $row = DB::table('stock_adjustments')->where('id', $id)->first();
        if (!$row) return $this->error('Not found', 404);
        return $this->success($row);
    }

    public function store(Request $r)
    {
        $r->validate([
            'adjustment_date' => 'required|date',
            'adjustment_type' => 'required|in:increase,decrease',
            'product_id'      => 'required|exists:item_master,id',
            'quantity'        => 'required|numeric|min:0.01',
            'unit_cost'       => 'nullable|numeric|min:0',
        ]);

        // Try to allocate a number from sequence; gracefully fall back to ad-hoc number.
        try { $number = $this->seq->next('stock_adjustment'); }
        catch (\Throwable $e) { $number = 'ADJ-' . date('y') . '-' . substr((string) microtime(true), -5); }

        $id = (string) \Illuminate\Support\Str::uuid();
        DB::table('stock_adjustments')->insert([
            'id' => $id,
            'adjustment_number' => $number,
            'adjustment_date'   => $r->adjustment_date,
            'adjustment_type'   => $r->adjustment_type,
            'product_id'        => $r->product_id,
            'warehouse_id'      => $r->warehouse_id,
            'branch_id'         => $r->branch_id,
            'quantity'          => $r->quantity,
            'unit_cost'         => $r->unit_cost ?? 0,
            'total_value'       => (float) $r->quantity * (float) ($r->unit_cost ?? 0),
            'reason'            => $r->reason,
            'notes'             => $r->notes,
            'status'            => 'draft',
            'created_by'        => $r->user()->id,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        return $this->created(DB::table('stock_adjustments')->where('id', $id)->first());
    }

    public function destroy(string $id)
    {
        $row = DB::table('stock_adjustments')->where('id', $id)->first();
        if (!$row) return $this->error('Not found', 404);
        if (($row->status ?? 'draft') === 'posted') return $this->error('Posted adjustments cannot be deleted', 422);
        DB::table('stock_adjustments')->where('id', $id)->delete();
        return $this->success(['deleted' => true]);
    }

    public function approve(Request $r, string $id)
    {
        $row = DB::table('stock_adjustments')->where('id', $id)->first();
        if (!$row) return $this->error('Not found', 404);
        if (($row->status ?? 'draft') === 'posted') return $this->error('Already posted', 422);

        DB::transaction(function () use ($row, $r) {
            $multiplier = $row->adjustment_type === 'increase' ? +1 : -1;
            $this->stock->createBulkMovements(
                [['product_id' => $row->product_id, 'quantity' => $row->quantity]],
                'adjustment',
                'stock_adjustment',
                $row->id,
                $row->branch_id,
                $multiplier,
            );

            $debit  = $row->adjustment_type === 'increase' ? 'Inventory' : 'Stock Adjustment';
            $credit = $row->adjustment_type === 'increase' ? 'Stock Adjustment' : 'Inventory';
            $this->acct->autoPost(
                $debit, $credit,
                (float) $row->total_value,
                "Stock Adjustment {$row->adjustment_number} (" . ucfirst($row->adjustment_type) . ')',
                'journal',
                ['date' => $row->adjustment_date, 'branch_id' => $row->branch_id, 'user_id' => $r->user()->id],
            );

            DB::table('stock_adjustments')->where('id', $row->id)->update([
                'status' => 'posted', 'updated_at' => now(),
            ]);
        });

        return $this->success(DB::table('stock_adjustments')->where('id', $id)->first());
    }
}
