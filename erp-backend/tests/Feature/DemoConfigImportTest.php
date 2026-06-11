<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Integration tests for App\Http\Controllers\Admin\DemoConfigImportController.
 *
 * Verifies that both KEEP and RESET modes import all 14 sections correctly,
 * that dry-run mode rolls back without persisting, and that section filtering
 * + audit logging work as expected.
 *
 * Runs against an in-memory SQLite DB (see phpunit.xml).
 */
class DemoConfigImportTest extends TestCase
{
    use RefreshDatabase;

    /** Section keys the controller is expected to handle. */
    private const SECTIONS = [
        'chart_of_accounts', 'ifrs_account_mapping', 'purchase_types', 'purchase_coa_mapping',
        'purchase_settings', 'branches', 'financial_years', 'roles_permissions',
        'github_deploy_sync', 'number_sequences', 'page_shortcuts', 'company_settings',
        'sms_settings', 'branding',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        // Run full migrations so every table the controller may touch exists.
        $this->artisan('migrate', ['--database' => 'sqlite'])->run();
    }

    /** Authenticate a super-admin user (employee_id NULL ⇒ super admin per project rules). */
    private function actAsSuperAdmin(): \App\Models\User
    {
        $user = new \App\Models\User();
        $user->id          = (string) Str::uuid();
        $user->username    = 'super_'. Str::random(5);
        $user->name        = 'Test Super Admin';
        $user->email       = 'super@test.local';
        $user->password    = bcrypt('secret');
        $user->employee_id = null;
        $user->save();
        $this->actingAs($user);
        return $user;
    }

    public function test_keep_mode_imports_all_14_sections(): void
    {
        $this->actAsSuperAdmin();

        $res = $this->postJson('/api/v1/admin/demo/import-config', [
            'reset'   => false,
            'dry_run' => false,
        ]);

        $res->assertOk();
        $data = $res->json();
        $this->assertSame('keep', $data['mode']);
        $this->assertFalse($data['dry_run']);
        $this->assertCount(14, $data['results']);

        $returnedKeys = array_map(fn ($r) => $r['section'], $data['results']);
        sort($returnedKeys);
        $expected = self::SECTIONS; sort($expected);
        $this->assertSame($expected, $returnedKeys);

        // Every section finished without 'failed' status.
        foreach ($data['results'] as $r) {
            $this->assertNotSame('failed', $r['status'], "Section {$r['section']} failed: " . ($r['error'] ?? ''));
        }

        // Spot-check writes actually landed:
        $this->assertGreaterThan(0, DB::table('chart_of_accounts')->count());
        $this->assertGreaterThan(0, DB::table('branches')->count());
        $this->assertGreaterThan(0, DB::table('purchase_types')->count());
        $this->assertGreaterThan(0, DB::table('custom_roles')->count());
    }

    public function test_reset_mode_clears_then_reimports(): void
    {
        $this->actAsSuperAdmin();

        // Pre-populate a stale row that reset should wipe.
        DB::table('chart_of_accounts')->insert([
            'id' => (string) Str::uuid(),
            'account_code' => 'STALE-001', 'account_name' => 'Stale ledger',
            'account_type' => 'asset', 'opening_balance' => 0,
            'opening_balance_type' => 'debit', 'is_active' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->assertTrue(DB::table('chart_of_accounts')->where('account_code', 'STALE-001')->exists());

        $res = $this->postJson('/api/v1/admin/demo/import-config', [
            'reset'   => true,
            'dry_run' => false,
        ]);

        $res->assertOk();
        $this->assertSame('reset', $res->json('mode'));
        $this->assertFalse(DB::table('chart_of_accounts')->where('account_code', 'STALE-001')->exists(),
            'Reset should have removed stale CoA row.');
        $this->assertGreaterThan(0, DB::table('chart_of_accounts')->count(),
            'Reset should have re-imported the seed CoA.');
    }

    public function test_dry_run_returns_counts_but_persists_nothing(): void
    {
        $this->actAsSuperAdmin();
        $countBefore = DB::table('chart_of_accounts')->count();

        $res = $this->postJson('/api/v1/admin/demo/import-config', [
            'reset'   => false,
            'dry_run' => true,
        ]);

        $res->assertOk();
        $this->assertTrue($res->json('dry_run'));
        $this->assertGreaterThan(0, $res->json('total_inserted'),
            'Dry-run should report would-be inserts.');
        $this->assertSame($countBefore, DB::table('chart_of_accounts')->count(),
            'Dry-run must not write to the database.');
        $this->assertSame(0, DB::table('audit_log')->where('action', 'like', 'demo_config_%')->count(),
            'Dry-run must not write an audit_log entry.');
    }

    public function test_section_filter_only_runs_selected_sections(): void
    {
        $this->actAsSuperAdmin();

        $res = $this->postJson('/api/v1/admin/demo/import-config', [
            'reset'    => false,
            'dry_run'  => false,
            'sections' => ['chart_of_accounts', 'branches'],
        ]);

        $res->assertOk();
        $sections = array_map(fn ($r) => $r['section'], $res->json('results'));
        sort($sections);
        $this->assertSame(['branches', 'chart_of_accounts'], $sections);
        $this->assertCount(2, $res->json('results'));
    }

    public function test_audit_log_records_mode_user_and_sections(): void
    {
        $user = $this->actAsSuperAdmin();

        $this->postJson('/api/v1/admin/demo/import-config', [
            'reset'   => false,
            'dry_run' => false,
        ])->assertOk();

        $log = DB::table('audit_log')
            ->where('module', 'backup')
            ->where('action', 'demo_config_import')
            ->orderByDesc('created_at')
            ->first();

        $this->assertNotNull($log, 'Audit log row should be written on real import.');
        $this->assertSame($user->id, $log->user_id);
        $payload = json_decode($log->new_data, true);
        $this->assertSame('keep', $payload['mode']);
        $this->assertCount(14, $payload['imported_sections']);
        $this->assertContains('chart_of_accounts', $payload['imported_sections']);
    }

    public function test_non_super_admin_is_forbidden(): void
    {
        $user = new \App\Models\User();
        $user->id          = (string) Str::uuid();
        $user->name        = 'Regular';
        $user->email       = 'regular@test.local';
        $user->password    = bcrypt('secret');
        $user->employee_id = (string) Str::uuid(); // non-null = NOT super admin
        $user->save();
        $this->actingAs($user);

        $this->postJson('/api/v1/admin/demo/import-config', [])
            ->assertStatus(403);
    }
}
