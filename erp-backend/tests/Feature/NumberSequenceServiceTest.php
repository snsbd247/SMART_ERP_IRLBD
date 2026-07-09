<?php

namespace Tests\Feature;

use App\Services\NumberSequenceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class NumberSequenceServiceTest extends TestCase
{
    use RefreshDatabase;

    /** @test */
    public function next_skips_numbers_that_already_exist_in_acc_vouchers(): void
    {
        $svc = app(NumberSequenceService::class);
        $year = (int) date('Y');

        DB::table('number_sequences')->updateOrInsert(
            ['id' => 'payment_voucher'],
            ['prefix' => 'PV', 'description' => 'Payment', 'current_number' => 0, 'year' => $year, 'created_at' => now(), 'updated_at' => now()]
        );

        // Simulate drifted state: counter says 0, but a real voucher exists at 00287
        DB::table('acc_vouchers')->insert([
            'id' => (string) Str::uuid(),
            'voucher_number' => "PV-{$year}-00287",
            'voucher_type' => 'payment',
            'voucher_date' => date('Y-m-d'),
            'total_amount' => 0, 'status' => 'draft',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $next = $svc->next('payment_voucher');

        $this->assertSame("PV-{$year}-00288", $next);
        $this->assertSame(288, (int) DB::table('number_sequences')->where('id', 'payment_voucher')->value('current_number'));
    }

    /** @test */
    public function next_never_returns_duplicates_across_sequential_calls(): void
    {
        $svc = app(NumberSequenceService::class);
        $seen = [];
        for ($i = 0; $i < 25; $i++) {
            $n = $svc->next('journal_voucher');
            $this->assertNotContains($n, $seen, "Duplicate issued: {$n}");
            $seen[] = $n;
        }
    }
}
