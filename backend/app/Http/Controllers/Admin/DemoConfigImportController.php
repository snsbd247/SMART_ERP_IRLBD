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
                    'ifrs_line' => $this->normalizeIfrsLine($r['ifrs_line']), 'notes' => $r['notes'] ?? null, 'updated_at' => now(),
                ]);
                $skipped++;
            } else {
                DB::table('ifrs_account_mapping')->insert([
                    'id' => (string) Str::uuid(),
                    'account_id' => $accId,
                    'ifrs_line' => $this->normalizeIfrsLine($r['ifrs_line']),
                    'notes' => $r['notes'] ?? null,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                $inserted++;
            }
        }

        $mappedIds = DB::table('ifrs_account_mapping')->pluck('account_id')->all();
        $unmappedQuery = DB::table('chart_of_accounts')->where('is_active', 1);
        if (!empty($mappedIds)) $unmappedQuery->whereNotIn('id', $mappedIds);
        $unmapped = $unmappedQuery->get(['id', 'account_code', 'account_name', 'account_type']);
        foreach ($unmapped as $a) {
            DB::table('ifrs_account_mapping')->insert([
                'id' => (string) Str::uuid(),
                'account_id' => $a->id,
                'ifrs_line' => $this->inferIfrsLine($a->account_type, (string) $a->account_code, (string) $a->account_name),
                'notes' => 'auto-mapped',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $inserted++;
        }
        return ['attempted' => count($rows), 'inserted' => $inserted, 'skipped' => $skipped];
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
        $row = $this->normalizePurchaseSettingsRow($obj);
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

    /**
     * The Laravel/MySQL deploy table and the legacy preview table have existed in
     * two compatible shapes. Import only columns that are present, while mapping
     * canonical demo keys to the older Laravel column names when needed.
     */
    private function normalizePurchaseSettingsRow(array $obj): array
    {
        $columns = array_flip(Schema::getColumnListing('purchase_settings'));
        $row = [];
        $put = function (string $column, $value) use (&$row, $columns): void {
            if (isset($columns[$column])) $row[$column] = $value;
        };

        foreach ($obj as $key => $value) {
            $put($key, $value);
        }

        $put('default_vat_pct', $obj['default_vat_percent'] ?? null);
        $put('default_ait_pct', $obj['default_ait_percent'] ?? null);
        $put('po_default_currency', $obj['default_currency'] ?? null);
        $put('enable_lc', $obj['enable_lc_module'] ?? null);
        $put('updated_at', now());

        return array_filter($row, fn($value) => $value !== null);
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
