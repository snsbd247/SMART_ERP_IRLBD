<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
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

    /**
     * Resolve the active financial-year UUID for a date, creating the missing
     * July→June year when it does not exist yet. This is intentionally used by
     * Accounting Voucher add/edit only: other modules keep the stricter
     * assertOpen() behaviour so closed-period controls are not weakened.
     */
    public function resolveOrCreateId(string|Carbon|null $date): string
    {
        if (! $date) {
            throw new RuntimeException('Voucher date is required for financial year resolution.');
        }

        $d = $date instanceof Carbon ? $date->copy() : Carbon::parse($date);
        $iso = $d->toDateString();

        $existing = DB::table('financial_years')
            ->whereDate('start_date', '<=', $iso)
            ->whereDate('end_date', '>=', $iso)
            ->orderByDesc('is_active')
            ->first();

        if ($existing) {
            if ((int) $existing->is_active !== 1) {
                $name = $existing->name ?? ($existing->start_date . ' to ' . $existing->end_date);
                throw new RuntimeException(
                    "Date {$iso} falls in financial year {$name}, but that year is inactive/closed. " .
                    "Activate it in Settings → Financial Years before saving this voucher."
                );
            }
            return (string) $existing->id;
        }

        // Bangladesh/common fiscal year used by the app: July 1 → June 30.
        $startYear = ((int) $d->month >= 7) ? (int) $d->year : (int) $d->year - 1;
        $start = Carbon::create($startYear, 7, 1)->startOfDay();
        $end = $start->copy()->addYear()->subDay();
        $name = sprintf('FY %d-%d', $startYear, $startYear + 1);

        return DB::transaction(function () use ($iso, $start, $end, $name) {
            // Re-check inside the transaction to avoid duplicate creation if
            // two voucher saves for the same new FY land at the same time.
            $again = DB::table('financial_years')
                ->whereDate('start_date', '<=', $iso)
                ->whereDate('end_date', '>=', $iso)
                ->orderByDesc('is_active')
                ->lockForUpdate()
                ->first();

            if ($again) {
                if ((int) $again->is_active !== 1) {
                    throw new RuntimeException(
                        "Date {$iso} falls in financial year {$again->name}, but that year is inactive/closed. " .
                        "Activate it in Settings → Financial Years before saving this voucher."
                    );
                }
                return (string) $again->id;
            }

            $id = (string) Str::uuid();
            DB::table('financial_years')->insert([
                'id' => $id,
                'name' => $name,
                'start_date' => $start->toDateString(),
                'end_date' => $end->toDateString(),
                'is_active' => 1,
                'created_at' => now(),
            ]);

            return $id;
        });
    }
}
