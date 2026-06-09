<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * DemoConfigSeeder
 *
 * Imports the canonical demo configuration bundle from
 *   database/seeders/data/demo_config_seed.json
 *
 * Covers all 14 configuration areas (matching DemoConfigImportController):
 *   CoA, IFRS, Purchase Types, Purchase COA Mapping, Purchase Settings,
 *   Branches, Financial Years, Roles & Permissions, GitHub Deploy Sync,
 *   Document Numbering, Page Shortcuts, General Settings, SMS Integration,
 *   Branding & White-Label.
 *
 * Idempotent (upsert). No transactional data is touched.
 */
class DemoConfigSeeder extends Seeder
{
    public function run(): void
    {
        $path = database_path('seeders/data/demo_config_seed.json');
        if (!file_exists($path)) {
            $this->command?->warn("DemoConfigSeeder: seed file not found at $path — skipping.");
            return;
        }
        $seed = json_decode(file_get_contents($path), true);
        if (!is_array($seed)) {
            $this->command?->warn("DemoConfigSeeder: seed file is not valid JSON — skipping.");
            return;
        }

        $this->seedCoa($seed['coa'] ?? []);
        $this->seedIfrs($seed['ifrs'] ?? []);
        $this->seedPurchaseTypes($seed['purchase_types'] ?? []);
        $this->seedPurchaseCoaMapping($seed['purchase_coa_mapping'] ?? []);
        $this->seedPurchaseSettings($seed['purchase_settings'] ?? null);
        $this->seedBranches($seed['branches'] ?? []);
        $this->seedFinancialYears($seed['financial_years'] ?? []);
        $this->seedRoles($seed['roles'] ?? []);
        $this->seedKvJson('github_deploy_sync_settings', $seed['github_deploy_sync'] ?? null);
        $this->seedSequences($seed['sequences'] ?? []);
        $this->seedShortcuts($seed['shortcuts'] ?? []);
        $this->seedCompanySettings($seed['company_settings'] ?? null);
        $this->seedKvMap($seed['sms_settings'] ?? []);
        $this->seedKvMap($seed['branding'] ?? []);

        $this->command?->info('  ✓ Demo configuration seeded (14 sections).');
    }

    private function seedCoa(array $rows): void
    {
        foreach ($rows as $r) {
            $exists = DB::table('chart_of_accounts')->where('account_code', $r['account_code'])->first();
            $payload = [
                'account_name' => $r['account_name'],
                'account_type' => $r['account_type'],
                'opening_balance_type' => $r['opening_balance_type'] ?? 'debit',
            ];
            if ($exists) {
                DB::table('chart_of_accounts')->where('id', $exists->id)->update($payload);
            } else {
                DB::table('chart_of_accounts')->insert(array_merge($payload, [
                    'id' => (string) Str::uuid(),
                    'account_code' => $r['account_code'],
                    'parent_id' => null,
                ]));
            }
        }
        $map = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        foreach ($rows as $r) {
            if (empty($r['parent_code'])) continue;
            $id = $map[$r['account_code']] ?? null;
            $pid = $map[$r['parent_code']] ?? null;
            if ($id && $pid) DB::table('chart_of_accounts')->where('id', $id)->update(['parent_id' => $pid]);
        }
    }

    private function seedIfrs(array $rows): void
    {
        if (!Schema::hasTable('ifrs_account_mapping')) return;
        $map = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        foreach ($rows as $r) {
            $accId = $map[$r['account_code']] ?? null;
            if (!$accId) continue;
            DB::table('ifrs_account_mapping')->updateOrInsert(
                ['account_id' => $accId],
                ['id' => (string) Str::uuid(), 'ifrs_line' => $r['ifrs_line'], 'notes' => $r['notes'] ?? null, 'updated_at' => now(), 'created_at' => now()]
            );
        }
    }

