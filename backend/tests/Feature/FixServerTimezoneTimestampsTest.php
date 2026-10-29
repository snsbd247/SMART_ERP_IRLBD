<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FixServerTimezoneTimestampsTest extends TestCase
{
    use RefreshDatabase;

    private function audit(string $module, string $action, string $createdAt): string
    {
        $id = (string) Str::uuid();
        DB::table('audit_log')->insert(['id' => $id, 'module' => $module, 'action' => $action, 'created_at' => $createdAt]);
        return $id;
    }

    public function test_converts_only_db_default_rows_in_window_and_refuses_rerun(): void
    {
        Storage::fake();

        $server = $this->audit('accounting_vouchers', 'voucher_soft_deleted', '2026-10-28 01:47:30');   // EDT
        $frontend = $this->audit('accounting', 'voucher_create_balance_impact', '2026-10-28 11:47:30'); // already Dhaka
        $usersEdit = $this->audit('users', 'edit', '2026-09-01 02:00:00');                              // EDT
        $frontendEdit = $this->audit('vat_challan', 'edit', '2026-09-01 12:00:00');                     // Dhaka
        $restored = $this->audit('accounting_vouchers', 'voucher_soft_deleted', '2026-07-01 03:00:00'); // before go-live
        $afterFix = $this->audit('accounting_vouchers', 'voucher_soft_deleted', '2026-10-29 14:00:00'); // after --before

        $args = ['--before' => '2026-10-29 04:00:00'];
        $this->artisan('timestamps:fix-server-timezone', $args)->assertSuccessful();

        $at = fn ($id) => DB::table('audit_log')->where('id', $id)->value('created_at');
        $this->assertSame('2026-10-28 11:47:30', $at($server), 'EDT -> Dhaka is +10h during US DST');
        $this->assertSame('2026-09-01 12:00:00', $at($usersEdit));
        $this->assertSame('2026-10-28 11:47:30', $at($frontend), 'frontend-logged rows are untouched');
        $this->assertSame('2026-09-01 12:00:00', $at($frontendEdit));
        $this->assertSame('2026-07-01 03:00:00', $at($restored), 'rows from before go-live are untouched');
        $this->assertSame('2026-10-29 14:00:00', $at($afterFix), 'rows written after the fix are untouched');

        $this->assertTrue(Storage::exists('tz-fix/done.json'));
        $this->artisan('timestamps:fix-server-timezone', $args)->assertFailed();
        $this->assertSame('2026-10-28 11:47:30', $at($server), 'second run must not shift again');
    }

    public function test_dry_run_writes_nothing(): void
    {
        Storage::fake();
        $id = $this->audit('accounting_vouchers', 'voucher_type_changed', '2026-08-10 05:00:00');

        $this->artisan('timestamps:fix-server-timezone', ['--dry-run' => true, '--before' => '2026-10-29 04:00:00'])->assertSuccessful();

        $this->assertSame('2026-08-10 05:00:00', DB::table('audit_log')->where('id', $id)->value('created_at'));
        $this->assertFalse(Storage::exists('tz-fix/done.json'));
    }

    public function test_models_without_timestamps_get_app_time_created_at(): void
    {
        $this->travelTo(now()->setTimezone(config('app.timezone'))->setTime(13, 39, 20));

        $log = \App\Models\AuditLog::create(['module' => 'tz', 'action' => 'probe', 'user_name' => 'x']);

        $this->assertSame(now()->format('Y-m-d H:i:s'), DB::table('audit_log')->where('id', $log->id)->value('created_at'));
    }
}
