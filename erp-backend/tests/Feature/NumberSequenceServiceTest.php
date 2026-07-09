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
            ['prefix' => 'PV', 'description' => 'Payment', 'current_number' => 0, 'year' => $year]
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
    public function next_resyncs_counter_to_actual_max_before_issuing_number(): void
    {
        $svc = app(NumberSequenceService::class);
        $year = (int) date('Y');

        DB::table('number_sequences')->updateOrInsert(
            ['id' => 'payment_voucher'],
            ['prefix' => 'PV', 'description' => 'Payment', 'current_number' => 10, 'year' => $year]
        );

        foreach ([88, 289] as $serial) {
            DB::table('acc_vouchers')->insert([
                'id' => (string) Str::uuid(),
                'voucher_number' => sprintf('PV-%d-%05d', $year, $serial),
                'voucher_type' => 'payment',
                'voucher_date' => date('Y-m-d'),
                'total_amount' => 0,
                'status' => 'draft',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $next = $svc->next('payment_voucher');

        $this->assertSame("PV-{$year}-00290", $next);
        $this->assertSame(290, (int) DB::table('number_sequences')->where('id', 'payment_voucher')->value('current_number'));
    }

    /** @test */
    public function next_never_reuses_a_stale_free_list_number_that_still_exists(): void
    {
        $svc = app(NumberSequenceService::class);
        $year = (int) date('Y');

        DB::table('number_sequences')->updateOrInsert(
            ['id' => 'payment_voucher'],
            ['prefix' => 'PV', 'description' => 'Payment', 'current_number' => 287, 'year' => $year]
        );

        DB::table('acc_vouchers')->insert([
            'id' => (string) Str::uuid(),
            'voucher_number' => "PV-{$year}-00288",
            'voucher_type' => 'payment',
            'voucher_date' => date('Y-m-d'),
            'total_amount' => 0,
            'status' => 'transferred',
            'deleted_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('number_sequence_free_list')->insert([
            'id' => (string) Str::uuid(),
            'sequence_id' => 'payment_voucher',
            'number' => "PV-{$year}-00288",
            'released_at' => now(),
        ]);

        $next = $svc->next('payment_voucher');

        $this->assertSame("PV-{$year}-00289", $next);
        $this->assertSame(1, DB::table('number_sequence_free_list')->where('number', "PV-{$year}-00288")->whereNotNull('consumed_at')->count());
    }

    /** @test */
    public function release_does_not_add_a_free_list_row_for_an_existing_voucher_number(): void
    {
        $svc = app(NumberSequenceService::class);
        $year = (int) date('Y');

        DB::table('acc_vouchers')->insert([
            'id' => (string) Str::uuid(),
            'voucher_number' => "PV-{$year}-00288",
            'voucher_type' => 'payment',
            'voucher_date' => date('Y-m-d'),
            'total_amount' => 0,
            'status' => 'transferred',
            'deleted_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $svc->release('payment_voucher', "PV-{$year}-00288", (string) Str::uuid());

        $this->assertSame(0, DB::table('number_sequence_free_list')->where('number', "PV-{$year}-00288")->count());
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