    private function seedPurchaseTypes(array $rows): void
    {
        if (!Schema::hasTable('purchase_types')) return;
        foreach ($rows as $r) {
            DB::table('purchase_types')->updateOrInsert(
                ['code' => $r['code']],
                [
                    'id' => (string) Str::uuid(),
                    'name' => $r['name'],
                    'description' => $r['description'] ?? null,
                    'is_lc' => !empty($r['is_lc']) ? 1 : 0,
                    'is_capex' => !empty($r['is_capex']) ? 1 : 0,
                    'is_service' => !empty($r['is_service']) ? 1 : 0,
                    'requires_grn' => !empty($r['requires_grn']) ? 1 : 0,
                    'requires_quality_check' => !empty($r['requires_quality_check']) ? 1 : 0,
                    'default_approval_flow' => $r['default_approval_flow'] ?? null,
                    'is_active' => !empty($r['is_active']) ? 1 : 0,
                    'updated_at' => now(), 'created_at' => now(),
                ]
            );
        }
    }

    private function seedPurchaseSettings($obj): void
    {
        if (!Schema::hasTable('purchase_settings') || !is_array($obj)) return;
        $existing = DB::table('purchase_settings')->first();
        $row = array_merge($obj, ['updated_at' => now()]);
        if ($existing) DB::table('purchase_settings')->where('id', $existing->id)->update($row);
        else DB::table('purchase_settings')->insert(array_merge($row, ['id' => (string) Str::uuid(), 'created_at' => now()]));
    }

    private function seedPurchaseCoaMapping(array $rows): void
    {
        if (!Schema::hasTable('purchase_coa_mapping')) return;
        $map = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        $fields = [
            'inventory_account_id' => 'inventory_account_code',
            'grn_clearing_account_id' => 'grn_clearing_account_code',
            'payable_account_id' => 'payable_account_code',
            'advance_account_id' => 'advance_account_code',
            'vat_input_account_id' => 'vat_input_account_code',
            'ait_account_id' => 'ait_account_code',
            'asset_account_id' => 'asset_account_code',
            'expense_account_id' => 'expense_account_code',
            'discount_account_id' => 'discount_account_code',
            'freight_account_id' => 'freight_account_code',
            'landed_cost_account_id' => 'landed_cost_account_code',
            'cash_account_id' => 'cash_account_code',
            'bank_account_id' => 'bank_account_code',
        ];
        foreach ($rows as $r) {
            $data = ['is_active' => !empty($r['is_active']) ? 1 : 0, 'updated_at' => now()];
            foreach ($fields as $col => $key) {
                $code = $r[$key] ?? null;
                $data[$col] = $code && isset($map[$code]) ? $map[$code] : null;
            }
            $ptId = !empty($r['purchase_type_code']) && Schema::hasTable('purchase_types')
                ? DB::table('purchase_types')->where('code', $r['purchase_type_code'])->value('id') : null;
            $brId = !empty($r['branch_code']) && Schema::hasTable('branches')
                ? DB::table('branches')->where('code', $r['branch_code'])->value('id') : null;
            $data['purchase_type_id'] = $ptId;
            $data['branch_id'] = $brId;

            $q = DB::table('purchase_coa_mapping');
            $ptId === null ? $q->whereNull('purchase_type_id') : $q->where('purchase_type_id', $ptId);
            $brId === null ? $q->whereNull('branch_id')        : $q->where('branch_id', $brId);
            $existing = $q->first();
            if ($existing) DB::table('purchase_coa_mapping')->where('id', $existing->id)->update($data);
            else DB::table('purchase_coa_mapping')->insert(array_merge($data, ['id' => (string) Str::uuid(), 'created_at' => now()]));
        }
    }

    private function seedBranches(array $rows): void
    {
        foreach ($rows as $r) {
            DB::table('branches')->updateOrInsert(
                ['code' => $r['code']],
                [
                    'id' => (string) Str::uuid(),
                    'name' => $r['name'],
                    'phone' => $r['phone'] ?? null,
                    'address' => $r['address'] ?? null,
                    'status' => $r['status'] ?? 'active',
                    'updated_at' => now(), 'created_at' => now(),
                ]
            );
        }
    }

