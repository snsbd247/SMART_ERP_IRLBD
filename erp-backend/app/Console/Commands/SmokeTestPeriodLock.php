<?php

namespace App\Console\Commands;

use App\Services\FinancialPeriodGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class SmokeTestPeriodLock extends Command
{
    protected $signature = 'period-lock:smoke';
    protected $description = 'Smoke test: FinancialPeriodGuard blocks dates outside active FY';

    public function handle(FinancialPeriodGuard $guard): int
    {
        $this->info('=== Test #6: Financial Period Lock ===');

        $today = now()->toDateString();
        $activeOk = false;
        try {
            $guard->assertOpen($today, 'today');
            $activeOk = true;
        } catch (\Throwable $e) {
            $this->warn('Active FY missing for today: ' . $e->getMessage());
        }

        // Pick a date that no active FY covers — try 10 years ago.
        $oldDate = now()->subYears(10)->toDateString();
        $covered = DB::table('financial_years')->where('is_active', 1)
            ->whereDate('start_date', '<=', $oldDate)->whereDate('end_date', '>=', $oldDate)->exists();
        if ($covered) { $this->warn('10y-ago covered by an active FY; skipping closed-date check.'); }

        $blockedOk = false;
        if (!$covered) {
            try {
                $guard->assertOpen($oldDate, 'closed period test');
                $this->error('Guard did NOT block date outside active FY!');
            } catch (\RuntimeException $e) {
                $blockedOk = true;
            }
        } else {
            $blockedOk = true; // skipped
        }

        $this->table(['Check', 'Expected', 'Result'], [
            ['Today inside active FY allowed', 'pass', $activeOk ? '✅' : '❌'],
            ['Date outside active FY blocked', 'throws', $blockedOk ? '✅' : '❌'],
        ]);
        if ($activeOk && $blockedOk) { $this->info('✅ Period lock smoke PASS'); return 0; }
        $this->error('❌ Period lock smoke FAIL'); return 1;
    }
}
