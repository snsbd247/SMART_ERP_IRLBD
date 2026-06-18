<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

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

        $mode = $request->input('mode', 'full');
        if (!in_array($mode, ['full', 'reset'], true)) {
            return $this->error('Invalid demo seed mode.', 422);
        }

        $this->audit($request, $mode, 'started', 'Demo seed action started.');

        try {
            $exitCode = Artisan::call('demo:seed', $mode === 'reset' ? ['--wipe' => true] : ['--reset' => true]);
            $output = Artisan::output();

            if ($exitCode !== 0) {
                Log::error("demo:seed failed", ['output' => $output]);
                $this->audit($request, $mode, 'failed', 'Demo seeder failed. Check logs.', ['output' => trim($output)]);
                return $this->error('Demo seeder failed. Check logs.', 500);
            }

            $stats = $this->collectStats();
            $message = $mode === 'reset' ? 'Demo data reset successfully' : 'Demo data seeded successfully';
            $this->audit($request, $mode, 'success', $message, ['stats' => $stats, 'output' => trim($output)]);

            return $this->success([
                'success' => true,
                'mode'    => $mode,
                'stats'   => $stats,
                'output'  => trim($output),
            ], $message);
        } catch (\Throwable $e) {
            Log::error("demo:seed exception: " . $e->getMessage());
            $this->audit($request, $mode, 'failed', $e->getMessage());
            return $this->error('Seeder error: ' . $e->getMessage(), 500);
        }
    }

    private function audit(Request $request, string $mode, string $status, string $details, array $payload = []): void
    {
        try {
            if (!Schema::hasTable('audit_log')) return;
            $user = $request->user();
            DB::table('audit_log')->insert([
                'id'         => (string) Str::uuid(),
                'user_id'    => $user?->id,
                'user_name'  => $user?->name ?? $user?->email ?? 'System',
                'module'     => 'backup',
                'action'     => $mode === 'reset' ? 'demo_seed_reset' : 'demo_seed_full',
                'record_id'  => null,
                'details'    => sprintf('[%s] mode=%s timestamp=%s user=%s. %s', $status, $mode, now()->toIso8601String(), $user?->email ?? $user?->name ?? 'System', $details),
                'new_data'   => array_merge(['mode' => $mode, 'status' => $status, 'timestamp' => now()->toIso8601String()], $payload),
                'ip_address' => $request->ip(),
                'user_agent' => substr((string) $request->userAgent(), 0, 250),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('demo seed audit insert failed: ' . $e->getMessage());
        }
    }

    /**
     * Return current counts for the key transactional tables.
     */
    private function collectStats(): array
    {
        $tables = [
            'vouchers'         => 'acc_vouchers',
            'sales'            => 'sales_invoices',
            'sales_v2'         => 'sales_invoices_v2',
            'purchases'        => 'purchase_orders',
            'vat_challans'     => 'vat_challans',
            'delivery_challans' => 'delivery_challans',
            'payments'         => 'party_payments',
            'customers'        => 'customers',
            'suppliers'        => 'suppliers',
            'employees'        => 'employees',
            'payroll'          => 'payroll',
            'productions'      => 'production_entries',
            'party_notes'      => 'party_notes',
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
