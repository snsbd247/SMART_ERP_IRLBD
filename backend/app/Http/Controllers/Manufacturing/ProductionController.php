<?php

namespace App\Http\Controllers\Manufacturing;

use App\Http\Controllers\BaseController;
use App\Models\AuditLog;
use App\Models\ProductionEntry;
use App\Models\ProductionMaterial;
use App\Services\ManufacturingService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProductionController extends BaseController
{
    public function index(Request $request)
    {
        $query = ProductionEntry::with(['product', 'bom', 'materials.material']);
        if ($request->status) $query->where('status', $request->status);
        if ($request->from) $query->where('production_date', '>=', $request->from);
        if ($request->to) $query->where('production_date', '<=', $request->to);
        return $this->success($query->orderByDesc('production_date')->paginate($request->per_page ?? 50));
    }

    public function show($id)
    {
        $entry = ProductionEntry::with(['product', 'bom.items.material', 'materials.material'])->findOrFail($id);
        return $this->success($entry);
    }

    public function store(Request $request)
    {
        $request->validate([
            'production_date' => 'required|date',
            'product_id' => 'required|uuid|exists:item_master,id',
            'bom_id' => 'nullable|uuid|exists:bill_of_materials,id',
            'quantity' => 'required|numeric|min:0.01',
            'materials' => 'required|array|min:1',
            'materials.*.material_id' => 'required|uuid|exists:item_master,id',
            'materials.*.quantity' => 'required|numeric|min:0',
            'materials.*.cost' => 'required|numeric|min:0',
        ]);

        $service = app(ManufacturingService::class);
        $entry = $service->createProduction($request->all());

        return $this->success($entry->load(['product', 'materials.material']), 'Production entry created', 201);
    }

    public function complete($id)
    {
        $service = app(ManufacturingService::class);
        $entry = $service->completeProduction($id);
        return $this->success($entry, 'Production completed');
    }

    public function destroy($id)
    {
        $entry = ProductionEntry::findOrFail($id);
        if ($entry->status === 'completed') {
            return $this->error('Cannot delete completed production entry', 422);
        }
        $entry->delete();
        return $this->success(null, 'Production entry deleted');
    }

    /**
     * Soft cancel. Mirrors VoucherController::deleteApproved()'s conservative
     * "mark + audit log" pattern: if this entry was already completed,
     * complete() already deducted raw materials and added the finished
     * product to stock via StockService::adjustStock() — those movements are
     * NOT reversed here, since no reversal helper exists yet for
     * raw-material consumption in this codebase.
     */
    public function cancel(Request $request, string $id)
    {
        $entry = ProductionEntry::findOrFail($id);
        if ($entry->status === 'cancelled') {
            return $this->error('Already cancelled', 422);
        }
        if ($entry->status === 'deleted') {
            return $this->error('Cannot cancel a deleted production entry', 422);
        }
        $oldStatus = $entry->status;
        $entry->update(['status' => 'cancelled']);
        $this->logAudit($request, 'cancel', $entry, [
            'old_status' => $oldStatus,
            'reason' => $request->input('reason'),
        ]);
        return $this->success($entry->fresh());
    }

    /**
     * Super-Admin-only re-edit of an already-completed production entry.
     * Only header/cost fields are editable — quantity, product, BOM and
     * materials are intentionally left untouched because they are tied to
     * the raw-material consumption + finished-goods stock movements already
     * posted by complete(); recalculating those needs stock-reversal logic
     * that doesn't exist elsewhere in this codebase.
     */
    public function editApproved(Request $request, string $id)
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admin can edit a completed production entry', 403);
        }
        $entry = ProductionEntry::findOrFail($id);
        if ($entry->status !== 'completed') {
            return $this->error('Production entry is not completed', 422);
        }
        $data = $request->validate([
            'production_date'  => 'nullable|date',
            'labor_cost'       => 'nullable|numeric|min:0',
            'electricity_cost' => 'nullable|numeric|min:0',
            'notes'            => 'nullable|string',
        ]);

        return DB::transaction(function () use ($request, $entry, $data) {
            if (array_key_exists('production_date', $data) && $data['production_date'] !== null) {
                $entry->production_date = $data['production_date'];
            }
            if (array_key_exists('labor_cost', $data) && $data['labor_cost'] !== null) {
                $entry->labor_cost = $data['labor_cost'];
            }
            if (array_key_exists('electricity_cost', $data) && $data['electricity_cost'] !== null) {
                $entry->electricity_cost = $data['electricity_cost'];
            }
            if (array_key_exists('notes', $data)) {
                $entry->notes = $data['notes'];
            }
            $entry->total_cost = (float) $entry->raw_material_cost + (float) $entry->labor_cost + (float) $entry->electricity_cost;
            $entry->save();
            $this->logAudit($request, 'edit_approved', $entry);
            return $this->success($entry->fresh(['product', 'materials.material']));
        });
    }

    /**
     * Soft "delete" of a production entry. production_entries has no
     * deleted_at/deleted_by/prev_status columns (unlike acc_vouchers), so —
     * same spirit as VoucherController::deleteApproved() — the previous
     * status and who/when/why is captured in audit_log rather than dedicated
     * columns. Stock effects from complete() (if any) are NOT reversed
     * automatically.
     */
    public function deleteApproved(Request $request, string $id)
    {
        $entry = ProductionEntry::findOrFail($id);
        if ($entry->status === 'deleted') {
            return $this->error('Production entry already deleted', 422);
        }
        $oldStatus = $entry->status;
        $entry->update(['status' => 'deleted']);
        $this->logAudit($request, 'delete_approved', $entry, [
            'old_status' => $oldStatus,
            'reason' => $request->input('reason'),
        ]);
        return $this->success(['deleted' => true, 'id' => $entry->id]);
    }

    private function logAudit(Request $request, string $action, ProductionEntry $entry, array $extra = []): void
    {
        try {
            AuditLog::create([
                'user_id'    => optional($request->user())->id,
                'user_name'  => optional($request->user())->name,
                'module'     => 'manufacturing_production',
                'action'     => $action,
                'record_id'  => $entry->id,
                'details'    => json_encode(array_merge([
                    'production_number' => $entry->production_number,
                    'status' => $entry->status,
                ], $extra)),
                'new_data'   => ['status' => $entry->status],
                'ip_address' => $request->ip(),
                'user_agent' => substr((string) $request->userAgent(), 0, 250),
            ]);
        } catch (\Throwable $e) {
            \Log::warning('audit_log insert failed (production): ' . $e->getMessage());
        }
    }
}
