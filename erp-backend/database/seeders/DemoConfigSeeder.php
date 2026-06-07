<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * DemoConfigSeeder
 *
 * Imports the canonical demo configuration bundle from
 *   database/seeders/data/demo_config_seed.json
 *
 * Sections (all idempotent — safe to re-run on existing installs):
 *   1. Chart of Accounts          → chart_of_accounts (by account_code)
 *   2. IFRS Account Mapping       → ifrs_account_mapping (by account_id)
 *   3. Document Numbering         → number_sequences (by id)
 *   4. Page Shortcuts             → page_shortcuts (by shortcut_code)
 *   5. Roles & Permissions        → custom_roles (by name) + role_permissions
 *
 * No transactional data is touched.
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

        $this->seedChartOfAccounts($seed['coa'] ?? []);
        $this->seedIfrsMapping($seed['ifrs'] ?? []);
        $this->seedNumberSequences($seed['sequences'] ?? []);
        $this->seedPageShortcuts($seed['shortcuts'] ?? []);
        $this->seedRolesAndPermissions($seed['roles'] ?? []);
    }

    /* ---------------- Chart of Accounts ---------------- */
    private function seedChartOfAccounts(array $rows): void
    {
        if (empty($rows)) return;

        // Insert any missing accounts (parent_id resolved in second pass)
        foreach ($rows as $r) {
            $exists = DB::table('chart_of_accounts')->where('account_code', $r['account_code'])->exists();
            if ($exists) continue;
            DB::table('chart_of_accounts')->insert([
                'id' => (string) Str::uuid(),
                'account_code' => $r['account_code'],
                'account_name' => $r['account_name'],
                'account_type' => $r['account_type'],
                'opening_balance_type' => $r['opening_balance_type'] ?? 'debit',
                'parent_id' => null,
            ]);
        }

        // Resolve parent links
        $codeToId = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        foreach ($rows as $r) {
            if (empty($r['parent_code'])) continue;
            $id = $codeToId[$r['account_code']] ?? null;
            $parentId = $codeToId[$r['parent_code']] ?? null;
            if (!$id || !$parentId) continue;
            DB::table('chart_of_accounts')
                ->where('id', $id)
                ->whereNull('parent_id')
                ->update(['parent_id' => $parentId]);
        }

        $this->command?->info('  ✓ Chart of Accounts seeded (' . count($rows) . ' entries)');
    }

    /* ---------------- IFRS Mapping ---------------- */
    private function seedIfrsMapping(array $rows): void
    {
        if (empty($rows)) return;
        if (!\Schema::hasTable('ifrs_account_mapping')) return;

        $codeToId = DB::table('chart_of_accounts')->pluck('id', 'account_code');
        foreach ($rows as $r) {
            $accId = $codeToId[$r['account_code']] ?? null;
            if (!$accId) continue;
            DB::table('ifrs_account_mapping')->updateOrInsert(
                ['account_id' => $accId],
                [
                    'id' => (string) Str::uuid(),
                    'ifrs_line' => $r['ifrs_line'],
                    'notes' => $r['notes'] ?? null,
                    'updated_at' => now(),
                    'created_at' => now(),
                ]
            );
        }
        $this->command?->info('  ✓ IFRS mappings seeded (' . count($rows) . ' entries)');
    }

    /* ---------------- Number Sequences ---------------- */
    private function seedNumberSequences(array $rows): void
    {
        foreach ($rows as $s) {
            DB::table('number_sequences')->updateOrInsert(
                ['id' => $s['id']],
                [
                    'prefix' => $s['prefix'],
                    'current_number' => $s['current_number'] ?? 0,
                    'year' => $s['year'] ?? (int) date('Y'),
                    'description' => $s['description'] ?? null,
                ]
            );
        }
        $this->command?->info('  ✓ Number sequences seeded (' . count($rows) . ' entries)');
    }

    /* ---------------- Page Shortcuts ---------------- */
    private function seedPageShortcuts(array $rows): void
    {
        foreach ($rows as $s) {
            DB::table('page_shortcuts')->updateOrInsert(
                ['shortcut_code' => $s['shortcut_code']],
                [
                    'id' => (string) Str::uuid(),
                    'page_name' => $s['page_name'],
                    'page_url' => $s['page_url'],
                    'module_name' => $s['module_name'],
                    'is_active' => !empty($s['is_active']) ? 1 : 0,
                    'updated_at' => now(),
                    'created_at' => now(),
                ]
            );
        }
        $this->command?->info('  ✓ Page shortcuts seeded (' . count($rows) . ' entries)');
    }

    /* ---------------- Roles & Permissions ---------------- */
    private function seedRolesAndPermissions(array $roles): void
    {
        foreach ($roles as $role) {
            $existing = DB::table('custom_roles')->where('name', $role['name'])->first();
            if ($existing) {
                $roleId = $existing->id;
            } else {
                $roleId = (string) Str::uuid();
                DB::table('custom_roles')->insert([
                    'id' => $roleId,
                    'name' => $role['name'],
                    'description' => $role['description'] ?? null,
                ]);
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
        $this->command?->info('  ✓ Roles & permissions seeded (' . count($roles) . ' roles)');
    }
}
