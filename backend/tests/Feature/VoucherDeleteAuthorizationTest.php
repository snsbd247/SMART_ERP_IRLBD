<?php

namespace Tests\Feature;

use App\Models\AccVoucher;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class VoucherDeleteAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->artisan('migrate', ['--database' => 'sqlite'])->run();
    }

    private function makeEmployee(): string
    {
        $employeeId = (string) Str::uuid();
        DB::table('employees')->insert([
            'id' => $employeeId,
            'employee_code' => 'EMP-' . Str::upper(Str::random(8)),
            'first_name' => 'Voucher',
            'last_name' => 'Actor',
            'joining_date' => now()->toDateString(),
            'employment_type' => 'permanent',
            'salary' => 0,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $employeeId;
    }

    private function makeUser(string $name): User
    {
        $user = new User();
        $user->id = (string) Str::uuid();
        $user->username = Str::slug($name) . '_' . Str::lower(Str::random(6));
        $user->name = $name;
        $user->email = $user->username . '@test.local';
        $user->password = bcrypt('secret');
        $user->employee_id = $this->makeEmployee();
        $user->status = 'active';
        $user->save();
        return $user;
    }

    private function giveRole(User $user, string $roleName, array $permissions): void
    {
        $roleId = (string) Str::uuid();
        DB::table('custom_roles')->insert([
            'id' => $roleId,
            'name' => $roleName . ' ' . Str::random(6),
            'description' => $roleName,
            'created_at' => now(),
        ]);
        foreach ($permissions as $module => $flags) {
            DB::table('role_permissions')->insert([
                'id' => (string) Str::uuid(),
                'custom_role_id' => $roleId,
                'module' => $module,
                'can_view' => (int) ($flags['view'] ?? false),
                'can_add' => (int) ($flags['create'] ?? false),
                'can_edit' => (int) ($flags['edit'] ?? false),
                'can_delete' => (int) ($flags['delete'] ?? false),
            ]);
        }
        DB::table('user_custom_roles')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'custom_role_id' => $roleId,
        ]);
    }

    private function makeVoucher(string $type = 'receipt'): AccVoucher
    {
        return AccVoucher::create([
            'id' => (string) Str::uuid(),
            'voucher_number' => Str::upper(substr($type, 0, 2)) . '-' . Str::upper(Str::random(8)),
            'voucher_type' => $type,
            'voucher_date' => now()->toDateString(),
            'description' => 'Delete authorization test',
            'total_amount' => 1250,
            'status' => 'approved',
            'approved_at' => now(),
        ]);
    }

    public function test_accountant_with_receipt_delete_permission_can_soft_delete_receipt_and_audit_is_complete(): void
    {
        $actor = $this->makeUser('Accountant User');
        $this->giveRole($actor, 'Accountant', [
            'receipt' => ['view' => true, 'create' => true, 'edit' => true, 'delete' => true],
        ]);
        $voucher = $this->makeVoucher('receipt');

        Sanctum::actingAs($actor);
        $this->postJson("/api/v1/vouchers/{$voucher->id}/delete-approved", ['reason' => 'duplicate receipt'])
            ->assertOk()
            ->assertJsonPath('data.deleted', true);

        $voucher->refresh();
        $this->assertSame('deleted', $voucher->status);
        $this->assertSame($actor->id, $voucher->deleted_by);
        $this->assertNotNull($voucher->deleted_at);

        $audit = DB::table('audit_log')
            ->where('module', 'accounting_vouchers')
            ->where('action', 'voucher_soft_deleted')
            ->where('record_id', $voucher->id)
            ->first();

        $this->assertNotNull($audit);
        $this->assertSame($actor->id, $audit->user_id);
        $this->assertStringContainsString('Accountant', (string) $audit->details);
        $this->assertStringContainsString($voucher->voucher_number, (string) $audit->details);
        $this->assertStringContainsString('duplicate receipt', (string) $audit->details);
        $this->assertNotNull($audit->created_at, 'Audit timestamp must be recorded.');

        $newData = json_decode((string) $audit->new_data, true);
        $this->assertSame('deleted', $newData['status']);
        $this->assertSame('receipt', $newData['voucher_type']);
        $this->assertSame($actor->id, $newData['deleted_by']);
        // giveRole() suffixes role names with a random tag (e.g. "Accountant x7Kq2a").
        $this->assertTrue(
            collect($newData['actor_roles'])->contains(fn ($r) => str_starts_with($r, 'Accountant ')),
            'actor_roles must include the Accountant role.'
        );
    }

    public function test_role_without_delete_permission_cannot_delete_receipt(): void
    {
        $actor = $this->makeUser('Viewer User');
        $this->giveRole($actor, 'Receipt Viewer', [
            'receipt' => ['view' => true, 'create' => false, 'edit' => false, 'delete' => false],
        ]);
        $voucher = $this->makeVoucher('receipt');

        Sanctum::actingAs($actor);
        $this->postJson("/api/v1/vouchers/{$voucher->id}/delete-approved", ['reason' => 'try delete'])
            ->assertStatus(403);

        $voucher->refresh();
        $this->assertSame('approved', $voucher->status);
        $this->assertNull($voucher->deleted_at);
    }

    public function test_wrong_per_type_delete_permission_cannot_delete_receipt(): void
    {
        $actor = $this->makeUser('Journal Delete User');
        $this->giveRole($actor, 'Journal Delete Only', [
            'journal' => ['view' => true, 'create' => true, 'edit' => true, 'delete' => true],
        ]);
        $voucher = $this->makeVoucher('receipt');

        Sanctum::actingAs($actor);
        $this->postJson("/api/v1/vouchers/{$voucher->id}/delete-approved", ['reason' => 'wrong type'])
            ->assertStatus(403)
            ->assertJsonPath('message', 'You do not have permission to delete this voucher.');

        $voucher->refresh();
        $this->assertSame('approved', $voucher->status);
        $this->assertNull($voucher->deleted_at);
    }

    /**
     * Role authorization matrix — Admin/Manager/Viewer against every voucher type.
     * `accounts.delete` (Admin umbrella) grants delete on ALL types; edit-only
     * (Manager) and view-only (Viewer) MUST be rejected with 403.
     *
     * @dataProvider roleMatrixProvider
     */
    public function test_role_matrix_delete_authorization(
        string $roleLabel,
        array $permissions,
        string $voucherType,
        bool $expectAllowed,
    ): void {
        $actor = $this->makeUser($roleLabel . ' Actor');
        $this->giveRole($actor, $roleLabel, $permissions);
        $voucher = $this->makeVoucher($voucherType);

        Sanctum::actingAs($actor);
        $response = $this->postJson(
            "/api/v1/vouchers/{$voucher->id}/delete-approved",
            ['reason' => "matrix:{$roleLabel}:{$voucherType}"]
        );

        if ($expectAllowed) {
            $response->assertOk()->assertJsonPath('data.deleted', true);
            $voucher->refresh();
            $this->assertSame('deleted', $voucher->status, "{$roleLabel} should soft-delete {$voucherType}");
            $this->assertSame($actor->id, $voucher->deleted_by);
        } else {
            $response->assertStatus(403);
            $voucher->refresh();
            $this->assertSame('approved', $voucher->status, "{$roleLabel} must NOT delete {$voucherType}");
            $this->assertNull($voucher->deleted_at);
        }
    }

    public static function roleMatrixProvider(): array
    {
        $admin   = ['accounts' => ['view' => true, 'create' => true, 'edit' => true, 'delete' => true]];
        $manager = ['accounts' => ['view' => true, 'create' => true, 'edit' => true, 'delete' => false]];
        $viewer  = ['accounts' => ['view' => true, 'create' => false, 'edit' => false, 'delete' => false]];
        $rows = [];
        foreach (['journal', 'payment', 'receipt', 'contra'] as $t) {
            $rows["admin_can_delete_{$t}"]      = ['Admin',   $admin,   $t, true];
            $rows["manager_cannot_delete_{$t}"] = ['Manager', $manager, $t, false];
            $rows["viewer_cannot_delete_{$t}"]  = ['Viewer',  $viewer,  $t, false];
        }
        return $rows;
    }

    public function test_audit_log_fields_are_fully_populated_on_soft_delete(): void
    {
        $actor = $this->makeUser('Full Audit Admin');
        $this->giveRole($actor, 'Admin Full', [
            'accounts' => ['view' => true, 'create' => true, 'edit' => true, 'delete' => true],
        ]);
        $voucher = $this->makeVoucher('receipt');
        $beforeDelete = now()->subSecond();

        Sanctum::actingAs($actor);
        $this->withHeaders(['User-Agent' => 'AuditTest/1.0'])
            ->postJson("/api/v1/vouchers/{$voucher->id}/delete-approved", ['reason' => 'audit field check'])
            ->assertOk();

        $audit = DB::table('audit_log')
            ->where('action', 'voucher_soft_deleted')
            ->where('record_id', $voucher->id)
            ->first();

        $this->assertNotNull($audit, 'Audit row must exist.');
        $this->assertSame($actor->id, $audit->user_id);
        $this->assertSame($actor->name, $audit->user_name);
        $this->assertSame('accounting_vouchers', $audit->module);
        $this->assertNotNull($audit->created_at);
        $this->assertGreaterThanOrEqual(
            $beforeDelete->getTimestamp(),
            \Carbon\Carbon::parse($audit->created_at)->getTimestamp(),
        );

        $this->assertStringContainsString($voucher->voucher_number, (string) $audit->details);
        $this->assertStringContainsString($voucher->voucher_type, (string) $audit->details);
        $this->assertStringContainsString('Admin Full', (string) $audit->details);
        $this->assertStringContainsString('audit field check', (string) $audit->details);

        $old = json_decode((string) $audit->old_data, true);
        $new = json_decode((string) $audit->new_data, true);
        $this->assertSame($voucher->id, $old['voucher_id']);
        $this->assertSame('approved', $old['status']);
        $this->assertSame($voucher->voucher_number, $new['voucher_number']);
        $this->assertSame('receipt', $new['voucher_type']);
        $this->assertSame('deleted', $new['status']);
        $this->assertSame('approved', $new['prev_status']);
        $this->assertSame($actor->id, $new['deleted_by']);
        $this->assertNotEmpty($new['deleted_at']);
        $this->assertSame('audit field check', $new['reason']);
        $this->assertIsArray($new['actor_roles']);
        $this->assertNotEmpty($new['actor_roles']);
    }
}