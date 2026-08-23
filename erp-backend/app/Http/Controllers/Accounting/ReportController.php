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
            $request->query('created_by'),
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
            $request->query('created_by'),
        ));
    }

    /**
     * Distinct users who have created at least one voucher — powers the
     * Account Ledger "User" filter dropdown.
     */
    public function voucherCreators()
    {
        return $this->success($this->service->voucherCreators());
    }

    /**
     * All accounts with debit/credit turnover for a period, aggregated
     * server-side — powers useAccountBalances() (Chart of Accounts,
     * Accounting Vouchers, Customers, Suppliers pages).
     */
    public function accountBalances(Request $request)
    {
        $statuses = $request->filled('statuses') ? explode(',', $request->string('statuses')) : ['approved', 'posted'];
        return $this->success([
            'accounts' => $this->service->accountBalances(
                $request->query('branch_id'),
                $request->query('financial_year_id'),
                $request->query('date_from'),
                $request->query('date_to'),
                $statuses,
            ),
        ]);
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
