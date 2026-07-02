import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getApiBaseUrl, getLaravelAuthHeaders, isLaravelMode } from "@/lib/laravel-auth";
import { signedOpeningBalance } from "@/lib/balance-format";
import { BALANCE_VOUCHER_STATUSES } from "@/lib/shared-balance";
import { emitChunkRetry } from "@/lib/chunk-status";

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
        // Match Account Ledger default (approved + posted) so the "Curr Bal"
        // shown on the New Voucher screen equals the ledger closing balance.
        voucherFilters.set("f[status][in]", "approved,posted");
        if (filters.branchId) voucherFilters.set("f[branch_id][eq]", filters.branchId);
        if (filters.financialYearId) voucherFilters.set("f[financial_year_id][eq]", filters.financialYearId);
        if (filters.dateFrom) voucherFilters.set("f[voucher_date][gte]", filters.dateFrom);
        if (filters.dateTo) voucherFilters.set("f[voucher_date][lte]", filters.dateTo);
        const vouchers = await laravelGetList(`db/acc_vouchers?${voucherFilters.toString()}`);
        const voucherIds = vouchers.map((v: any) => v.id);
        const entries: VoucherEntryBalanceRow[] = [];
        // Chunked to stay below Apache LimitRequestLine; see lib/in-chunk.ts.
        const { chunkIds, getInChunkSize, isUrlTooLargeError, logChunkMetrics } = await import("@/lib/in-chunk");
        const { toast } = await import("sonner");
        let chunkSize = getInChunkSize();
        let toasted = false;
        const chunks = chunkIds(voucherIds, chunkSize);
        for (let ci = 0; ci < chunks.length; ci++) {
          let slice = chunks[ci];
          let attempts = 0;
          while (attempts < 4) {
            try {
              entries.push(...await laravelGetList(`db/voucher_entries?select=account_id,debit,credit&f[voucher_id][in]=${encodeURIComponent(slice.join(","))}`));
              break;
            } catch (err) {
              if (isUrlTooLargeError(err) && slice.length > 10) {
                if (!toasted) {
                  toasted = true;
                  toast.warning("Balances request exceeded server URL limit — falling back to smaller batches.");
                }
                const half = Math.max(10, Math.floor(slice.length / 2));
                chunks.splice(ci + 1, 0, slice.slice(half));
                slice = slice.slice(0, half);
                chunkSize = half;
                attempts++;
                continue;
              }
              throw err;
            }
          }
        }
        logChunkMetrics("useAccountBalances/laravel", { totalIds: voucherIds.length, chunkSize, chunkCount: chunks.length });
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
          const closing = openSigned + txn.credit - txn.debit;
          return { ...a, total_debit: txn.debit, total_credit: txn.credit, closing_balance: Math.abs(closing), closing_balance_type: (closing >= 0 ? "debit" : "credit") as "debit" | "credit", signed_balance: closing };
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
      let vq = supabase
        .from("acc_vouchers")
        .select("id")
        .in("status", ["approved", "posted"]);
      if (filters.branchId) vq = vq.eq("branch_id", filters.branchId);
      if (filters.financialYearId) vq = vq.eq("financial_year_id", filters.financialYearId);
      if (filters.dateFrom) vq = vq.gte("voucher_date", filters.dateFrom);
      if (filters.dateTo) vq = vq.lte("voucher_date", filters.dateTo);

      const { data: vouchers } = await vq;
      const voucherIds = (vouchers || []).map((v: any) => v.id);

      // 3. Fetch entries for those vouchers, batched in chunks.
      //    Supabase's PostgREST accepts larger IN clauses than Apache, but we
      //    still centralize the size so it can be tuned per deployment.
      const { chunkIds: chunkIdsSb, getInChunkSize: getSizeSb, logChunkMetrics: logSb } = await import("@/lib/in-chunk");
      const entries: VoucherEntryBalanceRow[] = [];
      const sbChunkSize = Math.max(getSizeSb(), 500); // Supabase can safely go higher
      const sbChunks = chunkIdsSb(voucherIds, sbChunkSize);
      for (const chunk of sbChunks) {
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
      logSb("useAccountBalances/supabase", { totalIds: voucherIds.length, chunkSize: sbChunkSize, chunkCount: sbChunks.length });

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
