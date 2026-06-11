<?php

namespace App\Console;

use App\Console\Commands\RunPhpUnitTest;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected $commands = [
        RunPhpUnitTest::class,
    ];

    protected function schedule(Schedule $schedule): void
    {
        // Mark users offline if inactive for >2 minutes
        $schedule->command('users:mark-offline')->everyTwoMinutes();

        // Automated daily SQL backup at 2 AM (uploads to Google Drive if enabled)
        $schedule->command('backup:database --type=auto --format=sql --gdrive=auto')->dailyAt('02:00');
        // Companion daily JSON backup at 2:15 AM
        $schedule->command('backup:database --type=auto --format=json --gdrive=auto')->dailyAt('02:15');

        // Weekly legacy purchases cleanup (after 60-day verification window).
        // Logs cleanup_failed / cleanup_aborted to audit_log so alerts can pick it up.
        $schedule->command('legacy:cleanup-purchases --days=60')
            ->weeklyOn(0, '03:30')
            ->onFailure(function () {
                \Log::error('Scheduled legacy:cleanup-purchases failed');
            });
    }

    protected function commands(): void
    {
        $this->load(__DIR__ . '/Commands');
    }
}
