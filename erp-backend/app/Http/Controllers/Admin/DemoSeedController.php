<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class DemoSeedController extends BaseController
{
    /**
     * Run `php artisan demo:seed --reset` to repopulate 1-year demo data.
     * Super Admin only.
     */
    public function run(Request $request): JsonResponse
    {
        if (!$request->user() || !$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can seed demo data.', 403);
        }

        @set_time_limit(600);
        @ini_set('memory_limit', '512M');

        try {
            $exitCode = Artisan::call('demo:seed', ['--reset' => true]);
            $output = Artisan::output();

            if ($exitCode !== 0) {
                Log::error("demo:seed failed", ['output' => $output]);
                return $this->error('Demo seeder failed. Check logs.', 500);
            }

            $stats = $this->collectStats();

            return $this->success([
                'success' => true,
                'stats'   => $stats,
                'output'  => trim($output),
            ], 'Demo data seeded successfully');
        } catch (\Throwable $e) {
            Log::error("demo:seed exception: " . $e->getMessage());
            return $this->error('Seeder error: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Return current counts for the key transactional tables.
     */
    private function collectStats(): array
    {
        $tables = [
            'vouchers'         => 'vouchers',
            'sales'            => 'sales_invoices',
            'sales_v2'         => 'sales_invoices_v2',
            'purchases'        => 'purchase_orders',
            'vat_challans'     => 'vat_challans',
            'delivery_challans' => 'delivery_challans',
            'payments'         => 'party_payments',
            'parties'          => 'parties',
            'employees'        => 'employees',
            'payroll_runs'     => 'payroll_runs',
            'productions'     => 'productions',
            'party_notes'     => 'party_notes',
        ];

        $stats = [];
        foreach ($tables as $key => $table) {
            try {
                $stats[$key] = DB::table($table)->count();
            } catch (\Throwable $e) {
                $stats[$key] = 0;
            }
        }
        return $stats;
    }
}
