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

        // Hourly SQL backup uploaded straight to Google Drive; the local
        // copy is deleted right after a successful upload (see
        // BackupDatabase::handleHourlyGdriveBackup) — local disk is never
        // used as long-term backup storage. No-ops entirely until Google
        // Drive is connected/enabled from the Backup & Restore page.
        $schedule->command('backup:database --type=auto_gdrive')->hourly();

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
