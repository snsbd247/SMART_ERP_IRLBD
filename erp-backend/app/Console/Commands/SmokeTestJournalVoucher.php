<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SmokeTestJournalVoucher extends Command
{
    protected $signature = 'journal:smoke';
    protected $description = 'Smoke test: journal voucher posting + trial balance integrity';

    public function handle(): int
    {
        $this->info('=== Test #5: Journal Voucher / GL Posting ===');

        $cash = DB::table('chart_of_accounts')->where('account_type', 'asset')->orderBy('account_code')->first();
        $rev  = DB::table('chart_of_accounts')->where('account_type', 'revenue')->orderBy('account_code')->first()
              ?? DB::table('chart_of_accounts')->where('account_type', 'income')->orderBy('account_code')->first();

        if (!$cash || !$rev) {
            $this->error('Need at least one asset & one revenue account in chart_of_accounts.');
            return 1;
        }

        $today = now()->toDateString();
        $fy = DB::table('financial_years')->where('is_active', 1)
            ->whereDate('start_date', '<=', $today)->whereDate('end_date', '>=', $today)->first();
        if (!$fy) { $this->error('No active financial year covers today.'); return 1; }

        $branchId = DB::table('branches')->where('status', 'active')->value('id');
        $vid = (string) Str::uuid();
        $vno = 'JV-SMK-' . substr(uniqid(), -6);

        DB::table('acc_vouchers')->insert([
            'id' => $vid, 'voucher_number' => $vno, 'voucher_type' => 'journal',
            'voucher_date' => $today, 'description' => 'Smoke test journal',
            'total_amount' => 1000, 'status' => 'posted',
            'branch_id' => $branchId, 'financial_year_id' => $fy->id,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('voucher_entries')->insert([
            ['id' => (string) Str::uuid(), 'voucher_id' => $vid, 'account_id' => $cash->id,
             'debit' => 1000, 'credit' => 0, 'narration' => 'Cash in', 'sort_order' => 1],
            ['id' => (string) Str::uuid(), 'voucher_id' => $vid, 'account_id' => $rev->id,
             'debit' => 0, 'credit' => 1000, 'narration' => 'Revenue', 'sort_order' => 2],
        ]);

        // Verify the voucher is balanced
        $sums = DB::table('voucher_entries')->where('voucher_id', $vid)
            ->selectRaw('SUM(debit) d, SUM(credit) c')->first();
        $balanced = abs($sums->d - $sums->c) < 0.01;

        // Trial balance across ALL posted vouchers must net to 0
        $tb = DB::table('voucher_entries')
            ->join('acc_vouchers', 'acc_vouchers.id', '=', 'voucher_entries.voucher_id')
            ->where('acc_vouchers.status', 'posted')
            ->selectRaw('SUM(debit) d, SUM(credit) c')->first();
        $tbOk = abs($tb->d - $tb->c) < 0.01;

        $this->table(['Check', 'Debit', 'Credit', 'OK'], [
            ['This voucher', $sums->d, $sums->c, $balanced ? '✅' : '❌'],
            ['Full trial balance', $tb->d, $tb->c, $tbOk ? '✅' : '❌'],
        ]);
        if ($balanced && $tbOk) { $this->info("✅ Journal smoke PASS ($vno)"); return 0; }
        $this->error('❌ Journal smoke FAIL'); return 1;
    }
}