    private function seedFinancialYears(array $rows): void
    {
        foreach ($rows as $r) {
            DB::table('financial_years')->updateOrInsert(
                ['name' => $r['name']],
                [
                    'id' => (string) Str::uuid(),
                    'start_date' => $r['start_date'], 'end_date' => $r['end_date'],
                    'is_active' => !empty($r['is_active']) ? 1 : 0,
                    'created_at' => now(),
                ]
            );
        }
    }

    private function seedRoles(array $roles): void
    {
        foreach ($roles as $role) {
            $existing = DB::table('custom_roles')->where('name', $role['name'])->first();
            if ($existing) {
                $roleId = $existing->id;
                DB::table('custom_roles')->where('id', $roleId)->update(['description' => $role['description'] ?? null]);
            } else {
                $roleId = (string) Str::uuid();
                DB::table('custom_roles')->insert(['id' => $roleId, 'name' => $role['name'], 'description' => $role['description'] ?? null]);
            }
            foreach (($role['permissions'] ?? []) as $p) {
                DB::table('role_permissions')->updateOrInsert(
                    ['custom_role_id' => $roleId, 'module' => $p['module']],
                    [
                        'id' => (string) Str::uuid(),
                        'can_view' => !empty($p['can_view']) ? 1 : 0,
                        'can_add' => !empty($p['can_add']) ? 1 : 0,
                        'can_edit' => !empty($p['can_edit']) ? 1 : 0,
                        'can_delete' => !empty($p['can_delete']) ? 1 : 0,
                    ]
                );
            }
        }
    }

    private function seedSequences(array $rows): void
    {
        foreach ($rows as $s) {
            DB::table('number_sequences')->updateOrInsert(
                ['id' => $s['id']],
                ['prefix' => $s['prefix'], 'current_number' => $s['current_number'] ?? 0, 'year' => $s['year'] ?? (int) date('Y'), 'description' => $s['description'] ?? null]
            );
        }
    }

    private function seedShortcuts(array $rows): void
    {
        foreach ($rows as $s) {
            DB::table('page_shortcuts')->updateOrInsert(
                ['shortcut_code' => $s['shortcut_code']],
                [
                    'id' => (string) Str::uuid(),
                    'page_name' => $s['page_name'], 'page_url' => $s['page_url'],
                    'module_name' => $s['module_name'],
                    'is_active' => !empty($s['is_active']) ? 1 : 0,
                    'updated_at' => now(), 'created_at' => now(),
                ]
            );
        }
    }

    private function seedCompanySettings($obj): void
    {
        if (!Schema::hasTable('company_settings') || !is_array($obj)) return;
        $id = $obj['id'] ?? 'default';
        $payload = array_diff_key($obj, ['id' => true]);
        DB::table('company_settings')->updateOrInsert(
            ['id' => $id],
            array_merge($payload, ['updated_at' => now(), 'created_at' => now()])
        );
    }

    private function seedKvMap(array $kv): void
    {
        if (!Schema::hasTable('system_settings')) return;
        foreach ($kv as $k => $v) {
            $val = is_scalar($v) ? (string) $v : json_encode($v);
            DB::table('system_settings')->updateOrInsert(
                ['setting_key' => $k],
                ['setting_value' => $val, 'is_encrypted' => 0, 'updated_at' => now(), 'created_at' => now()]
            );
        }
    }

    private function seedKvJson(string $key, $obj): void
    {
        if (!Schema::hasTable('system_settings') || $obj === null) return;
        DB::table('system_settings')->updateOrInsert(
            ['setting_key' => $key],
            ['setting_value' => json_encode($obj), 'is_encrypted' => 0, 'updated_at' => now(), 'created_at' => now()]
        );
    }
}
