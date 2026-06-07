<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Imports the demo configuration bundle (Chart of Accounts, IFRS Mapping,
 * Roles & Permissions, Document Numbering, Page Shortcuts). Idempotent and
 * safe — never deletes existing rows; only inserts what is missing.
 * Super Admin only.
 */
class DemoConfigImportController extends BaseController
{
    public function import(Request $request): JsonResponse
    {
        if (!$request->user() || !$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can import demo configuration.', 403);
        }

        $path = database_path('seeders/data/demo_config_seed.json');
        if (!is_file($path)) {
            return $this->error('Seed file missing: ' . $path, 500);
        }
        $seed = json_decode((string) file_get_contents($path), true);
        if (!is_array($seed)) {
            return $this->error('Seed file is invalid JSON.', 500);
        }

        $stats = [];
        try {
            $stats['chart_of_accounts']     = $this->importCoa($seed['coa'] ?? []);
            $stats['ifrs_account_mapping']  = $this->importIfrs($seed['ifrs'] ?? []);
            [$r, $p]                        = $this->importRoles($seed['roles'] ?? []);
            $stats['custom_roles']          = $r;
            $stats['role_permissions']      = $p;
            $stats['number_sequences']      = $this->importSequences($seed['sequences'] ?? []);
            $stats['page_shortcuts']        = $this->importShortcuts($seed['shortcuts'] ?? []);
        } catch (\Throwable $e) {
            Log::error('Demo config import failed: ' . $e->getMessage());
            return $this->error('Import failed: ' . $e->getMessage(), 500);
        }

        return $this->success([
            'success' => true,
            'stats'   => $stats,
        ], 'Demo configuration imported successfully');
    }

    private function importCoa(array $rows): int
    {
        $count = 0;
        // Pass 1: insert rows without parent_id
        foreach ($rows as $r) {
            $exists = DB::table('chart_of_accounts')->where('account_code', $r['account_code'])->exists();
            if ($exists) continue;
            DB::table('chart_of_accounts')->insert([
                'id'                   => (string) Str::uuid(),
                'account_code'         => $r['account_code'],
                'account_name'         => $r['account_name'],
                'account_type'         => $r['account_type'],
                'opening_balance'      => 0,
                'opening_balance_type' => $r['opening_balance_type'] ?? 'debit',
                'is_active'            => 1,
                'created_at'           => now(),
                'updated_at'           => now(),
            ]);
            $count++;
        }
        // Pass 2: patch parent links
        $map = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        foreach ($rows as $r) {
            if (empty($r['parent_code'])) continue;
            $id = $map[$r['account_code']] ?? null;
            $pid = $map[$r['parent_code']] ?? null;
            if ($id && $pid) {
                DB::table('chart_of_accounts')
                    ->where('id', $id)
                    ->whereNull('parent_id')
                    ->update(['parent_id' => $pid, 'updated_at' => now()]);
            }
        }
        return $count;
    }

    private function importIfrs(array $rows): int
    {
        if (!Schema::hasTable('ifrs_account_mapping')) return 0;
        $count = 0;
        $map = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        foreach ($rows as $r) {
            $accId = $map[$r['account_code']] ?? null;
            if (!$accId) continue;
            $exists = DB::table('ifrs_account_mapping')->where('account_id', $accId)->exists();
            if ($exists) continue;
            DB::table('ifrs_account_mapping')->insert([
                'id'         => (string) Str::uuid(),
                'account_id' => $accId,
                'ifrs_line'  => $r['ifrs_line'],
                'notes'      => $r['notes'] ?? null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $count++;
        }
        return $count;
    }

    /** @return array{0:int,1:int} */
    private function importRoles(array $rows): array
    {
        $rolesAdded = 0;
        $permsAdded = 0;
        foreach ($rows as $role) {
            $existing = DB::table('custom_roles')->where('name', $role['name'])->first();
            if ($existing) {
                $roleId = $existing->id;
            } else {
                $roleId = (string) Str::uuid();
                DB::table('custom_roles')->insert([
                    'id'          => $roleId,
                    'name'        => $role['name'],
                    'description' => $role['description'] ?? null,
                    'created_at'  => now(),
                ]);
                $rolesAdded++;
            }
            foreach (($role['permissions'] ?? []) as $p) {
                $has = DB::table('role_permissions')
                    ->where('custom_role_id', $roleId)
                    ->where('module', $p['module'])->exists();
                if ($has) continue;
                DB::table('role_permissions')->insert([
                    'id'             => (string) Str::uuid(),
                    'custom_role_id' => $roleId,
                    'module'         => $p['module'],
                    'can_view'       => !empty($p['can_view'])   ? 1 : 0,
                    'can_add'        => !empty($p['can_add'])    ? 1 : 0,
                    'can_edit'       => !empty($p['can_edit'])   ? 1 : 0,
                    'can_delete'     => !empty($p['can_delete']) ? 1 : 0,
                ]);
                $permsAdded++;
            }
        }
        return [$rolesAdded, $permsAdded];
    }

    private function importSequences(array $rows): int
    {
        $count = 0;
        foreach ($rows as $s) {
            if (DB::table('number_sequences')->where('id', $s['id'])->exists()) continue;
            DB::table('number_sequences')->insert([
                'id'             => $s['id'],
                'prefix'         => $s['prefix'],
                'current_number' => (int)($s['current_number'] ?? 0),
                'year'           => (int)($s['year'] ?? (int) date('Y')),
                'description'    => $s['description'] ?? null,
            ]);
            $count++;
        }
        return $count;
    }

    private function importShortcuts(array $rows): int
    {
        $count = 0;
        foreach ($rows as $s) {
            if (DB::table('page_shortcuts')->where('shortcut_code', $s['shortcut_code'])->exists()) continue;
            DB::table('page_shortcuts')->insert([
                'id'            => (string) Str::uuid(),
                'shortcut_code' => $s['shortcut_code'],
                'page_name'     => $s['page_name'],
                'page_url'      => $s['page_url'],
                'module_name'   => $s['module_name'],
                'is_active'     => !empty($s['is_active']) ? 1 : 0,
                'created_at'    => now(),
                'updated_at'    => now(),
            ]);
            $count++;
        }
        return $count;
    }
}
