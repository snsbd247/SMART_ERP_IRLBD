import { useEffect, useState, useCallback } from "react";
import { dataClient } from "@/integrations/data/client";
import { getApiBaseUrl, getLaravelAuthHeaders, isLaravelMode } from "@/lib/laravel-auth";
import { signedOpeningBalance } from "@/lib/balance-format";
import { BALANCE_VOUCHER_STATUSES } from "@/lib/shared-balance";

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
  /** Signed closing balance: positive = Dr (or net positive), negative = Cr (or overdraft).
   *  Single source of truth for any UI using the no-Dr/Cr "signed" convention. */
  signed_balance: number;
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

type AccountRow = Omit<AccountWithBalance, "total_debit" | "total_credit" | "closing_balance" | "closing_balance_type" | "signed_balance">;

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

async function laravelGetJson(path: string): Promise<any> {
  const base = getApiBaseUrl();
  if (!base) return null;
  const res = await fetch(`${base}/v1/${path}`, { headers: getLaravelAuthHeaders() });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
  return json?.data ?? json;
}

export function useAccountBalances(filters: Filters = {}) {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    if (isLaravelMode()) {
      try {
        // Server-side aggregate (LEFT JOIN + GROUP BY) — one request instead
        // of fetching every account, then every matching voucher, then every
        // voucher_entries row (chunked) just to sum them per account.
        const qs = new URLSearchParams();
        qs.set("statuses", BALANCE_VOUCHER_STATUSES.join(","));
        if (filters.branchId) qs.set("branch_id", filters.branchId);
        if (filters.financialYearId) qs.set("financial_year_id", filters.financialYearId);
        if (filters.dateFrom) qs.set("date_from", filters.dateFrom);
        if (filters.dateTo) qs.set("date_to", filters.dateTo);
        const payload = await laravelGetJson(`reports/account-balances?${qs.toString()}`);
        const accs: any[] = Array.isArray(payload?.accounts) ? payload.accounts : [];
        setAccounts((accs as (AccountRow & { total_debit: number; total_credit: number })[]).map((a) => {
          const opening = Number(a.opening_balance) || 0;
          const openSigned = signedOpeningBalance(opening, a.opening_balance_type);
          const closing = openSigned + Number(a.total_credit || 0) - Number(a.total_debit || 0);
          return {
            ...a,
            total_debit: Number(a.total_debit) || 0,
            total_credit: Number(a.total_credit) || 0,
            closing_balance: Math.abs(closing),
            closing_balance_type: (closing >= 0 ? "debit" : "credit") as "debit" | "credit",
            signed_balance: closing,
          };
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
        const { data, error } = await dataClient
          .from("chart_of_accounts")
          .select("*")
          .order("account_code")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        accs.push(...((data || []) as AccountRow[]));
        if (!data || data.length < PAGE_SIZE) break;
      }

      // Show accounts immediately with opening-only balances, then refine.
      setAccounts(accs.map((a) => {
        const openSigned = signedOpeningBalance(a.opening_balance, a.opening_balance_type);
        return {
          ...a,
          total_debit: 0,
          total_credit: 0,
          closing_balance: Math.abs(openSigned),
          closing_balance_type: (openSigned >= 0 ? "debit" : "credit") as "debit" | "credit",
          signed_balance: openSigned,
        };
      }));
      setLoading(false);

      // 2. Fetch approved+posted voucher IDs (matches Account Ledger default).
      let vq = dataClient
        .from("acc_vouchers")
        .select("id")
        .in("status", [...BALANCE_VOUCHER_STATUSES]);
      if (filters.branchId) vq = vq.eq("branch_id", filters.branchId);
      if (filters.financialYearId) vq = vq.eq("financial_year_id", filters.financialYearId);
      if (filters.dateFrom) vq = vq.gte("voucher_date", filters.dateFrom);
      if (filters.dateTo) vq = vq.lte("voucher_date", filters.dateTo);

      const { data: vouchers } = await vq;
      const voucherIds = (vouchers || []).map((v: any) => v.id);

      // 3. Fetch entries for those vouchers, batched in chunks.
      //    PostgREST-style backends accept larger IN clauses than Apache, but we
      //    still centralize the size so it can be tuned per deployment.
      const { chunkIds: chunkIdsSb, getInChunkSize: getSizeSb, logChunkMetrics: logSb } = await import("@/lib/in-chunk");
      const entries: VoucherEntryBalanceRow[] = [];
      const sbChunkSize = Math.max(getSizeSb(), 500); // non-Apache backends can go higher
      const sbChunks = chunkIdsSb(voucherIds, sbChunkSize);
      for (const chunk of sbChunks) {
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data, error } = await dataClient
            .from("voucher_entries")
            .select("account_id, debit, credit")
            .in("voucher_id", chunk)
            .range(from, from + PAGE_SIZE - 1);
          if (error) break;
          entries.push(...((data || []) as VoucherEntryBalanceRow[]));
          if (!data || data.length < PAGE_SIZE) break;
        }
      }
      logSb("useAccountBalances/dataClient", { totalIds: voucherIds.length, chunkSize: sbChunkSize, chunkCount: sbChunks.length });

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
        const closing = openSigned + txn.credit - txn.debit;
        return {
          ...a,
          total_debit: txn.debit,
          total_credit: txn.credit,
          closing_balance: Math.abs(closing),
          closing_balance_type: (closing >= 0 ? "debit" : "credit") as "debit" | "credit",
          signed_balance: closing,
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
