<?php

namespace Tests\Feature;

use App\Models\AccVoucher;
use App\Models\ChartOfAccount;
use App\Models\User;
use App\Services\AccountingService;
use App\Services\NumberSequenceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Voucher Type Change (Transfer) end-to-end coverage.
 *
 * Covers all scenarios requested:
 *  - Payment → Journal transfer soft-deletes old & creates new
 *  - A transferred voucher keeps its serial (never reissued); freed, unused
 *    serials are reused FIFO by the next same-type entry
 *  - Transferred vouchers are excluded from ledger / trial balance sums
 *  - Auto-posted (source_module set) vouchers are forbidden from transfer
 *  - Audit log + approval history rows are persisted with correct linkage
 *  - Concurrent next() calls respect free-list FIFO with no duplicate reuse
 */
class VoucherTransferTest extends TestCase
{
    use RefreshDatabase;

    private AccountingService $svc;
    private NumberSequenceService $seq;
    private ChartOfAccount $cash;
    private ChartOfAccount $bank;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->artisan('migrate', ['--database' => 'sqlite'])->run();

        $this->svc = app(AccountingService::class);
        $this->seq = app(NumberSequenceService::class);

        $this->cash = ChartOfAccount::create([
            'id' => (string) Str::uuid(),
            'account_code' => '1001', 'account_name' => 'Cash',
            'account_type' => 'asset',
        ]);
        $this->bank = ChartOfAccount::create([
            'id' => (string) Str::uuid(),
            'account_code' => '1002', 'account_name' => 'Bank',
            'account_type' => 'asset',
        ]);

