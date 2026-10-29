<?php

namespace App\Http\Controllers;

use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Generic Super-Admin-only soft delete & restore for whitelisted tables.
 * Mirrors src/lib/soft-delete.ts + voucher-api behaviour.
 */
class SoftDeleteController extends BaseController
{
    /** table => [module, hasStatus] */
    private const MAP = [
        'sales_invoices_v2' => ['sales',     true],
        'purchases'         => ['purchases', true],
        'party_payments'    => ['payments',  false],
        'acc_vouchers'      => ['vouchers',  true],
    ];

    public function __construct(private AuditService $audit) {}

    public function delete(Request $request, string $table, string $id)
    {
        [$ok, $resp] = $this->guard($request, $table);
        if (!$ok) return $resp;

        [$module, $hasStatus] = self::MAP[$table];
        $row = DB::table($table)->where('id', $id)->first();
        if (!$row) return $this->error('Record not found', 404);
        if (!empty($row->deleted_at)) return $this->error('Already deleted', 422);

        $patch = [
            'deleted_at' => now(),
            'deleted_by' => $request->user()->id,
        ];
        if ($hasStatus) {
            $patch['prev_status'] = $row->status ?? null;
            $patch['status']      = 'deleted';
        }
        DB::table($table)->where('id', $id)->update($patch);

        $this->audit->log($module, "{$table}_soft_deleted", $id, $request->input('reason') ?: 'Soft-deleted', $request);
        return $this->success(['deleted' => true, 'id' => $id]);
    }

    public function restore(Request $request, string $table, string $id)
    {
        [$ok, $resp] = $this->guard($request, $table);
        if (!$ok) return $resp;

        [$module, $hasStatus] = self::MAP[$table];
        $row = DB::table($table)->where('id', $id)->first();
        if (!$row) return $this->error('Record not found', 404);
        if (empty($row->deleted_at)) return $this->error('Record is not deleted', 422);

        $patch = ['deleted_at' => null, 'deleted_by' => null];
        if ($hasStatus) {
            $patch['status']      = $row->prev_status ?: 'draft';
            $patch['prev_status'] = null;
        }
        DB::table($table)->where('id', $id)->update($patch);

        $this->audit->log($module, "{$table}_restored", $id, 'Restored', $request);
        return $this->success(['restored' => true, 'id' => $id]);
    }

    private function guard(Request $request, string $table): array
    {
        if (!isset(self::MAP[$table])) {
            return [false, $this->error('Unsupported table', 400)];
        }
        if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'deleted_at')) {
            return [false, $this->error('Soft delete not enabled for this table', 422)];
        }
        if (!$request->user() || !$request->user()->isSuperAdmin()) {
            return [false, $this->error('Only Super Admin can perform this action', 403)];
        }
        return [true, null];
    }
}
