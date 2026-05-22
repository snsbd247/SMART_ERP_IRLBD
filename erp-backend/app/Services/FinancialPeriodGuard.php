<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Guards every workflow write to ensure the document date falls inside
 * an Active (`is_active = 1`) financial year.
 *
 * Super Admins (null employee_id on users table) can override via
 * `allowOverrideForSuperAdmin()` checks performed by the controller.
 */
class FinancialPeriodGuard
{
    /** Throws if $date is not inside an active financial year. */
    public function assertOpen(string|Carbon|null $date, ?string $context = null): void
    {
        if (! $date) {
            throw new RuntimeException('Document date is required for period validation.');
        }
        $d = $date instanceof Carbon ? $date->toDateString() : Carbon::parse($date)->toDateString();

        $fy = DB::table('financial_years')
            ->where('is_active', 1)
            ->whereDate('start_date', '<=', $d)
            ->whereDate('end_date', '>=', $d)
            ->first();

        if (! $fy) {
            $label = $context ? " for {$context}" : '';
            throw new RuntimeException(
                "Date {$d}{$label} is outside any active financial year. " .
                "Open the period in Settings → Financial Years before posting."
            );
        }
    }

    /** Returns the active financial-year UUID for a date, or null. */
    public function resolveId(string|Carbon|null $date): ?string
    {
        if (! $date) return null;
        $d = $date instanceof Carbon ? $date->toDateString() : Carbon::parse($date)->toDateString();
        return DB::table('financial_years')
            ->where('is_active', 1)
            ->whereDate('start_date', '<=', $d)
            ->whereDate('end_date', '>=', $d)
            ->value('id');
    }
}
