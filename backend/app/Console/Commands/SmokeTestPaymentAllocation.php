<?php

namespace App\Console\Commands;

use App\Models\PartyPayment;
use App\Services\PaymentAllocationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Carbon\Carbon;

/**
 * Smoke test for FIFO payment allocation logic.
 *
 *   php artisan payment-allocation:smoke
 *
 * Scenario A — FIFO:
 *   3 invoices (oldest → newest): 1000, 2000, 3000
 *   Pay 4500 → expect: inv1=1000 (full), inv2=2000 (full), inv3=1500 (partial)
 *
 * Scenario B — Advance + later invoice:
 *   Pay 5000 with no invoices, then issue invoice 3000
 *   autoAllocate runs again → inv=3000 (full), 2000 still unallocated (advance)
 */
class SmokeTestPaymentAllocation extends Command
{
    protected $signature = 'payment-allocation:smoke {--cleanup : Remove generated rows afterwards}';
    protected $description = 'Verify FIFO allocation + advance balance handling';

    public function handle(PaymentAllocationService $svc): int
    {
        $today = Carbon::now();

        // Use existing Demo Customer from sales-workflow seeder
        $customer = DB::table('customers')->where('name', 'Demo Customer Ltd')->first();
        if (! $customer) {
            $this->error('Demo Customer Ltd not found. Run: php artisan db:seed --class=SalesWorkflowDemoSeeder');
            return self::FAILURE;
        }

        $customerId = $customer->id;
        $this->info("Customer: Demo Customer Ltd ({$customerId})");

        // ─── Scenario A: FIFO ────────────────────────────────────────────
        $this->newLine();
        $this->line('━━━ Scenario A: FIFO Allocation ━━━');

        $invoices = [];
        foreach ([
            ['amount' => 1000, 'days_ago' => 10, 'tag' => 'A1'],
            ['amount' => 2000, 'days_ago' => 5,  'tag' => 'A2'],
            ['amount' => 3000, 'days_ago' => 1,  'tag' => 'A3'],
        ] as $row) {
            $id = (string) Str::uuid();
            $number = 'INV-FIFO-' . $row['tag'] . '-' . substr(uniqid(), -6);
            DB::table('sales_invoices')->insert([
                'id' => $id,
                'invoice_number' => $number,
                'invoice_date' => $today->copy()->subDays($row['days_ago'])->toDateString(),
                'customer_id' => $customerId,
                'total_amount' => $row['amount'],
                'discount' => 0,
                'net_amount' => $row['amount'],
                'status' => 'posted',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $invoices[$row['tag']] = ['id' => $id, 'number' => $number, 'amount' => $row['amount']];
            $this->info("  ✓ {$number} — ৳{$row['amount']} ({$row['days_ago']}d ago)");
        }

        $paymentA = $svc->recordPayment([
            'party_id' => $customerId,
            'party_type' => 'customer',
            'amount' => 4500,
            'payment_date' => $today->toDateString(),
            'payment_method' => 'bank',
            'reference' => 'FIFO-TEST-A',
        ]);
        $this->info("  ✓ Payment recorded: ৳4500 (id={$paymentA->id})");

        $svc->autoAllocate($paymentA);

        $allocs = DB::table('payment_allocations')
            ->where('payment_id', $paymentA->id)
            ->orderBy('allocated_amount', 'desc')
            ->get();

        $this->newLine();
        $this->table(['Invoice', 'Expected', 'Allocated', 'OK?'], [
            ['A1 (1000, oldest)', '1000.00', $this->allocFor($allocs, $invoices['A1']['id']),
                $this->check($this->allocFor($allocs, $invoices['A1']['id']), 1000)],
            ['A2 (2000)',        '2000.00', $this->allocFor($allocs, $invoices['A2']['id']),
                $this->check($this->allocFor($allocs, $invoices['A2']['id']), 2000)],
            ['A3 (3000, newest)', '1500.00 (partial)', $this->allocFor($allocs, $invoices['A3']['id']),
                $this->check($this->allocFor($allocs, $invoices['A3']['id']), 1500)],
        ]);

        $passA = $this->allocFor($allocs, $invoices['A1']['id']) == 1000
              && $this->allocFor($allocs, $invoices['A2']['id']) == 2000
              && $this->allocFor($allocs, $invoices['A3']['id']) == 1500;
        $this->line($passA ? '<info>✅ Scenario A PASS</info>' : '<error>❌ Scenario A FAIL</error>');

        // ─── Scenario B: Advance + later invoice ─────────────────────────
        $this->newLine();
        $this->line('━━━ Scenario B: Advance Payment ━━━');

        // Pay 5000 advance (no allocations)
        $paymentB = $svc->recordPayment([
            'party_id' => $customerId,
            'party_type' => 'customer',
            'amount' => 5000,
            'payment_date' => $today->toDateString(),
            'payment_method' => 'bank',
            'reference' => 'ADVANCE-TEST-B',
        ]);
        $this->info("  ✓ Advance payment ৳5000 recorded");

        // Issue new invoice 3000
        $invB = (string) Str::uuid();
        $invBNum = 'INV-ADV-' . substr(uniqid(), -6);
        DB::table('sales_invoices')->insert([
            'id' => $invB,
            'invoice_number' => $invBNum,
            'invoice_date' => $today->toDateString(),
            'customer_id' => $customerId,
            'total_amount' => 3000,
            'discount' => 0,
            'net_amount' => 3000,
            'status' => 'posted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->info("  ✓ New invoice {$invBNum} — ৳3000");

        $svc->autoAllocate($paymentB);

        $advAlloc = (float) DB::table('payment_allocations')
            ->where('payment_id', $paymentB->id)
            ->where('invoice_id', $invB)
            ->sum('allocated_amount');
        $totalAllocB = $svc->getAllocatedTotal($paymentB->id);
        $unallocated = 5000 - $totalAllocB;

        // Note: A3 still has ৳1500 due from Scenario A; FIFO covers it first, then new invoice ৳3000.
        // Total absorbed = 4500, leaving ৳500 advance.
        $this->newLine();
        $this->table(['Metric', 'Expected', 'Actual', 'OK?'], [
            ['Allocated to new invoice', '3000.00', number_format($advAlloc, 2), $this->check($advAlloc, 3000)],
            ['Remaining advance balance', '500.00 (A3 leftover absorbed)', number_format($unallocated, 2), $this->check($unallocated, 500)],
        ]);

        $passB = abs($advAlloc - 3000) < 0.01 && abs($unallocated - 500) < 0.01;
        $this->line($passB ? '<info>✅ Scenario B PASS</info>' : '<error>❌ Scenario B FAIL</error>');

        // ─── Party summary ───────────────────────────────────────────────
        $summary = $svc->getPartySummary($customerId, 'customer');
        $this->newLine();
        $this->line('Party Summary:');
        $this->table(['Total Invoiced', 'Total Paid', 'Balance Due'], [[
            $summary['total_invoiced'], $summary['total_paid'], $summary['balance_due']
        ]]);

        if ($this->option('cleanup')) {
            $invIds = array_merge(array_column($invoices, 'id'), [$invB]);
            DB::table('payment_allocations')->whereIn('payment_id', [$paymentA->id, $paymentB->id])->delete();
            DB::table('party_payments')->whereIn('id', [$paymentA->id, $paymentB->id])->delete();
            DB::table('sales_invoice_items')->whereIn('sales_invoice_id', $invIds)->delete();
            DB::table('sales_invoices')->whereIn('id', $invIds)->delete();
            $this->warn('Cleanup complete.');
        }

        return ($passA && $passB) ? self::SUCCESS : self::FAILURE;
    }

    private function allocFor($allocs, string $invoiceId): float
    {
        return (float) $allocs->where('invoice_id', $invoiceId)->sum('allocated_amount');
    }

    private function check(float $actual, float $expected): string
    {
        return abs($actual - $expected) < 0.01 ? '✅' : '❌';
    }
}
