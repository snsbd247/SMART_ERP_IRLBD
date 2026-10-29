<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Dashboard summary endpoint.
 *
 * GET /api/v1/dashboard/summary
 *
 * Aggregates totals (sales, purchases, income, expenses), cash & bank
 * balances (from Chart of Accounts + voucher_entries) and recent
 * invoices / supplier bills / VAT challans for the main dashboard.
 */
class DashboardController extends BaseController
{
    public function summary(Request $request)
    {
        $startDate = $request->get('start_date');
        $endDate   = $request->get('end_date');

        // ---------- Sales (v1 + v2) ----------
        $totalSales = 0.0;
        if (Schema::hasTable('sales_invoices')) {
            $q = DB::table('sales_invoices')->whereNotIn('status', ['cancelled', 'draft']);
            $this->dateFilter($q, 'invoice_date', $startDate, $endDate);
            $totalSales += (float) $q->sum(DB::raw('COALESCE(net_amount, total_amount, 0)'));
        }
        if (Schema::hasTable('sales_invoices_v2')) {
            $q = DB::table('sales_invoices_v2')->whereNotIn('status', ['cancelled', 'draft']);
            $this->dateFilter($q, 'invoice_date', $startDate, $endDate);
            $totalSales += (float) $q->sum('grand_total');
        }

        // ---------- Purchases (v1 + v2) ----------
        $totalPurchases = 0.0;
        if (Schema::hasTable('purchase_orders')) {
            $q = DB::table('purchase_orders')->whereNotIn('status', ['cancelled', 'draft']);
            $this->dateFilter($q, 'order_date', $startDate, $endDate);
            $totalPurchases += (float) $q->sum(DB::raw('COALESCE(net_amount, total_amount, 0)'));
        }
        if (Schema::hasTable('supplier_bills_v2')) {
            $q = DB::table('supplier_bills_v2')->whereNotIn('status', ['cancelled', 'draft']);
            $this->dateFilter($q, 'bill_date', $startDate, $endDate);
            $totalPurchases += (float) $q->sum('grand_total');
        }

        // ---------- Income / Expense from journal entries ----------
        $totalIncome = $this->sumByType('income', $startDate, $endDate);
        $totalExpenses = $this->sumByType('expense', $startDate, $endDate);

        // ---------- Cash & Bank balances from CoA + voucher_entries ----------
        [$cashBalance, $bankBalance] = $this->cashAndBankBalance();

        // ---------- Recent activity ----------
        $recentInvoices = $this->recentInvoices();
        $recentBills    = $this->recentBills();
        $recentVat      = $this->recentVatChallans();

        return $this->success([
            'totals' => [
                'sales'     => round($totalSales, 2),
                'purchases' => round($totalPurchases, 2),
                'income'    => round($totalIncome, 2),
                'expenses'  => round($totalExpenses, 2),
                'cash'      => round($cashBalance, 2),
                'bank'      => round($bankBalance, 2),
            ],
            'recent_invoices'     => $recentInvoices,
            'recent_bills'        => $recentBills,
            'recent_vat_challans' => $recentVat,
        ]);
    }

    private function dateFilter($q, string $col, ?string $start, ?string $end): void
    {
        if ($start) $q->where($col, '>=', $start);
        if ($end)   $q->where($col, '<=', $end);
    }

    private function sumByType(string $type, ?string $start, ?string $end): float
    {
        if (!Schema::hasTable('chart_of_accounts') || !Schema::hasTable('voucher_entries')) return 0.0;
        $accountIds = DB::table('chart_of_accounts')->where('account_type', $type)->pluck('id');
        if ($accountIds->isEmpty()) return 0.0;

        $q = DB::table('voucher_entries as ve')
            ->join('acc_vouchers as v', 'v.id', '=', 've.voucher_id')
            ->whereIn('ve.account_id', $accountIds)
            ->whereNotIn('v.status', ['cancelled']);
        if ($start) $q->where('v.voucher_date', '>=', $start);
        if ($end)   $q->where('v.voucher_date', '<=', $end);

        if ($type === 'income') {
            return (float) $q->sum(DB::raw('ve.credit - ve.debit'));
        }
        return (float) $q->sum(DB::raw('ve.debit - ve.credit'));
    }

    private function cashAndBankBalance(): array
    {
        if (!Schema::hasTable('chart_of_accounts')) return [0.0, 0.0];

        $cashIds = DB::table('chart_of_accounts')
            ->where('account_type', 'asset')
            ->where('account_name', 'like', '%cash%')
            ->pluck('id', 'id');
        $bankIds = DB::table('chart_of_accounts')
            ->where('account_type', 'asset')
            ->where(function ($q) {
                $q->where('account_name', 'like', '%bank%')
                  ->orWhere('account_code', 'like', '1102%');
            })
            ->pluck('id', 'id');

        $compute = function ($ids) {
            if ($ids->isEmpty()) return 0.0;
            $opening = (float) DB::table('chart_of_accounts')
                ->whereIn('id', $ids)
                ->sum(DB::raw("CASE WHEN opening_balance_type='credit' THEN -opening_balance ELSE opening_balance END"));
            $movement = 0.0;
            if (Schema::hasTable('voucher_entries')) {
                $movement = (float) DB::table('voucher_entries as ve')
                    ->join('acc_vouchers as v', 'v.id', '=', 've.voucher_id')
                    ->whereIn('ve.account_id', $ids)
                    ->whereNotIn('v.status', ['cancelled'])
                    ->sum(DB::raw('ve.debit - ve.credit'));
            }
            return $opening + $movement;
        };

        return [$compute($cashIds), $compute($bankIds)];
    }

    private function recentInvoices(int $limit = 10): array
    {
        $rows = [];
        if (Schema::hasTable('sales_invoices_v2')) {
            $rows = DB::table('sales_invoices_v2')
                ->leftJoin('customers', 'customers.id', '=', 'sales_invoices_v2.customer_id')
                ->orderByDesc('invoice_date')
                ->limit($limit)
                ->get([
                    'sales_invoices_v2.id',
                    'sales_invoices_v2.invoice_number',
                    'sales_invoices_v2.invoice_date',
                    'sales_invoices_v2.grand_total as amount',
                    'sales_invoices_v2.status',
                    'customers.name as customer_name',
                ])->toArray();
        }
        return $rows;
    }

    private function recentBills(int $limit = 10): array
    {
        if (!Schema::hasTable('supplier_bills_v2')) return [];
        return DB::table('supplier_bills_v2')
            ->leftJoin('suppliers', 'suppliers.id', '=', 'supplier_bills_v2.supplier_id')
            ->orderByDesc('bill_date')
            ->limit($limit)
            ->get([
                'supplier_bills_v2.id',
                'supplier_bills_v2.bill_number',
                'supplier_bills_v2.bill_date',
                'supplier_bills_v2.grand_total as amount',
                'supplier_bills_v2.status',
                'suppliers.name as supplier_name',
            ])->toArray();
    }

    private function recentVatChallans(int $limit = 10): array
    {
        if (!Schema::hasTable('vat_challans')) return [];
        return DB::table('vat_challans')
            ->leftJoin('customers', 'customers.id', '=', 'vat_challans.customer_id')
            ->orderByDesc('challan_date')
            ->limit($limit)
            ->get([
                'vat_challans.id',
                'vat_challans.challan_number',
                'vat_challans.challan_date',
                'vat_challans.grand_total as amount',
                'vat_challans.status',
                'customers.name as customer_name',
            ])->toArray();
    }
}
