<?php

namespace Tests\Feature;

use App\Models\AccVoucher;
use App\Models\CustomRole;
use App\Models\RolePermission;
use App\Models\User;
use App\Models\VoucherApprovalHistory;
use App\Models\AuditLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Integration test for RBAC on voucher approval + a representative file-upload endpoint.
 *
 *  - Super Admin (employee_id NULL) → may approve, reject and upload.
 *  - Regular user WITHOUT accounts.edit → blocked from approve/reject.
 *  - Regular user WITHOUT hrm.create → blocked from photo upload.
 *  - Approval action must write rows to voucher_approval_history AND audit_log
 *    capturing actor, timestamp, and before/after status.
 */
class VoucherApprovalRbacTest extends TestCase
{
    use RefreshDatabase;

    protected function superAdmin(): User
    {
        return User::forceCreate([
            'id' => (string) Str::uuid(),
            'username' => 'super_'. Str::random(4),
            'name' => 'Super',
            'email' => 'super_'. Str::random(4) .'@t.local',
            'password' => Hash::make('x'),
            'employee_id' => null,
            'status' => 'active',
        ]);
    }

    protected function userWithPermission(?string $module, ?string $action): User
    {
        // employee_id NOT NULL → regular user
        $u = User::forceCreate([
            'id' => (string) Str::uuid(),
            'username' => 'u_'. Str::random(5),
            'name' => 'User',
            'email' => 'u_'. Str::random(5) .'@t.local',
            'password' => Hash::make('x'),
            'employee_id' => (string) Str::uuid(),
            'status' => 'active',
        ]);
        if ($module) {
            $role = CustomRole::create(['id' => (string) Str::uuid(), 'name' => 'R_'. Str::random(5)]);
            $col = match ($action) {
                'view' => 'can_view', 'create' => 'can_add', 'edit' => 'can_edit', 'delete' => 'can_delete',
            };
            RolePermission::create([
                'id' => (string) Str::uuid(),
                'custom_role_id' => $role->id,
                'module' => $module,
                'can_view' => 0, 'can_add' => 0, 'can_edit' => 0, 'can_delete' => 0,
                $col => 1,
            ]);
            \DB::table('user_custom_roles')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $u->id,
                'custom_role_id' => $role->id,
            ]);
        }
        return $u;
    }

    protected function makeVoucher(?string $createdBy = null): AccVoucher
    {
        return AccVoucher::create([
            'id' => (string) Str::uuid(),
            'voucher_number' => 'JV-T-'. Str::random(5),
            'voucher_type' => 'journal',
            'voucher_date' => now()->toDateString(),
            'total_amount' => 100,
            'status' => 'pending',
            'created_by' => $createdBy,
        ]);
    }

    public function test_super_admin_can_approve_and_history_is_written(): void
    {
        $super = $this->superAdmin();
        $v = $this->makeVoucher();

        $res = $this->actingAs($super, 'sanctum')
            ->postJson("/api/v1/vouchers/{$v->id}/approve", ['note' => 'looks good']);

        $res->assertOk();
        $this->assertSame('approved', $v->fresh()->status);

        $hist = VoucherApprovalHistory::where('voucher_id', $v->id)->first();
        $this->assertNotNull($hist, 'approval history row should exist');
        $this->assertSame('approve', $hist->action);
        $this->assertSame('pending', $hist->before_status);
        $this->assertSame('approved', $hist->after_status);
        $this->assertSame($super->id, $hist->actor_user_id);
        $this->assertSame('looks good', $hist->note);
        $this->assertNotNull($hist->created_at);

        $audit = AuditLog::where('module', 'vouchers')->where('record_id', $v->id)->first();
        $this->assertNotNull($audit, 'audit_log row should exist');
        $this->assertSame('approve', $audit->action);
    }

    public function test_super_admin_can_reject_with_note(): void
    {
        $super = $this->superAdmin();
        $v = $this->makeVoucher();

        $this->actingAs($super, 'sanctum')
            ->postJson("/api/v1/vouchers/{$v->id}/reject", ['note' => 'missing receipts'])
            ->assertOk();

        $this->assertSame('rejected', $v->fresh()->status);
        $this->assertDatabaseHas('voucher_approval_history', [
            'voucher_id' => $v->id,
            'action' => 'reject',
            'after_status' => 'rejected',
            'note' => 'missing receipts',
        ]);
    }

    public function test_user_without_accounts_edit_cannot_approve(): void
    {
        $u = $this->userWithPermission('accounts', 'view'); // view-only
        $v = $this->makeVoucher();

        $this->actingAs($u, 'sanctum')
            ->postJson("/api/v1/vouchers/{$v->id}/approve", ['note' => 'nope'])
            ->assertStatus(403);

        $this->assertSame('pending', $v->fresh()->status);
        $this->assertDatabaseCount('voucher_approval_history', 0);
    }

    public function test_user_with_accounts_edit_can_approve(): void
    {
        $u = $this->userWithPermission('accounts', 'edit');
        $v = $this->makeVoucher();

        $this->actingAs($u, 'sanctum')
            ->postJson("/api/v1/vouchers/{$v->id}/approve")
            ->assertOk();

        $this->assertSame('approved', $v->fresh()->status);
    }

    public function test_pending_endpoint_requires_accounts_view(): void
    {
        $denied = $this->userWithPermission(null, null);
        $this->actingAs($denied, 'sanctum')
            ->getJson('/api/v1/vouchers/pending')
            ->assertStatus(403);

        $allowed = $this->userWithPermission('accounts', 'view');
        $this->makeVoucher();
        $this->actingAs($allowed, 'sanctum')
            ->getJson('/api/v1/vouchers/pending')
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->actingAs($allowed, 'sanctum')
            ->getJson('/api/v1/vouchers/not-a-valid-voucher-id')
            ->assertNotFound();
    }

    public function test_file_upload_endpoint_enforces_hrm_create(): void
    {
        // Employee photo upload requires `hrm.create`.
        $denied = $this->userWithPermission('hrm', 'view');
        $this->actingAs($denied, 'sanctum')
            ->postJson('/api/v1/employees/00000000-0000-0000-0000-000000000000/upload-photo', [])
            ->assertStatus(403);
    }
}
