<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Test #7: RBAC Permission Matrix
 *  - Super Admin (employee_id NULL) → bypasses every check.
 *  - Regular user with role granting only sales.view → sales.view=true, sales.create=false, purchase.view=false.
 *  - Regular user with no role → all denied.
 */
class SmokeTestRbacMatrix extends Command
{
    protected $signature = 'rbac:smoke';
    protected $description = 'Smoke test: RBAC permission matrix (Super Admin bypass + module.action checks)';

    public function handle(): int
    {
        $this->info('=== Test #7: RBAC Permission Matrix ===');

        // 1. Super Admin
        $super = User::whereNull('employee_id')->first();
        if (!$super) {
            $this->error('No Super Admin found (user with employee_id=NULL). Aborting.');
            return 1;
        }

        // 2. Demo employee + scoped user
        $branchId = DB::table('branches')->where('status', 'active')->value('id');
        $emp = DB::table('employees')->where('employee_code', 'EMP-SMK-001')->first();
        if (!$emp) {
            $this->error('Run payroll:smoke first to seed EMP-SMK-001.');
            return 1;
        }

        $scopedEmail = 'rbac.smoke@test.local';
        $scoped = User::withTrashed()->where('email', $scopedEmail)->first();
        if (!$scoped) {
            $scopedId = (string) Str::uuid();
            DB::table('users')->insert([
                'id' => $scopedId,
                'username' => 'rbac_smoke',
                'name' => 'RBAC Smoke',
                'email' => $scopedEmail,
                'password' => Hash::make(Str::random(24)),
                'employee_id' => $emp->id,
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $scoped = User::findOrFail($scopedId);
        } else {
            DB::table('users')->where('id', $scoped->id)->update([
                'username' => 'rbac_smoke',
                'employee_id' => $emp->id,
                'status' => 'active',
                'deleted_at' => null,
                'updated_at' => now(),
            ]);
            $scoped = User::findOrFail($scoped->id);
        }

        $noRoleEmail = 'rbac.norole@test.local';
        $noRole = User::withTrashed()->where('email', $noRoleEmail)->first();
        if (!$noRole) {
            $noRoleId = (string) Str::uuid();
            DB::table('users')->insert([
                'id' => $noRoleId,
                'username' => 'rbac_norole',
                'name' => 'RBAC NoRole',
                'email' => $noRoleEmail,
                'password' => Hash::make(Str::random(24)),
                'employee_id' => $emp->id,
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $noRole = User::findOrFail($noRoleId);
        } else {
            DB::table('users')->where('id', $noRole->id)->update([
                'username' => 'rbac_norole',
                'employee_id' => $emp->id,
                'status' => 'active',
                'deleted_at' => null,
                'updated_at' => now(),
            ]);
            $noRole = User::findOrFail($noRole->id);
        }

        // 3. Custom role: sales.view only
        $roleId = DB::table('custom_roles')->where('name', 'SMK_SalesViewer')->value('id');
        if (!$roleId) {
            $roleId = (string) Str::uuid();
            DB::table('custom_roles')->insert([
                'id' => $roleId, 'name' => 'SMK_SalesViewer',
                'description' => 'Smoke test: sales view only',
            ]);
        }
        DB::table('role_permissions')->where('custom_role_id', $roleId)->delete();
        DB::table('role_permissions')->insert([
            'id' => (string) Str::uuid(), 'custom_role_id' => $roleId, 'module' => 'sales',
            'can_view' => 1, 'can_add' => 0, 'can_edit' => 0, 'can_delete' => 0,
        ]);

        // Attach role
        DB::table('user_custom_roles')->where('user_id', $scoped->id)->delete();
        DB::table('user_custom_roles')->insert([
            'id' => (string) Str::uuid(), 'user_id' => $scoped->id, 'custom_role_id' => $roleId,
        ]);
        DB::table('user_custom_roles')->where('user_id', $noRole->id)->delete();

        // 4. Assert matrix
        $cases = [
            ['Super Admin',       $super,  'sales.view',     true],
            ['Super Admin',       $super,  'purchase.delete',true],
            ['Sales Viewer',      $scoped, 'sales.view',     true],
            ['Sales Viewer',      $scoped, 'sales.create',   false],
            ['Sales Viewer',      $scoped, 'sales.delete',   false],
            ['Sales Viewer',      $scoped, 'purchase.view',  false],
            ['No-Role User',      $noRole, 'sales.view',     false],
            ['No-Role User',      $noRole, 'users.edit',     false],
        ];

        $rows = []; $allOk = true;
        foreach ($cases as [$label, $user, $perm, $expected]) {
            $user->load('roles');
            $actual = $user->hasPermission($perm);
            $ok = $actual === $expected;
            $allOk = $allOk && $ok;
            $rows[] = [$label, $perm, $expected ? 'allow' : 'deny',
                $actual ? 'allow' : 'deny', $ok ? '✅' : '❌'];
        }

        $this->table(['User', 'Permission', 'Expected', 'Actual', 'OK'], $rows);

        if ($allOk) { $this->info('✅ RBAC matrix smoke PASS'); return 0; }
        $this->error('❌ RBAC matrix smoke FAIL'); return 1;
    }
}
