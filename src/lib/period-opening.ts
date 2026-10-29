/**
 * Centralized "period opening balance" computation.
 *
 * Used by every ledger / statement view so that the opening balance for any
 * selected period equals the prior period's closing — i.e. opening rolls
 * forward across months/years and never silently reverts to the all-time base
 * opening from chart_of_accounts.
 *
 * Formula (matches `src/lib/ledger-balance.ts`):
 *   Closing = Opening + Credit − Debit
 *
 * Signed convention: negative balances stay negative (no Dr/Cr suffix).
 */

import { dataClient } from "@/integrations/data/client";
import { signedOpeningBalance } from "@/lib/balance-format";
import { applyEntry } from "@/lib/ledger-balance";
import { fetchAllVoucherEntries, laravelGet } from "@/lib/report-fetch";
import { isLaravelMode } from "@/lib/laravel-auth";

export interface PriorEntry {
  id: string;
  voucher_id?: string | null;
  voucher_number?: string | null;
  voucher_date: string;
  debit: number;
  credit: number;
  running_balance: number;
  description?: string | null;
}

export interface AccountPeriodOpeningResult {
  baseOpening: number;
  opening: number;
  priorEntries: PriorEntry[];
}

export interface CustomerPriorRow {
  id: string;
  date: string;
  type: "Invoice" | "Payment" | "Return";
  reference: string;
  debit: number;
  credit: number;
  running_balance: number;
}

export interface CustomerPeriodOpeningResult {
  opening: number;
  priorRows: CustomerPriorRow[];
}

/** Subtract one day from a YYYY-MM-DD string (UTC, no TZ drift). */
function prevDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the period opening balance for a single Chart-of-Accounts node.
 *
 * The opening NUMBER only needs the sum of every approved/posted entry
 * strictly before `dateFrom` — it does not need each individual entry row.
 * In Laravel mode we ask the server for that sum directly (one aggregate
 * SQL query) instead of pulling potentially years of prior transactions
 * across the network just to add them up client-side. The detailed
 * breakdown (`priorEntries`) is only needed by the "Opening Balance"
 * drilldown dialog, which most report loads never open — fetch it lazily
 * via `fetchAccountPriorEntries` instead of eagerly here.
 */
export async function computeAccountPeriodOpening(opts: {
  accountId: string;
  dateFrom: string;
  branchId?: string | null;
  createdBy?: string | null;
  statuses?: string[];
  /** Optional preloaded account to avoid an extra fetch */
  account?: {
    opening_balance?: number | string | null;
    opening_balance_type?: string | null;
  } | null;
}): Promise<AccountPeriodOpeningResult> {
  let account = opts.account ?? null;
  if (!account) {
    const { data } = await dataClient
      .from("chart_of_accounts")
      .select("opening_balance, opening_balance_type")
      .eq("id", opts.accountId)
      .maybeSingle();
    account = data ?? null;
  }
  const baseOpening = account
    ? signedOpeningBalance(account.opening_balance as any, account.opening_balance_type as any)
    : 0;

  const priorTo = prevDay(opts.dateFrom);
  // Skip the fetch entirely if dateFrom is at/before our epoch sentinel.
  if (priorTo < "1900-01-01") {
    return { baseOpening, opening: baseOpening, priorEntries: [] };
  }
  const statuses = opts.statuses ?? ["approved", "posted"];

  if (isLaravelMode()) {
    try {
      const qs = new URLSearchParams({ account_id: opts.accountId, date_to: priorTo, statuses: statuses.join(",") });
      if (opts.branchId && opts.branchId !== "all") qs.set("branch_id", opts.branchId);
      if (opts.createdBy && opts.createdBy !== "all") qs.set("created_by", opts.createdBy);
      const json = await laravelGet(`reports/account-opening-sum?${qs.toString()}`);
      const sum = json?.data ?? json;
      const opening = applyEntry(baseOpening, { debit: Number(sum?.debit) || 0, credit: Number(sum?.credit) || 0 });
      return { baseOpening, opening, priorEntries: [] };
    } catch (e) {
      console.error("[period-opening] account-opening-sum failed, falling back to row fetch", e);
      // fall through to the row-fetch path below
    }
  }

  const raw = await fetchAllVoucherEntries({
    dateFrom: "1900-01-01",
    dateTo: priorTo,
    branchId: opts.branchId ?? null,
    accountId: opts.accountId,
    createdBy: opts.createdBy ?? null,
    statuses,
  });

  let running = baseOpening;
  raw.forEach((e: any) => { running = applyEntry(running, { debit: e.debit, credit: e.credit }); });

  return { baseOpening, opening: running, priorEntries: [] };
}

