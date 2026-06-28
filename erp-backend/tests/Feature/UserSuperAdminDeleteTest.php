<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class UserSuperAdminDeleteTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->artisan('migrate', ['--database' => 'sqlite'])->run();
    }

    private function makeUser(array $overrides = []): User
    {
        $employeeId = array_key_exists('employee_id', $overrides)
            ? $overrides['employee_id']
            : $this->makeEmployee();

        $user = new User();
        $user->id = $overrides['id'] ?? (string) Str::uuid();
        $user->username = $overrides['username'] ?? 'user_' . Str::random(6);
        $user->name = $overrides['name'] ?? 'Test User';
        $user->email = $overrides['email'] ?? $user->username . '@test.local';
        $user->password = bcrypt('secret');
        $user->employee_id = $employeeId;
        $user->status = $overrides['status'] ?? 'active';
        $user->save();
        return $user;
    }

    private function makeEmployee(): string
    {
        $employeeId = (string) Str::uuid();
        DB::table('employees')->insert([
            'id' => $employeeId,
            'employee_code' => 'EMP-' . Str::upper(Str::random(8)),
            'first_name' => 'Test',
            'last_name' => 'Employee',
            'joining_date' => now()->toDateString(),
            'employment_type' => 'permanent',
            'salary' => 0,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $employeeId;
    }

    private function giveUserManagementPermissions(User $user): void
    {
        $roleId = (string) Str::uuid();
        DB::table('custom_roles')->insert([
            'id' => $roleId,
            'name' => 'User Manager ' . Str::random(6),
            'description' => 'Can reach user management routes but is not Super Admin',
            'created_at' => now(),
        ]);
        DB::table('role_permissions')->insert([
            'id' => (string) Str::uuid(),
            'custom_role_id' => $roleId,
            'module' => 'users',
            'can_view' => 1,
            'can_add' => 0,
            'can_edit' => 0,
            'can_delete' => 1,
        ]);
        DB::table('user_custom_roles')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'custom_role_id' => $roleId,
        ]);
    }

    public function test_legacy_user_roles_super_admin_can_check_and_delete_user(): void
    {
        $actor = $this->makeUser(['name' => 'Legacy Super Admin']);
        DB::table('user_roles')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $actor->id,
            'role' => 'super_admin',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $target = $this->makeUser(['name' => 'Target User']);

        $this->actingAs($actor)
            ->getJson("/api/v1/users/{$target->id}/check-related")
            ->assertOk()
            ->assertJsonPath('data.has_related_data', false);

        $this->actingAs($actor)
            ->getJson("/api/users/{$target->id}/check-related")
            ->assertOk()
            ->assertJsonPath('data.has_related_data', false);

        $this->actingAs($actor)
            ->deleteJson("/api/v1/users/{$target->id}")
            ->assertOk();

        $this->assertSame('deleted', DB::table('users')->where('id', $target->id)->value('status'));
        $this->assertNotNull(DB::table('users')->where('id', $target->id)->value('deleted_at'));
        $this->assertDatabaseHas('audit_log', [
            'module' => 'users',
            'action' => 'delete',
            'record_id' => $target->id,
            'user_id' => $actor->id,
        ]);
    }

    public function test_non_super_admin_cannot_check_or_delete_user(): void
    {
        $actor = $this->makeUser(['name' => 'Regular Admin']);
        $this->giveUserManagementPermissions($actor);
        $target = $this->makeUser(['name' => 'Target User']);

        $this->actingAs($actor)
            ->getJson("/api/v1/users/{$target->id}/check-related")
            ->assertStatus(403)
            ->assertJsonPath('message', 'Only Super Admin can delete users');

        $this->actingAs($actor)
            ->deleteJson("/api/v1/users/{$target->id}")
            ->assertStatus(403)
            ->assertJsonPath('message', 'Only Super Admin can delete users');

        $this->assertSame('active', DB::table('users')->where('id', $target->id)->value('status'));
    }
}