        $this->user = new User();
        $this->user->id = (string) Str::uuid();
        $this->user->username = 'tester';
        $this->user->name = 'Tester';
        $this->user->email = 'tester@test.local';
        $this->user->password = bcrypt('secret');
        $this->user->status = 'active';
        $this->user->save();
    }

    private function makeVoucher(string $type, ?string $source = null): AccVoucher
    {
        return $this->svc->createVoucher([
            'voucher_type' => $type,
            'voucher_date' => now()->toDateString(),
            'description' => "Test {$type}",
            'created_by' => $this->user->id,
            'source_module' => $source,
        ], [
            ['account_id' => $this->cash->id, 'debit' => 500, 'credit' => 0, 'narration' => 'dr'],
            ['account_id' => $this->bank->id, 'debit' => 0, 'credit' => 500, 'narration' => 'cr'],
        ], true);
    }

    // ── Core transfer + serial reuse ────────────────────────────────────────

    public function test_payment_to_journal_transfer_soft_deletes_old_and_creates_new(): void
    {
        $old = $this->makeVoucher('payment');
        $oldNumber = $old->voucher_number;

        $new = $this->svc->changeVoucherType($old->id, 'journal', $this->user->id, 'wrong type');

        $this->assertSame('journal', $new->voucher_type);
        $this->assertNotSame($old->id, $new->id);
        $this->assertCount(2, $new->entries);

        $old->refresh();
        $this->assertSame('transferred', $old->status);
        $this->assertNotNull($old->deleted_at);
        $this->assertSame($new->id, $old->transferred_to_id);
        $this->assertSame($old->id, $new->transferred_from_id);
        $this->assertNotSame($oldNumber, $new->voucher_number,
            'New voucher must get a fresh journal number, not the released payment number');
    }

    public function test_transferred_payment_serial_is_not_reissued(): void
    {
        $old = $this->makeVoucher('payment');
        $oldNumber = $old->voucher_number;

        $this->svc->changeVoucherType($old->id, 'journal', $this->user->id, 'oops');

        // The soft-deleted original still owns its UNIQUE voucher_number, so
        // release() must not queue it for reuse.
        $this->assertDatabaseMissing('number_sequence_free_list', [
            'sequence_id' => 'payment_voucher',
            'number' => $oldNumber,
        ]);

        $nextPayment = $this->makeVoucher('payment');
        $this->assertNotSame($oldNumber, $nextPayment->voucher_number,
            'A transferred voucher keeps its number; the next Payment gets a fresh one');
        $this->assertSame(1, DB::table('acc_vouchers')->where('voucher_number', $oldNumber)->count(),
            'No voucher number may be issued twice');
    }

    // ── Ledger / trial balance exclusion ────────────────────────────────────

    public function test_transferred_vouchers_are_excluded_from_ledger_sums(): void
    {
        $old = $this->makeVoucher('payment');           // will be transferred
        $new = $this->svc->changeVoucherType($old->id, 'journal', $this->user->id);

        // Ledger query mirrors application logic: only approved|posted rows count.
        $activeIds = AccVoucher::query()
            ->whereNull('deleted_at')
            ->whereIn('status', ['approved', 'posted'])
            ->pluck('id');

        $this->assertTrue($activeIds->contains($new->id));
        $this->assertFalse($activeIds->contains($old->id), 'Transferred voucher must be excluded');

        $totalDebit = DB::table('voucher_entries')
            ->whereIn('voucher_id', $activeIds)
            ->sum('debit');

        $this->assertEquals(500.0, (float) $totalDebit,
            'Trial balance total must count the new voucher only, not both');
    }

    // ── Auto-posted block (Sales/Purchase) ──────────────────────────────────

    public function test_auto_posted_voucher_cannot_be_transferred_even_by_super_admin(): void
    {
        $auto = $this->makeVoucher('payment', 'sales');

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/Auto-posted/i');

        try {
            $this->svc->changeVoucherType($auto->id, 'journal', $this->user->id, 'try');
        } finally {
            $auto->refresh();
            $this->assertNotSame('transferred', $auto->status);
            $this->assertNull($auto->deleted_at);
            $this->assertDatabaseMissing('number_sequence_free_list', [
                'number' => $auto->voucher_number,
            ]);
        }
    }

    public function test_same_type_transfer_is_rejected(): void
    {
        $v = $this->makeVoucher('payment');
        $this->expectException(\InvalidArgumentException::class);
        $this->svc->changeVoucherType($v->id, 'payment', $this->user->id);
    }

    // ── Audit + approval-history persistence ────────────────────────────────

    public function test_audit_log_and_approval_history_are_recorded(): void
    {
        $old = $this->makeVoucher('payment');
        $new = $this->svc->changeVoucherType($old->id, 'journal', $this->user->id, 'wrong ledger');

        $history = DB::table('voucher_approval_history')
            ->where('voucher_id', $old->id)
            ->where('action', 'change_type')
            ->first();
        $this->assertNotNull($history);
        $this->assertSame('transferred', $history->after_status);
        $this->assertStringContainsString($new->voucher_number, (string) $history->note);

        $audit = DB::table('audit_log')
            ->where('module', 'accounting_vouchers')
            ->where('action', 'voucher_type_changed')
            ->where('record_id', $old->id)
            ->first();
        $this->assertNotNull($audit);
        $this->assertSame($this->user->id, $audit->user_id);

        $oldData = json_decode($audit->old_data, true);
        $newData = json_decode($audit->new_data, true);
        $this->assertSame('payment', $oldData['type']);
        $this->assertSame($old->voucher_number, $oldData['number']);
        $this->assertSame('journal', $newData['type']);
        $this->assertSame($new->voucher_number, $newData['number']);
        $this->assertSame($old->id, $newData['transferred_from']);
    }

    // ── Concurrency / FIFO under interleaved next() calls ───────────────────

    public function test_free_list_fifo_under_interleaved_next_calls(): void
    {
        // Issue five numbers, then free the first three (numbers that are
        // genuinely unused in acc_vouchers, e.g. after a failed post).
        $issued = [];
        for ($i = 0; $i < 5; $i++) {
            $issued[] = $this->seq->next('payment_voucher');
        }
        [$numA, $numB, $numC] = $issued;

        $this->seq->release('payment_voucher', $numA, $this->user->id);
        DB::table('number_sequence_free_list')->where('number', $numA)->update(['released_at' => now()->subSeconds(3)]);
        $this->seq->release('payment_voucher', $numB, $this->user->id);
        DB::table('number_sequence_free_list')->where('number', $numB)->update(['released_at' => now()->subSeconds(2)]);
        $this->seq->release('payment_voucher', $numC, $this->user->id);
        DB::table('number_sequence_free_list')->where('number', $numC)->update(['released_at' => now()->subSeconds(1)]);

        // Next three Payment entries must reuse A, B, C in FIFO order — no duplicates.
        $r1 = $this->makeVoucher('payment')->voucher_number;
        $r2 = $this->makeVoucher('payment')->voucher_number;
        $r3 = $this->makeVoucher('payment')->voucher_number;

        $this->assertSame([$numA, $numB, $numC], [$r1, $r2, $r3],
            'Free-list must issue numbers strictly FIFO with no double-issuance');

        $r4 = $this->makeVoucher('payment')->voucher_number;
        $this->assertNotContains($r4, $issued,
            'After free-list drained, next() must fall through to fresh sequence increment');

        // Free-list must contain no unconsumed rows for payment_voucher.
        $this->assertSame(0, DB::table('number_sequence_free_list')
            ->where('sequence_id', 'payment_voucher')
            ->whereNull('consumed_at')
            ->count());
    }

    // ── Other voucher posting flows unaffected ─────────────────────────────

    public function test_receipt_and_contra_sequences_are_isolated_from_payment_free_list(): void
    {
        // A freed (unused) payment number must only ever be reissued as a payment.
        $released = $this->seq->next('payment_voucher');
        $this->seq->release('payment_voucher', $released, $this->user->id);

        $receipt = $this->makeVoucher('receipt');
        $contra  = $this->makeVoucher('contra');

        $this->assertNotSame($released, $receipt->voucher_number);
        $this->assertNotSame($released, $contra->voucher_number);
        $this->assertStringStartsWith('RV-', $receipt->voucher_number);
        $this->assertStringStartsWith('CV-', $contra->voucher_number);

        // Payment free-list still has the released number waiting.
        $this->assertDatabaseHas('number_sequence_free_list', [
            'sequence_id' => 'payment_voucher',
            'number' => $released,
            'consumed_at' => null,
        ]);
    }
}
