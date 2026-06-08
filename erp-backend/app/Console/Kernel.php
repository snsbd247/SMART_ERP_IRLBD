<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        // Mark users offline if inactive for >2 minutes
        $schedule->command('users:mark-offline')->everyTwoMinutes();

        // Automated daily SQL backup at 2 AM (uploads to Google Drive if enabled)
        $schedule->command('backup:database --type=auto --format=sql --gdrive=auto')->dailyAt('02:00');
        // Companion daily JSON backup at 2:15 AM
        $schedule->command('backup:database --type=auto --format=json --gdrive=auto')->dailyAt('02:15');
    }

    protected function commands(): void
    {
        $this->load(__DIR__ . '/Commands');
    }
}
