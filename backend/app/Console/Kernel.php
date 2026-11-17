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

        // Remove expired login tokens (see sanctum.expiration).
        $schedule->command('sanctum:prune-expired --hours=24')->daily();

        // (Removed: weekly `legacy:cleanup-purchases` — that command does not exist in
        // this release, so the schedule only produced an error in the log every week.)
    }

    protected function commands(): void
    {
        $this->load(__DIR__ . '/Commands');
    }
}
