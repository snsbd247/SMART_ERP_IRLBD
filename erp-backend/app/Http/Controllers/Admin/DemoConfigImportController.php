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
 * Returns per-section results and writes an audit_log entry. Super Admin only.
 */
class DemoConfigImportController extends BaseController
{
    public function import(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->isSuperAdmin()) {
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

        $startedAt = now()->toIso8601String();
        $results = [];

        $results[] = $this->runSection('chart_of_accounts', 'Chart of Accounts',
            fn() => $this->importCoa($seed['coa'] ?? []));
        $results[] = $this->runSection('ifrs_account_mapping', 'IFRS Account Mapping',
            fn() => $this->importIfrs($seed['ifrs'] ?? []));
        $results[] = $this->runSection('roles_permissions', 'Roles & Permissions',
            fn() => $this->importRoles($seed['roles'] ?? []));
        $results[] = $this->runSection('number_sequences', 'Document Numbering',
            fn() => $this->importSequences($seed['sequences'] ?? []));
        $results[] = $this->runSection('page_shortcuts', 'Page Shortcuts',
            fn() => $this->importShortcuts($seed['shortcuts'] ?? []));

        $totalInserted = array_sum(array_column($results, 'inserted'));
        $anyFailed = collect($results)->contains(fn($r) => $r['status'] === 'failed');
        $overall = $anyFailed ? 'partial' : 'success';

        // Audit log
        try {
            if (Schema::hasTable('audit_log')) {
                DB::table('audit_log')->insert([
                    'id'         => (string) Str::uuid(),
                    'user_id'    => $user->id,
                    'user_name'  => $user->name ?? $user->email ?? null,
                    'module'     => 'backup',
                    'action'     => 'demo_config_import',
                    'details'    => "Demo import ($overall). $totalInserted rows inserted across " . count($results) . ' sections.',
                    'new_data'   => json_encode(['started_at' => $startedAt, 'results' => $results]),
                    'ip_address' => $request->ip(),
                    'user_agent' => substr((string) $request->userAgent(), 0, 250),
                    'created_at' => now(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('audit_log insert failed: ' . $e->getMessage());
        }

        return response()->json([
            'success'        => !$anyFailed,
            'overall'        => $overall,
            'total_inserted' => $totalInserted,
            'results'        => $results,
        ]);
    }

    /** @return array{section:string,label:string,attempted:int,inserted:int,skipped:int,status:string,error?:string} */
    private function runSection(string $section, string $label, \Closure $fn): array
    {
        $base = ['section' => $section, 'label' => $label, 'attempted' => 0, 'inserted' => 0, 'skipped' => 0, 'status' => 'ok'];
        try {
            $r = $fn();
            return array_merge($base, $r);
        } catch (\Throwable $e) {
            Log::error("Demo import [$section] failed: " . $e->getMessage());
            return array_merge($base, ['status' => 'failed', 'error' => $e->getMessage()]);
        }
    }

    private function importCoa(array $rows): array
    {
        $inserted = 0; $skipped = 0;
        foreach ($rows as $r) {
            if (DB::table('chart_of_accounts')->where('account_code', $r['account_code'])->exists()) {
                $skipped++; continue;
            }
            DB::table('chart_of_accounts')->insert([
                'id' => (string) Str::uuid(),
                'account_code' => $r['account_code'],
                'account_name' => $r['account_name'],
                'account_type' => $r['account_type'],
                'opening_balance' => 0,
                'opening_balance_type' => $r['opening_balance_type'] ?? 'debit',
                'is_active' => 1,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $inserted++;
        }
        $map = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        foreach ($rows as $r) {
            if (empty($r['parent_code'])) continue;
            $id = $map[$r['account_code']] ?? null;
            $pid = $map[$r['parent_code']] ?? null;
            if ($id && $pid) {
                DB::table('chart_of_accounts')->where('id', $id)->whereNull('parent_id')
                    ->update(['parent_id' => $pid, 'updated_at' => now()]);
            }
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importIfrs(array $rows): array
    {
        if (!Schema::hasTable('ifrs_account_mapping')) {
            return ['attempted' => count($rows), 'inserted' => 0, 'skipped' => count($rows), 'status' => 'partial', 'error' => 'ifrs_account_mapping table not present'];
        }
        $inserted = 0; $skipped = 0;
        $map = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        foreach ($rows as $r) {
            $accId = $map[$r['account_code']] ?? null;
            if (!$accId) { $skipped++; continue; }
            if (DB::table('ifrs_account_mapping')->where('account_id', $accId)->exists()) { $skipped++; continue; }
            DB::table('ifrs_account_mapping')->insert([
                'id' => (string) Str::uuid(),
                'account_id' => $accId,
                'ifrs_line' => $r['ifrs_line'],
                'notes' => $r['notes'] ?? null,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $inserted++;
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importRoles(array $rows): array
    {
        $rolesAdded = 0; $skipped = 0;
        foreach ($rows as $role) {
            $existing = DB::table('custom_roles')->where('name', $role['name'])->first();
            if ($existing) {
                $roleId = $existing->id; $skipped++;
            } else {
                $roleId = (string) Str::uuid();
                DB::table('custom_roles')->insert([
                    'id' => $roleId, 'name' => $role['name'],
                    'description' => $role['description'] ?? null, 'created_at' => now(),
                ]);
                $rolesAdded++;
            }
            foreach (($role['permissions'] ?? []) as $p) {
                $has = DB::table('role_permissions')->where('custom_role_id', $roleId)->where('module', $p['module'])->exists();
                if ($has) continue;
                DB::table('role_permissions')->insert([
                    'id' => (string) Str::uuid(),
                    'custom_role_id' => $roleId,
                    'module' => $p['module'],
                    'can_view'   => !empty($p['can_view'])   ? 1 : 0,
                    'can_add'    => !empty($p['can_add'])    ? 1 : 0,
                    'can_edit'   => !empty($p['can_edit'])   ? 1 : 0,
                    'can_delete' => !empty($p['can_delete']) ? 1 : 0,
                ]);
            }
        }
        return ['attempted' => count($rows), 'inserted' => $rolesAdded, 'skipped' => $skipped];
    }

    private function importSequences(array $rows): array
    {
        $inserted = 0; $skipped = 0;
        foreach ($rows as $s) {
            if (DB::table('number_sequences')->where('id', $s['id'])->exists()) { $skipped++; continue; }
            DB::table('number_sequences')->insert([
                'id' => $s['id'], 'prefix' => $s['prefix'],
                'current_number' => (int)($s['current_number'] ?? 0),
                'year' => (int)($s['year'] ?? (int) date('Y')),
                'description' => $s['description'] ?? null,
            ]);
            $inserted++;
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importShortcuts(array $rows): array
    {
        $inserted = 0; $skipped = 0;
        foreach ($rows as $s) {
            if (DB::table('page_shortcuts')->where('shortcut_code', $s['shortcut_code'])->exists()) { $skipped++; continue; }
            DB::table('page_shortcuts')->insert([
                'id' => (string) Str::uuid(),
                'shortcut_code' => $s['shortcut_code'],
                'page_name' => $s['page_name'],
                'page_url' => $s['page_url'],
                'module_name' => $s['module_name'],
                'is_active' => !empty($s['is_active']) ? 1 : 0,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $inserted++;
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }
}
