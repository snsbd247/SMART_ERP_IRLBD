import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AccountWithBalance {
  id: string;
  account_name: string;
  account_code: string;
  account_type: string;
  parent_id: string | null;
  opening_balance: number;
  opening_balance_type: string;
  is_active: boolean;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
  closing_balance_type: "debit" | "credit";
}

interface Filters {
  financialYearId?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface VoucherEntryBalanceRow {
  account_id: string;
  debit: number | string | null;
  credit: number | string | null;
}

type AccountRow = Omit<AccountWithBalance, "total_debit" | "total_credit" | "closing_balance" | "closing_balance_type">;

const PAGE_SIZE = 1000;

export function useAccountBalances(filters: Filters = {}) {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);

    // 1. Get all accounts
    const { data: accs } = await supabase
      .from("chart_of_accounts")
      .select("*")
      .order("account_code");

    if (!accs) { setLoading(false); return; }

    const entries: VoucherEntryBalanceRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = supabase
        .from("voucher_entries")
        .select("account_id, debit, credit, acc_vouchers!inner(status, voucher_date, branch_id, financial_year_id)")
        .eq("acc_vouchers.status", "approved")
        .range(from, from + PAGE_SIZE - 1);

      if (filters.branchId) query = query.eq("acc_vouchers.branch_id", filters.branchId);
      if (filters.financialYearId) query = query.eq("acc_vouchers.financial_year_id", filters.financialYearId);
      if (filters.dateFrom) query = query.gte("acc_vouchers.voucher_date", filters.dateFrom);
      if (filters.dateTo) query = query.lte("acc_vouchers.voucher_date", filters.dateTo);

      const { data, error } = await query;
      if (error) break;
      entries.push(...((data || []) as VoucherEntryBalanceRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }

    // 3. Aggregate by account
    const balMap = new Map<string, { debit: number; credit: number }>();
    entries.forEach((e) => {
      const cur = balMap.get(e.account_id) || { debit: 0, credit: 0 };
      cur.debit += Number(e.debit) || 0;
      cur.credit += Number(e.credit) || 0;
      balMap.set(e.account_id, cur);
    });

    // 4. Compute leaf balances
    const result: AccountWithBalance[] = (accs as AccountRow[]).map((a) => {
      const txn = balMap.get(a.id) || { debit: 0, credit: 0 };
      const openSigned = a.opening_balance_type === "debit" ? a.opening_balance : -a.opening_balance;
      const closing = openSigned + txn.debit - txn.credit;
      return {
        ...a,
        total_debit: txn.debit,
        total_credit: txn.credit,
        closing_balance: Math.abs(closing),
        closing_balance_type: (closing >= 0 ? "debit" : "credit") as "debit" | "credit",
      };
    });

    setAccounts(result);
    setLoading(false);
  }, [filters.financialYearId, filters.branchId, filters.dateFrom, filters.dateTo]);

  useEffect(() => { fetch(); }, [fetch]);

  return { accounts, loading, refetch: fetch };
}
