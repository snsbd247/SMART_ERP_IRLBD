import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getApiBaseUrl, getLaravelAuthHeaders, isLaravelMode } from "@/lib/laravel-auth";
import { signedOpeningBalance } from "@/lib/balance-format";

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

async function laravelGetList(path: string): Promise<any[]> {
  const base = getApiBaseUrl();
  if (!base) return [];
  const res = await fetch(`${base}/v1/${path}`, { headers: getLaravelAuthHeaders() });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  return [];
}

export function useAccountBalances(filters: Filters = {}) {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    if (isLaravelMode()) {
      try {
        const accs = await laravelGetList("db/chart_of_accounts?order[account_code]=asc");
        const voucherFilters = new URLSearchParams();
        voucherFilters.set("select", "id");
        voucherFilters.set("f[status][eq]", "approved");
        if (filters.branchId) voucherFilters.set("f[branch_id][eq]", filters.branchId);
        if (filters.financialYearId) voucherFilters.set("f[financial_year_id][eq]", filters.financialYearId);
        if (filters.dateFrom) voucherFilters.set("f[voucher_date][gte]", filters.dateFrom);
        if (filters.dateTo) voucherFilters.set("f[voucher_date][lte]", filters.dateTo);
        const vouchers = await laravelGetList(`db/acc_vouchers?${voucherFilters.toString()}`);
        const voucherIds = vouchers.map((v: any) => v.id);
        const entries: VoucherEntryBalanceRow[] = [];
        for (let i = 0; i < voucherIds.length; i += 500) {
          const ids = voucherIds.slice(i, i + 500).join(",");
          entries.push(...await laravelGetList(`db/voucher_entries?select=account_id,debit,credit&f[voucher_id][in]=${encodeURIComponent(ids)}`));
        }
        const balMap = new Map<string, { debit: number; credit: number }>();
        entries.forEach((e) => {
          const cur = balMap.get(e.account_id) || { debit: 0, credit: 0 };
          cur.debit += Number(e.debit) || 0;
          cur.credit += Number(e.credit) || 0;
          balMap.set(e.account_id, cur);
        });
        setAccounts((accs as AccountRow[]).map((a) => {
          const txn = balMap.get(a.id) || { debit: 0, credit: 0 };
          const opening = Number(a.opening_balance) || 0;
          const openSigned = signedOpeningBalance(opening, a.opening_balance_type);
          const closing = openSigned + txn.debit - txn.credit;
          return { ...a, total_debit: txn.debit, total_credit: txn.credit, closing_balance: Math.abs(closing), closing_balance_type: (closing >= 0 ? "debit" : "credit") as "debit" | "credit" };
        }));
      } catch {
        setAccounts([]);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      // 1. Get all accounts (paginated to bypass 1000-row default cap)
      const accs: AccountRow[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("chart_of_accounts")
          .select("*")
          .order("account_code")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        accs.push(...((data || []) as AccountRow[]));
        if (!data || data.length < PAGE_SIZE) break;
      }

      // Show accounts immediately with opening-only balances, then refine.
      setAccounts(accs.map((a) => ({
        ...a,
        total_debit: 0,
        total_credit: 0,
        closing_balance: Math.abs(Number(a.opening_balance) || 0),
        closing_balance_type: (a.opening_balance_type === "credit" ? "credit" : "debit") as "debit" | "credit",
      })));
      setLoading(false);

      // 2. Fetch approved voucher IDs that match the filters first.
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

      // 3. Fetch entries for those vouchers, batched in chunks.
      const entries: VoucherEntryBalanceRow[] = [];
      const CHUNK = 500;
      for (let i = 0; i < voucherIds.length; i += CHUNK) {
        const chunk = voucherIds.slice(i, i + CHUNK);
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
      const result: AccountWithBalance[] = accs.map((a) => {
        const txn = balMap.get(a.id) || { debit: 0, credit: 0 };
        const openSigned = signedOpeningBalance(a.opening_balance, a.opening_balance_type);
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
    } catch (err) {
      console.error("useAccountBalances failed:", err);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [filters.financialYearId, filters.branchId, filters.dateFrom, filters.dateTo]);

  useEffect(() => { fetch(); }, [fetch]);

  return { accounts, loading, refetch: fetch };
}