/**
 * Full prior-period entry breakdown for the "Opening Balance" drilldown
 * dialog — fetches every approved/posted entry strictly before `dateFrom`
 * and folds them through the ledger formula to build a running balance.
 * This is the (network-heavy) row-level fetch that `computeAccountPeriodOpening`
 * intentionally skips; call it only when the user actually opens the drilldown.
 */
export async function fetchAccountPriorEntries(opts: {
  accountId: string;
  dateFrom: string;
  branchId?: string | null;
  createdBy?: string | null;
  statuses?: string[];
  baseOpening: number;
}): Promise<PriorEntry[]> {
  const priorTo = prevDay(opts.dateFrom);
  if (priorTo < "1900-01-01") return [];

  const raw = await fetchAllVoucherEntries({
    dateFrom: "1900-01-01",
    dateTo: priorTo,
    branchId: opts.branchId ?? null,
    accountId: opts.accountId,
    createdBy: opts.createdBy ?? null,
    statuses: opts.statuses ?? ["approved", "posted"],
  });

  let running = opts.baseOpening;
  return raw.map((e: any) => {
    running = applyEntry(running, { debit: e.debit, credit: e.credit });
    return {
      id: String(e.id),
      voucher_id: e.acc_vouchers?.id ?? e.voucher_id ?? null,
      voucher_number: e.acc_vouchers?.voucher_number ?? null,
      voucher_date: e.acc_vouchers?.voucher_date ?? "",
      debit: Number(e.debit) || 0,
      credit: Number(e.credit) || 0,
      running_balance: running,
      description: e.acc_vouchers?.description ?? e.narration ?? null,
    };
  });
}

/**
 * Aggregate period opening for a collection of accounts (e.g. all Cash or
 * all Bank accounts). Runs in parallel for speed.
 */
export async function computeAggregateAccountPeriodOpening(opts: {
  accounts: Array<{
    id: string;
    opening_balance?: number | string | null;
    opening_balance_type?: string | null;
  }>;
  dateFrom: string;
  branchId?: string | null;
  statuses?: string[];
}): Promise<number> {
  if (opts.accounts.length === 0) return 0;
  const parts = await Promise.all(
    opts.accounts.map((a) =>
      computeAccountPeriodOpening({
        accountId: a.id,
        dateFrom: opts.dateFrom,
        branchId: opts.branchId,
        statuses: opts.statuses,
        account: a,
      })
    )
  );
  return parts.reduce((s, p) => s + p.opening, 0);
}

/**
 * Compute the period opening for a customer statement / profile ledger.
 * Sums invoices (debit) + sales returns (credit) + payments (credit) strictly
 * before `dateFrom`.
 */
export async function computeCustomerPeriodOpening(opts: {
  customerId: string;
  dateFrom: string;
}): Promise<CustomerPeriodOpeningResult> {
  const priorTo = prevDay(opts.dateFrom);

  const [invRes, payRes, retRes] = await Promise.all([
    dataClient
      .from("sales_invoices")
      .select("id, invoice_number, invoice_date, net_amount, total_amount")
      .eq("customer_id", opts.customerId)
      .lte("invoice_date", priorTo)
      .order("invoice_date"),
    dataClient
      .from("party_payments")
      .select("id, payment_date, amount, payment_method, reference")
      .eq("party_id", opts.customerId)
      .eq("party_type", "customer")
      .lte("payment_date", priorTo)
      .order("payment_date"),
    dataClient
      .from("sales_returns")
      .select("id, return_number, return_date, total_amount")
      .eq("customer_id", opts.customerId)
      .lte("return_date", priorTo)
      .order("return_date"),
  ]);

  type Row = { date: string; type: CustomerPriorRow["type"]; ref: string; debit: number; credit: number; id: string };
  const all: Row[] = [];
  (invRes.data || []).forEach((inv: any) =>
    all.push({
      id: inv.id,
      date: inv.invoice_date,
      type: "Invoice",
      ref: inv.invoice_number,
      debit: Number(inv.net_amount || inv.total_amount) || 0,
      credit: 0,
    })
  );
  (payRes.data || []).forEach((p: any) =>
    all.push({
      id: p.id,
      date: p.payment_date,
      type: "Payment",
      ref: p.reference || String(p.id).slice(0, 8),
      debit: 0,
      credit: Number(p.amount) || 0,
    })
  );
  (retRes.data || []).forEach((r: any) =>
    all.push({
      id: r.id,
      date: r.return_date,
      type: "Return",
      ref: r.return_number,
      debit: 0,
      credit: Number(r.total_amount) || 0,
    })
  );
  all.sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const priorRows: CustomerPriorRow[] = all.map((t) => {
    running += t.debit - t.credit;
    return {
      id: t.id,
      date: t.date,
      type: t.type,
      reference: t.ref,
      debit: t.debit,
      credit: t.credit,
      running_balance: running,
    };
  });

  return { opening: running, priorRows };
}

export const __test = { prevDay };
