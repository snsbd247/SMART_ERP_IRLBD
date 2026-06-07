<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * CanonicalRolesSeeder
 *
 * Idempotent (Safe Extension): reads the same demo_config_seed.json used by
 * the Demo Import UI and upserts the 7 canonical roles + 231 permission rows.
 *
 * Super Admin is NOT seeded as a custom role — it is the hardcoded user with
 * employee_id = NULL that bypasses all permission checks.
 *
 * Run with:
 *   php artisan db:seed --class=CanonicalRolesSeeder
 *
 * Safe to re-run: existing roles are matched by name and their permission
 * rows are upserted on (custom_role_id, module).
 */
class CanonicalRolesSeeder extends Seeder
{
    public function run(): void
    {
        $path = database_path('seeders/data/demo_config_seed.json');
        if (!file_exists($path)) {
            $this->command->error("Seed file missing: {$path}");
            return;
        }

        $seed = json_decode(file_get_contents($path), true);
        $roles = $seed['roles'] ?? [];

        if (empty($roles)) {
            $this->command->warn('No roles found in seed file.');
            return;
        }

        $rolesInserted = 0; $rolesExisting = 0; $permsUpserted = 0;

        DB::transaction(function () use ($roles, &$rolesInserted, &$rolesExisting, &$permsUpserted) {
            foreach ($roles as $role) {
                $existing = DB::table('custom_roles')->where('name', $role['name'])->first();

                if ($existing) {
                    $roleId = $existing->id;
                    $rolesExisting++;
                    DB::table('custom_roles')
                        ->where('id', $roleId)
                        ->update(['description' => $role['description'], 'updated_at' => now()]);
                } else {
                    $roleId = DB::table('custom_roles')->insertGetId([
                        'name' => $role['name'],
                        'description' => $role['description'],
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                    $rolesInserted++;
                }

                foreach ($role['permissions'] as $p) {
                    DB::table('role_permissions')->updateOrInsert(
                        ['custom_role_id' => $roleId, 'module' => $p['module']],
                        [
                            'can_view'   => (bool) $p['can_view'],
                            'can_add'    => (bool) $p['can_add'],
                            'can_edit'   => (bool) $p['can_edit'],
                            'can_delete' => (bool) $p['can_delete'],
                            'updated_at' => now(),
                            'created_at' => now(),
                        ]
                    );
                    $permsUpserted++;
                }
            }
        });

        $this->command->info("Canonical Roles seeded:");
        $this->command->info("  Roles inserted : {$rolesInserted}");
        $this->command->info("  Roles updated  : {$rolesExisting}");
        $this->command->info("  Permission rows upserted: {$permsUpserted}");
    }
}
