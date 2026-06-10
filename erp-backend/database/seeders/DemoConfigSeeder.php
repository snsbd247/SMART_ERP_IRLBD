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
                ['id' => (string) Str::uuid(), 'ifrs_line' => $this->normalizeIfrsLine($r['ifrs_line']), 'notes' => $r['notes'] ?? null, 'updated_at' => now(), 'created_at' => now()]
            );
        }

        // Fallback: every active CoA account must have an IFRS line so the
        // IFRS Financial Statements report is never blank for new accounts.
        $mappedIds = DB::table('ifrs_account_mapping')->pluck('account_id')->all();
        $unmapped = DB::table('chart_of_accounts')
            ->where('is_active', 1)
            ->whereNotIn('id', $mappedIds)
            ->get(['id', 'account_code', 'account_name', 'account_type']);
        foreach ($unmapped as $a) {
            DB::table('ifrs_account_mapping')->updateOrInsert(
                ['account_id' => $a->id],
                [
                    'id' => (string) Str::uuid(),
                    'ifrs_line' => $this->inferIfrsLine($a->account_type, (string) $a->account_code, (string) $a->account_name),
                    'notes' => 'auto-mapped',
                    'updated_at' => now(),
                    'created_at' => now(),
                ]
            );
        }
    }

    private function normalizeIfrsLine(string $line): string
    {
        $map = [
            'revenue' => 'revenue', 'total income' => 'revenue', 'cost of sales' => 'cogs',
            'administrative expenses' => 'admin_expense', 'operating expenses' => 'admin_expense',
            'selling and distribution expenses' => 'selling_expense', 'distribution costs' => 'selling_expense',
            'finance costs' => 'financial_expense', 'finance income' => 'other_income', 'other income' => 'other_income',
            'income tax expense' => 'tax_provision', 'current tax liabilities' => 'provision_income_tax',
            'deferred tax assets' => 'deferred_tax_asset', 'property, plant and equipment' => 'ppe',
            'intangible assets' => 'intangible_asset', 'inventories' => 'inventory', 'current tax assets' => 'advance_income_tax',
            'advances, deposits and prepayments' => 'advance_deposit', 'other current assets' => 'advance_deposit',
            'trade receivables' => 'accounts_receivable', 'trade and other receivables' => 'accounts_receivable',
            'cash and cash equivalents' => 'cash_bank', 'issued capital' => 'share_capital', 'share capital' => 'share_capital',
            'total equity' => 'retained_earnings', 'retained earnings' => 'retained_earnings', 'revaluation reserve' => 'revaluation_reserve',
            'long-term borrowings' => 'long_term_loan', 'total liabilities' => 'other_liability',
            'accrued expenses and other current liabilities' => 'other_liability', 'other current liabilities' => 'other_liability',
            'employee benefit obligations' => 'other_liability', 'trade payables' => 'accounts_payable',
            'trade and other payables' => 'accounts_payable', 'short-term borrowings' => 'short_term_loan', 'total assets' => 'advance_deposit',
        ];
        return $map[strtolower(trim($line))] ?? $line;
    }

    private function inferIfrsLine(?string $type, string $code, string $name): string
    {
        $codeMap = [
            '1000'=>'ppe','1100'=>'ppe','1200'=>'inventory','2000'=>'other_liability','2100'=>'long_term_loan','2200'=>'short_term_loan','3000'=>'retained_earnings','4000'=>'revenue','5000'=>'cogs','5100'=>'cogs','5200'=>'cogs','5300'=>'cogs','6000'=>'admin_expense','6100'=>'admin_expense','6200'=>'selling_expense','6300'=>'financial_expense','6400'=>'tax_provision',
            '1101'=>'ppe','1102'=>'intangible_asset','1103'=>'deferred_tax_asset','1104'=>'advance_deposit','1105'=>'inventory','1106'=>'advance_deposit','1107'=>'advance_income_tax','1111'=>'cash_bank','1112'=>'cash_bank','1113'=>'cash_bank','1114'=>'cash_bank','1201'=>'ppe','1202'=>'ppe','1203'=>'ppe','1204'=>'ppe','1205'=>'ppe','1210'=>'inventory','1211'=>'inventory','1212'=>'inventory','1213'=>'inventory','1214'=>'inventory','1215'=>'inventory','1220'=>'advance_income_tax','1230'=>'advance_deposit','1231'=>'advance_deposit','1232'=>'advance_deposit','1233'=>'advance_deposit','1234'=>'advance_deposit','1250'=>'cash_bank','1251'=>'cash_bank','1252'=>'cash_bank','1253'=>'cash_bank','1254'=>'cash_bank','1255'=>'cash_bank','1256'=>'cash_bank',
            '2101'=>'long_term_loan','2102'=>'accounts_payable','2103'=>'other_liability','2104'=>'vat_payable','2105'=>'short_term_loan','2106'=>'other_liability','2107'=>'other_liability','2201'=>'short_term_loan','2202'=>'short_term_loan','2228'=>'vat_payable','2240'=>'provision_income_tax','3101'=>'share_capital','3102'=>'retained_earnings','3103'=>'revaluation_reserve','4101'=>'revenue','4102'=>'revenue','4105'=>'revenue','4103'=>'other_income','4104'=>'other_income','4201'=>'other_income','5101'=>'cogs','5102'=>'cogs','5103'=>'cogs','5205'=>'selling_expense','5206'=>'selling_expense','6401'=>'tax_provision','6402'=>'deferred_tax',
        ];
        if (isset($codeMap[$code])) return $codeMap[$code];
        $num = preg_match('/^\d{4}$/', $code) ? (int) $code : 0;
        if ($num >= 1201 && $num <= 1209) return 'ppe';
        if ($num >= 1210 && $num <= 1219) return 'inventory';
        if ($num >= 1220 && $num <= 1229) return 'advance_income_tax';
        if ($num >= 1230 && $num <= 1239) return 'advance_deposit';
        if ($num >= 1240 && $num <= 1249) return 'accounts_receivable';
        if ($num >= 1250 && $num <= 1299) return 'cash_bank';
        if ($num >= 2210 && $num <= 2219) return 'accounts_payable';
        if ($num >= 2220 && $num <= 2229) return 'other_liability';
        if ($num >= 2230 && $num <= 2239) return 'short_term_loan';
        if ($num >= 5300 && $num <= 5999) return 'cogs';
        if ($num >= 6100 && $num <= 6199) return 'admin_expense';
        if ($num >= 6200 && $num <= 6299) return 'selling_expense';
        if ($num >= 6300 && $num <= 6399) return 'financial_expense';
        if ($num >= 6400 && $num <= 6499) return 'tax_provision';
        return match (strtolower((string) $type)) {
            'asset' => str_contains(strtolower($name), 'cash') || str_contains(strtolower($name), 'bank') ? 'cash_bank' : 'advance_deposit',
            'liability' => str_contains(strtolower($name), 'payable') || str_contains(strtolower($name), 'supplier') ? 'accounts_payable' : 'other_liability',
            'equity' => str_contains(strtolower($name), 'capital') ? 'share_capital' : 'retained_earnings',
            'income', 'revenue' => str_contains(strtolower($name), 'other') || str_contains(strtolower($name), 'interest') ? 'other_income' : 'revenue',
            'expense' => 'admin_expense',
            default => 'other_liability',
        };
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
        $row = $this->normalizePurchaseSettingsRow($obj);
        if ($existing) DB::table('purchase_settings')->where('id', $existing->id)->update($row);
        else DB::table('purchase_settings')->insert(array_merge($row, ['id' => (string) Str::uuid(), 'created_at' => now()]));
    }

    private function normalizePurchaseSettingsRow(array $obj): array
    {
        $columns = array_flip(Schema::getColumnListing('purchase_settings'));
        $row = [];
        $put = function (string $column, $value) use (&$row, $columns): void {
            if (isset($columns[$column])) $row[$column] = $value;
        };
        foreach ($obj as $key => $value) $put($key, $value);
        $put('default_vat_pct', $obj['default_vat_percent'] ?? null);
        $put('default_ait_pct', $obj['default_ait_percent'] ?? null);
        $put('po_default_currency', $obj['default_currency'] ?? null);
        $put('enable_lc', $obj['enable_lc_module'] ?? null);
        $put('updated_at', now());
        return array_filter($row, fn($value) => $value !== null);
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
