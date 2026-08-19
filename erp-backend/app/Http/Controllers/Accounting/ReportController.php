<?php

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\BaseController;
use App\Services\AccountingService;
use Illuminate\Http\Request;

class ReportController extends BaseController
{
    public function __construct(private AccountingService $service) {}

    public function trialBalance(Request $request)
    {
        $request->validate(['from' => 'required|date', 'to' => 'required|date']);
        return $this->success($this->service->trialBalance($request->from, $request->to, $request->branch_id));
    }

    public function profitLoss(Request $request)
    {
        $request->validate(['from' => 'required|date', 'to' => 'required|date']);
        $tb = $this->service->trialBalance($request->from, $request->to, $request->branch_id);

        $income = collect($tb)->where('account_type', 'income')->sum('credit') - collect($tb)->where('account_type', 'income')->sum('debit');
        $expense = collect($tb)->where('account_type', 'expense')->sum('debit') - collect($tb)->where('account_type', 'expense')->sum('credit');

        return $this->success([
            'income_accounts' => collect($tb)->where('account_type', 'income')->values(),
            'expense_accounts' => collect($tb)->where('account_type', 'expense')->values(),
            'total_income' => round($income, 2),
            'total_expense' => round($expense, 2),
            'net_profit' => round($income - $expense, 2),
        ]);
    }

    /**
     * Opening balance sum (debit/credit) for one account up to a date —
     * used by the frontend ledger/statement reports so they don't have to
     * pull every prior-period entry across the wire just to add them up.
     */
    public function accountOpeningSum(Request $request)
    {
        $request->validate(['account_id' => 'required|string', 'date_to' => 'required|date']);
        $statuses = $request->filled('statuses') ? explode(',', $request->string('statuses')) : ['approved', 'posted'];
        return $this->success($this->service->accountOpeningSum(
            $request->string('account_id'),
            $request->string('date_to'),
            $request->query('branch_id'),
            $statuses,
        ));
    }

    /**
     * Account Ledger entries for a period, with voucher info and
     * counter-account names already joined server-side — replaces three
     * separate client round trips with one.
     */
    public function accountLedgerEntries(Request $request)
    {
        $request->validate([
            'account_id' => 'required|string',
            'date_from' => 'required|date',
            'date_to' => 'required|date',
        ]);
        $statuses = $request->filled('statuses') ? explode(',', $request->string('statuses')) : ['approved', 'posted'];
        return $this->success($this->service->accountLedgerEntries(
            $request->string('account_id'),
            $request->string('date_from'),
            $request->string('date_to'),
            $request->query('branch_id'),
            $statuses,
        ));
    }

    public function balanceSheet(Request $request)
    {
        $request->validate(['as_of' => 'required|date']);
        // Use start of earliest FY to as_of date
        $tb = $this->service->trialBalance('1900-01-01', $request->as_of, $request->branch_id);

        return $this->success([
            'assets' => collect($tb)->where('account_type', 'asset')->values(),
            'liabilities' => collect($tb)->where('account_type', 'liability')->values(),
            'equity' => collect($tb)->where('account_type', 'equity')->values(),
            'total_assets' => collect($tb)->where('account_type', 'asset')->sum('balance'),
            'total_liabilities' => collect($tb)->where('account_type', 'liability')->sum(fn ($a) => -$a['balance']),
            'total_equity' => collect($tb)->where('account_type', 'equity')->sum(fn ($a) => -$a['balance']),
        ]);
    }
}
