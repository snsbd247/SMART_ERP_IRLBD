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
 * Imports the demo configuration bundle for 14 configuration areas.
 *
 *   1.  Chart of Accounts (with bank ledgers)
 *   2.  IFRS Account Mapping
 *   3.  Purchase Types
 *   4.  Purchase COA Mapping
 *   5.  Purchase Settings
 *   6.  Branch Management
 *   7.  Financial Years
 *   8.  Roles & Permissions
 *   9.  GitHub Deploy Sync
 *   10. Document Numbering
 *   11. Page Shortcuts
 *   12. General Settings
 *   13. SMS Integration
 *   14. Branding & White-Label
 *
 * Modes:
 *   - reset = false (default, "Import - keep existing"): UPSERT — existing rows
 *     are overwritten with seed values, missing rows are inserted. No deletes.
 *   - reset = true ("Reset & Re-import"): the configuration rows for these 14
 *     sections are deleted and re-imported fresh. Transactional data
 *     (vouchers, invoices, POs, GRNs, stock, payroll, etc.) is NEVER touched.
 *
 * Super Admin only.
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

        $reset   = (bool) $request->boolean('reset', false);
        $dryRun  = (bool) $request->boolean('dry_run', false);
        $only    = $request->input('sections');
        $only    = is_array($only) && !empty($only) ? array_flip($only) : null; // null = all
        $startedAt = now()->toIso8601String();
        $results = [];

        // Full plan of section runners (key => [label, runner closure])
        $plan = [
            'chart_of_accounts'    => ['Chart of Accounts',      fn() => $this->importCoa($seed['coa'] ?? [], $reset)],
            'ifrs_account_mapping' => ['IFRS Account Mapping',   fn() => $this->importIfrs($seed['ifrs'] ?? [])],
            'purchase_types'       => ['Purchase Types',         fn() => $this->importPurchaseTypes($seed['purchase_types'] ?? [])],
            'purchase_coa_mapping' => ['Purchase COA Mapping',   fn() => $this->importPurchaseCoaMapping($seed['purchase_coa_mapping'] ?? [])],
            'purchase_settings'    => ['Purchase Settings',      fn() => $this->importPurchaseSettings($seed['purchase_settings'] ?? null)],
            'branches'             => ['Branch Management',      fn() => $this->importBranches($seed['branches'] ?? [])],
            'financial_years'      => ['Financial Years',        fn() => $this->importFinancialYears($seed['financial_years'] ?? [])],
            'roles_permissions'    => ['Roles & Permissions',    fn() => $this->importRoles($seed['roles'] ?? [], $reset)],
            'github_deploy_sync'   => ['GitHub Deploy Sync',     fn() => $this->importKvJson('github_deploy_sync_settings', $seed['github_deploy_sync'] ?? null)],
            'number_sequences'     => ['Document Numbering',     fn() => $this->importSequences($seed['sequences'] ?? [])],
            'page_shortcuts'       => ['Page Shortcuts',         fn() => $this->importShortcuts($seed['shortcuts'] ?? [])],
            'company_settings'     => ['General Settings',       fn() => $this->importCompanySettings($seed['company_settings'] ?? null)],
            'sms_settings'         => ['SMS Integration',        fn() => $this->importKvMap($seed['sms_settings'] ?? [])],
            'branding'             => ['Branding & White-Label', fn() => $this->importKvMap($seed['branding'] ?? [])],
        ];

        // Execute everything inside a transaction so dry-run can be rolled back.
        // For real runs we commit. Reset is only honoured when not dry-run.
        DB::beginTransaction();
        try {
            if ($reset && !$dryRun) {
                $this->resetConfigTables();
            }
            foreach ($plan as $key => [$label, $fn]) {
                if ($only !== null && !isset($only[$key])) continue;
                $results[] = $this->runSection($key, $label, $fn);
            }
            if ($dryRun) {
                DB::rollBack();
            } else {
                DB::commit();
            }
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        $totalInserted = array_sum(array_column($results, 'inserted'));
        $totalUpdated  = array_sum(array_column($results, 'skipped')); // "skipped" in our importers means "row already existed and was updated/overwritten"
        $anyFailed = collect($results)->contains(fn($r) => $r['status'] === 'failed');
        $overall = $anyFailed ? 'partial' : 'success';

        // Audit log — only on real runs (skip for dry-runs).
        if (!$dryRun) {
            try {
                if (Schema::hasTable('audit_log')) {
                    $importedSections = array_map(fn($r) => $r['section'], $results);
                    DB::table('audit_log')->insert([
                        'id'         => (string) Str::uuid(),
                        'user_id'    => $user->id,
                        'user_name'  => $user->name ?? $user->email ?? null,
                        'module'     => 'backup',
                        'action'     => $reset ? 'demo_config_reset_import' : 'demo_config_import',
                        'details'    => sprintf(
                            'Demo import (%s, mode=%s). %d inserted / %d updated across %d sections: %s',
                            $overall, $reset ? 'reset' : 'keep',
                            $totalInserted, $totalUpdated, count($results),
                            implode(', ', $importedSections)
                        ),
                        'new_data'   => json_encode([
                            'mode'              => $reset ? 'reset' : 'keep',
                            'started_at'        => $startedAt,
                            'finished_at'      => now()->toIso8601String(),
                            'imported_sections' => $importedSections,
                            'results'           => $results,
                        ]),
                        'ip_address' => $request->ip(),
                        'user_agent' => substr((string) $request->userAgent(), 0, 250),
                        'created_at' => now(),
                    ]);
                }
            } catch (\Throwable $e) {
                Log::warning('audit_log insert failed: ' . $e->getMessage());
            }
        }

        return response()->json([
            'success'        => !$anyFailed,
            'overall'        => $overall,
            'mode'           => $reset ? 'reset' : 'keep',
            'dry_run'        => $dryRun,
            'total_inserted' => $totalInserted,
            'total_updated'  => $totalUpdated,
            'results'        => $results,
        ]);
    }



    /** Delete config rows for the 14 sections. Transactional data is untouched. */
    private function resetConfigTables(): void
    {
        // SAFE LIST — only configuration tables. Order matters for FK constraints.
        $cleanups = [
            // Purchase config (FK from purchase_coa_mapping → purchase_types)
            'purchase_coa_mapping',
            'purchase_settings',
            'purchase_types',
            // Roles & permissions
            'role_permissions',
            'user_custom_roles',
            'custom_roles',
            // IFRS (FK to chart_of_accounts) BEFORE CoA
            'ifrs_account_mapping',
            // Chart of Accounts
            'chart_of_accounts',
            // Sequences / shortcuts
            'number_sequences',
            'page_shortcuts',
            // Branches & FY (last because many tables FK to branches; we keep FK rows clean
            // by NOT deleting branches if other modules reference them — guard below)
            'financial_years',
        ];

        $driver = DB::connection()->getDriverName();
        $isMysql = $driver === 'mysql';

        try {
            if ($isMysql) DB::statement('SET FOREIGN_KEY_CHECKS=0');
            foreach ($cleanups as $tbl) {
                if (Schema::hasTable($tbl)) {
                    DB::table($tbl)->delete();
                }
            }
            // Branches: only clear if no employees / no users reference them yet.
            if (Schema::hasTable('branches')) {
                $hasEmpRef  = Schema::hasTable('employees') && DB::table('employees')->whereNotNull('branch_id')->exists();
                $hasUserRef = Schema::hasTable('users')     && DB::table('users')->whereNotNull('branch_id')->exists();
                if (!$hasEmpRef && !$hasUserRef) {
                    DB::table('branches')->delete();
                }
            }
            // Clear specific kv settings used by the 4 settings-style sections.
            if (Schema::hasTable('system_settings')) {
                DB::table('system_settings')->whereIn('setting_key', [
                    'sms_api_key', 'sms_sender_id', 'sms_enabled',
                    'software_name', 'software_version', 'footer_text', 'developer_name', 'primary_color',
                    'github_deploy_sync_settings',
                ])->delete();
            }
            if ($isMysql) DB::statement('SET FOREIGN_KEY_CHECKS=1');
        } catch (\Throwable $e) {
            if ($isMysql) {
                try { DB::statement('SET FOREIGN_KEY_CHECKS=1'); } catch (\Throwable $ignored) {}
            }
            throw $e;
        }
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

    /* ---------------- Section importers ---------------- */

    private function importCoa(array $rows, bool $reset): array
    {
        $inserted = 0; $skipped = 0;
        foreach ($rows as $r) {
            $exists = DB::table('chart_of_accounts')->where('account_code', $r['account_code'])->first();
            if ($exists) {
                // UPSERT (keep mode): overwrite name/type/opening
                DB::table('chart_of_accounts')->where('id', $exists->id)->update([
                    'account_name'         => $r['account_name'],
                    'account_type'         => $r['account_type'],
                    'opening_balance_type' => $r['opening_balance_type'] ?? 'debit',
                    'updated_at'           => now(),
                ]);
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
        // Resolve parent_id
        $map = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        foreach ($rows as $r) {
            if (empty($r['parent_code'])) continue;
            $id = $map[$r['account_code']] ?? null;
            $pid = $map[$r['parent_code']] ?? null;
            if ($id && $pid) {
                DB::table('chart_of_accounts')->where('id', $id)
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
            $exists = DB::table('ifrs_account_mapping')->where('account_id', $accId)->first();
            if ($exists) {
                DB::table('ifrs_account_mapping')->where('id', $exists->id)->update([
                    'ifrs_line' => $r['ifrs_line'], 'notes' => $r['notes'] ?? null, 'updated_at' => now(),
                ]);
                $skipped++;
            } else {
                DB::table('ifrs_account_mapping')->insert([
                    'id' => (string) Str::uuid(),
                    'account_id' => $accId,
                    'ifrs_line' => $r['ifrs_line'],
                    'notes' => $r['notes'] ?? null,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                $inserted++;
            }
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importPurchaseTypes(array $rows): array
    {
        if (!Schema::hasTable('purchase_types')) {
            return ['attempted' => count($rows), 'inserted' => 0, 'skipped' => count($rows), 'status' => 'partial', 'error' => 'purchase_types table not present'];
        }
        $inserted = 0; $skipped = 0;
        foreach ($rows as $r) {
            $existing = DB::table('purchase_types')->where('code', $r['code'])->first();
            $data = [
                'name' => $r['name'],
                'description' => $r['description'] ?? null,
                'is_lc' => !empty($r['is_lc']) ? 1 : 0,
                'is_capex' => !empty($r['is_capex']) ? 1 : 0,
                'is_service' => !empty($r['is_service']) ? 1 : 0,
                'requires_grn' => !empty($r['requires_grn']) ? 1 : 0,
                'requires_quality_check' => !empty($r['requires_quality_check']) ? 1 : 0,
                'default_approval_flow' => $r['default_approval_flow'] ?? null,
                'is_active' => !empty($r['is_active']) ? 1 : 0,
                'updated_at' => now(),
            ];
            if ($existing) {
                DB::table('purchase_types')->where('id', $existing->id)->update($data);
                $skipped++;
            } else {
                DB::table('purchase_types')->insert(array_merge($data, [
                    'id' => (string) Str::uuid(), 'code' => $r['code'], 'created_at' => now(),
                ]));
                $inserted++;
            }
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importPurchaseSettings($obj): array
    {
        if (!Schema::hasTable('purchase_settings') || !is_array($obj)) {
            return ['attempted' => 1, 'inserted' => 0, 'skipped' => 1];
        }
        $row = array_merge($obj, ['updated_at' => now()]);
        $existing = DB::table('purchase_settings')->first();
        if ($existing) {
            DB::table('purchase_settings')->where('id', $existing->id)->update($row);
            return ['attempted' => 1, 'inserted' => 0, 'skipped' => 1];
        }
        DB::table('purchase_settings')->insert(array_merge($row, [
            'id' => (string) Str::uuid(), 'created_at' => now(),
        ]));
        return ['attempted' => 1, 'inserted' => 1, 'skipped' => 0];
    }

    private function importPurchaseCoaMapping(array $rows): array
    {
        if (!Schema::hasTable('purchase_coa_mapping')) {
            return ['attempted' => count($rows), 'inserted' => 0, 'skipped' => count($rows), 'status' => 'partial', 'error' => 'purchase_coa_mapping table not present'];
        }
        $map = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        $inserted = 0; $skipped = 0;
        $fields = [
            'inventory_account_id'    => 'inventory_account_code',
            'grn_clearing_account_id' => 'grn_clearing_account_code',
            'payable_account_id'      => 'payable_account_code',
            'advance_account_id'      => 'advance_account_code',
            'vat_input_account_id'    => 'vat_input_account_code',
            'ait_account_id'          => 'ait_account_code',
            'asset_account_id'        => 'asset_account_code',
            'expense_account_id'      => 'expense_account_code',
            'discount_account_id'     => 'discount_account_code',
            'freight_account_id'      => 'freight_account_code',
            'landed_cost_account_id'  => 'landed_cost_account_code',
            'cash_account_id'         => 'cash_account_code',
            'bank_account_id'         => 'bank_account_code',
        ];
        foreach ($rows as $r) {
            $data = ['is_active' => !empty($r['is_active']) ? 1 : 0, 'updated_at' => now()];
            foreach ($fields as $col => $key) {
                $code = $r[$key] ?? null;
                $data[$col] = $code && isset($map[$code]) ? $map[$code] : null;
            }
            // Resolve optional purchase_type by code and branch by code
            $ptId = null;
            if (!empty($r['purchase_type_code']) && Schema::hasTable('purchase_types')) {
                $ptId = DB::table('purchase_types')->where('code', $r['purchase_type_code'])->value('id');
            }
            $brId = null;
            if (!empty($r['branch_code']) && Schema::hasTable('branches')) {
                $brId = DB::table('branches')->where('code', $r['branch_code'])->value('id');
            }
            $data['purchase_type_id'] = $ptId;
            $data['branch_id'] = $brId;

            $q = DB::table('purchase_coa_mapping');
            $ptId === null ? $q->whereNull('purchase_type_id') : $q->where('purchase_type_id', $ptId);
            $brId === null ? $q->whereNull('branch_id')        : $q->where('branch_id', $brId);
            $existing = $q->first();
            if ($existing) {
                DB::table('purchase_coa_mapping')->where('id', $existing->id)->update($data);
                $skipped++;
            } else {
                DB::table('purchase_coa_mapping')->insert(array_merge($data, [
                    'id' => (string) Str::uuid(), 'created_at' => now(),
                ]));
                $inserted++;
            }
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importBranches(array $rows): array
    {
        $inserted = 0; $skipped = 0;
        foreach ($rows as $r) {
            $existing = DB::table('branches')->where('code', $r['code'])->first();
            $data = [
                'name' => $r['name'],
                'phone' => $r['phone'] ?? null,
                'address' => $r['address'] ?? null,
                'status' => $r['status'] ?? 'active',
                'updated_at' => now(),
            ];
            if ($existing) {
                DB::table('branches')->where('id', $existing->id)->update($data);
                $skipped++;
            } else {
                DB::table('branches')->insert(array_merge($data, [
                    'id' => (string) Str::uuid(), 'code' => $r['code'], 'created_at' => now(),
                ]));
                $inserted++;
            }
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importFinancialYears(array $rows): array
    {
        $inserted = 0; $skipped = 0;
        foreach ($rows as $r) {
            $existing = DB::table('financial_years')->where('name', $r['name'])->first();
            $data = [
                'start_date' => $r['start_date'],
                'end_date'   => $r['end_date'],
                'is_active'  => !empty($r['is_active']) ? 1 : 0,
            ];
            if ($existing) {
                DB::table('financial_years')->where('id', $existing->id)->update($data);
                $skipped++;
            } else {
                DB::table('financial_years')->insert(array_merge($data, [
                    'id' => (string) Str::uuid(), 'name' => $r['name'], 'created_at' => now(),
                ]));
                $inserted++;
            }
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importRoles(array $rows, bool $reset): array
    {
        $rolesAdded = 0; $skipped = 0;
        foreach ($rows as $role) {
            $existing = DB::table('custom_roles')->where('name', $role['name'])->first();
            if ($existing) {
                $roleId = $existing->id;
                DB::table('custom_roles')->where('id', $roleId)->update([
                    'description' => $role['description'] ?? null,
                ]);
                $skipped++;
            } else {
                $roleId = (string) Str::uuid();
                DB::table('custom_roles')->insert([
                    'id' => $roleId, 'name' => $role['name'],
                    'description' => $role['description'] ?? null, 'created_at' => now(),
                ]);
                $rolesAdded++;
            }
            foreach (($role['permissions'] ?? []) as $p) {
                $row = [
                    'can_view'   => !empty($p['can_view'])   ? 1 : 0,
                    'can_add'    => !empty($p['can_add'])    ? 1 : 0,
                    'can_edit'   => !empty($p['can_edit'])   ? 1 : 0,
                    'can_delete' => !empty($p['can_delete']) ? 1 : 0,
                ];
                $exists = DB::table('role_permissions')->where('custom_role_id', $roleId)->where('module', $p['module'])->first();
                if ($exists) {
                    DB::table('role_permissions')->where('id', $exists->id)->update($row);
                } else {
                    DB::table('role_permissions')->insert(array_merge($row, [
                        'id' => (string) Str::uuid(),
                        'custom_role_id' => $roleId,
                        'module' => $p['module'],
                    ]));
                }
            }
        }
        return ['attempted' => count($rows), 'inserted' => $rolesAdded, 'skipped' => $skipped];
    }

    private function importSequences(array $rows): array
    {
        $inserted = 0; $skipped = 0;
        foreach ($rows as $s) {
            $exists = DB::table('number_sequences')->where('id', $s['id'])->exists();
            $data = [
                'prefix' => $s['prefix'],
                'current_number' => (int)($s['current_number'] ?? 0),
                'year' => (int)($s['year'] ?? (int) date('Y')),
                'description' => $s['description'] ?? null,
            ];
            if ($exists) {
                DB::table('number_sequences')->where('id', $s['id'])->update($data);
                $skipped++;
            } else {
                DB::table('number_sequences')->insert(array_merge($data, ['id' => $s['id']]));
                $inserted++;
            }
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importShortcuts(array $rows): array
    {
        $inserted = 0; $skipped = 0;
        foreach ($rows as $s) {
            $existing = DB::table('page_shortcuts')->where('shortcut_code', $s['shortcut_code'])->first();
            $data = [
                'page_name'   => $s['page_name'],
                'page_url'    => $s['page_url'],
                'module_name' => $s['module_name'],
                'is_active'   => !empty($s['is_active']) ? 1 : 0,
                'updated_at'  => now(),
            ];
            if ($existing) {
                DB::table('page_shortcuts')->where('id', $existing->id)->update($data);
                $skipped++;
            } else {
                DB::table('page_shortcuts')->insert(array_merge($data, [
                    'id' => (string) Str::uuid(),
                    'shortcut_code' => $s['shortcut_code'],
                    'created_at' => now(),
                ]));
                $inserted++;
            }
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function importCompanySettings($obj): array
    {
        if (!Schema::hasTable('company_settings') || !is_array($obj)) {
            return ['attempted' => 1, 'inserted' => 0, 'skipped' => 1];
        }
        $id = $obj['id'] ?? 'default';
        $payload = array_diff_key($obj, ['id' => true]);
        $existing = DB::table('company_settings')->where('id', $id)->first();
        if ($existing) {
            DB::table('company_settings')->where('id', $id)->update(array_merge($payload, ['updated_at' => now()]));
            return ['attempted' => 1, 'inserted' => 0, 'skipped' => 1];
        }
        DB::table('company_settings')->insert(array_merge($payload, [
            'id' => $id, 'created_at' => now(), 'updated_at' => now(),
        ]));
        return ['attempted' => 1, 'inserted' => 1, 'skipped' => 0];
    }

    /** Upsert each k=>v into system_settings as a single setting_key row. */
    private function importKvMap(array $kv): array
    {
        if (!Schema::hasTable('system_settings')) {
            return ['attempted' => count($kv), 'inserted' => 0, 'skipped' => count($kv), 'status' => 'partial', 'error' => 'system_settings table not present'];
        }
        $inserted = 0; $skipped = 0;
        foreach ($kv as $k => $v) {
            $val = is_scalar($v) ? (string) $v : json_encode($v);
            $exists = DB::table('system_settings')->where('setting_key', $k)->exists();
            if ($exists) {
                DB::table('system_settings')->where('setting_key', $k)->update(['setting_value' => $val, 'updated_at' => now()]);
                $skipped++;
            } else {
                DB::table('system_settings')->insert([
                    'setting_key' => $k, 'setting_value' => $val,
                    'is_encrypted' => 0, 'created_at' => now(), 'updated_at' => now(),
                ]);
                $inserted++;
            }
        }
        return ['attempted' => count($kv), 'inserted' => $inserted, 'skipped' => $skipped];
    }

    /** Single JSON blob under a setting_key. */
    private function importKvJson(string $key, $obj): array
    {
        if (!Schema::hasTable('system_settings') || $obj === null) {
            return ['attempted' => 1, 'inserted' => 0, 'skipped' => 1];
        }
        $val = json_encode($obj);
        $exists = DB::table('system_settings')->where('setting_key', $key)->exists();
        if ($exists) {
            DB::table('system_settings')->where('setting_key', $key)->update(['setting_value' => $val, 'updated_at' => now()]);
            return ['attempted' => 1, 'inserted' => 0, 'skipped' => 1];
        }
        DB::table('system_settings')->insert([
            'setting_key' => $key, 'setting_value' => $val,
            'is_encrypted' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);
        return ['attempted' => 1, 'inserted' => 1, 'skipped' => 0];
    }
}
