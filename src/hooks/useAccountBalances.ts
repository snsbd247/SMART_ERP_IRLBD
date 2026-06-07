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

    // 2. Fetch approved voucher IDs that match the filters first (no relation join).
    let vq = supabase
      .from("acc_vouchers")
      .select("id")
      .eq("status", "approved");
    if (filters.branchId) vq = vq.eq("branch_id", filters.branchId);
    if (filters.financialYearId) vq = vq.eq("financial_year_id", filters.financialYearId);
    if (filters.dateFrom) vq = vq.gte("voucher_date", filters.dateFrom);
    if (filters.dateTo) vq = vq.lte("voucher_date", filters.dateTo);

    const { data: vouchers } = await vq;
    const voucherIds = (vouchers || []).map((v: any) => v.id);

    // 3. Fetch entries for those vouchers, batched in chunks to avoid huge IN() clauses.
    const entries: VoucherEntryBalanceRow[] = [];
    const CHUNK = 500;
    for (let i = 0; i < voucherIds.length; i += CHUNK) {
      const chunk = voucherIds.slice(i, i + CHUNK);
      // page through results in case a single voucher set returns >1000 rows
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("voucher_entries")
          .select("account_id, debit, credit")
          .in("voucher_id", chunk)
          .range(from, from + PAGE_SIZE - 1);
        if (error) break;
        entries.push(...((data || []) as VoucherEntryBalanceRow[]));
        if (!data || data.length < PAGE_SIZE) break;
      }
    }

    // 4. Aggregate by account
    const balMap = new Map<string, { debit: number; credit: number }>();
    entries.forEach((e) => {
      const cur = balMap.get(e.account_id) || { debit: 0, credit: 0 };
      cur.debit += Number(e.debit) || 0;
      cur.credit += Number(e.credit) || 0;
      balMap.set(e.account_id, cur);
    });

    // 5. Compute leaf balances
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
