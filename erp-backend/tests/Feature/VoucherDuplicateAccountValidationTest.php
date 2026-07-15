<?php

namespace Tests\Feature;

use App\Models\ChartOfAccount;
use App\Services\AccountingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class VoucherDuplicateAccountValidationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->artisan('migrate', ['--database' => 'sqlite'])->run();
    }

    public function test_voucher_creation_rejects_same_ledger_account_on_both_sides(): void
    {
        $account = ChartOfAccount::create([
            'id' => (string) Str::uuid(),
            'account_code' => '1101',
            'account_name' => 'AR - Marico Bangladesh Limited',
            'account_type' => 'asset',
        ]);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Duplicate ledger account detected');

        app(AccountingService::class)->createVoucher([
            'voucher_type' => 'receipt',
            'voucher_date' => now()->toDateString(),
            'description' => 'Duplicate account guard',
        ], [
            ['account_id' => $account->id, 'debit' => 1000, 'credit' => 0, 'narration' => 'Dr'],
            ['account_id' => $account->id, 'debit' => 0, 'credit' => 1000, 'narration' => 'Cr'],
        ], true);
    }
}