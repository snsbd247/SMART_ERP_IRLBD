import { dataClient } from "@/integrations/data/client";
import { isLaravelMode, getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";
import {
  getInChunkSize,
  isUrlTooLargeError,
  logChunkMetrics,
  estimateInClauseUrlLength,
  runChunkedParallel,
} from "@/lib/in-chunk";
import { toast } from "sonner";

/**
 * Fetch ALL voucher_entries for a date range with the parent voucher embedded
 * under `acc_vouchers`. Works in BOTH modes:
 *
 *  - legacy mode: uses a PostgREST relation embed with `acc_vouchers!inner`
 *    so the date/status/branch filters live on the parent table.
 *  - Laravel mode (VPS): the generic CRUD endpoint cannot honor foreign-table
 *    filters, so we first fetch the matching `acc_vouchers` rows directly
 *    (date range + status + branch), then load their `voucher_entries` in
 *    chunked `voucher_id IN (...)` queries and stitch the voucher back onto
 *    each entry under the `acc_vouchers` key so the existing report code
 *    keeps working unchanged.
 *
 * Paginates past the default 1000-row cap so reports stay accurate as data grows.
 */
export async function fetchAllVoucherEntries(opts: {
  dateFrom: string;
  dateTo: string;
  branchId?: string | null;
  accountId?: string | null;
  createdBy?: string | null;
  statuses?: string[];
  pageSize?: number;
}): Promise<any[]> {
  const pageSize = opts.pageSize ?? 1000;
  const statuses = opts.statuses && opts.statuses.length > 0 ? opts.statuses : ["approved", "posted"];

  // -------- Laravel (VPS) mode --------
  if (isLaravelMode()) {
    return fetchAllVoucherEntriesLaravel({ ...opts, statuses, pageSize });
  }

  // -------- legacy mode --------
  const all: any[] = [];
  let from = 0;
  for (let safety = 0; safety < 50; safety++) {
    let q = dataClient
      .from("voucher_entries")
      .select(
        "id, account_id, debit, credit, narration, voucher_id, acc_vouchers!inner(id, voucher_number, voucher_date, voucher_type, status, description, branch_id)"
      )
      .in("acc_vouchers.status", statuses)
      .is("acc_vouchers.deleted_at", null)
      .gte("acc_vouchers.voucher_date", opts.dateFrom)
      .lte("acc_vouchers.voucher_date", opts.dateTo)
      .order("voucher_date", { foreignTable: "acc_vouchers", ascending: true })
      .range(from, from + pageSize - 1);
    if (opts.branchId && opts.branchId !== "all") q = q.eq("acc_vouchers.branch_id", opts.branchId);
    if (opts.accountId) q = q.eq("account_id", opts.accountId);
    if (opts.createdBy && opts.createdBy !== "all") q = q.eq("acc_vouchers.created_by", opts.createdBy);
    const { data, error } = await q;
    if (error) {
      console.error("[report-fetch] voucher_entries page error", error);
      break;
    }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function laravelGet(path: string): Promise<any> {
  const base = (getApiBaseUrl() || "").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/${path.replace(/^\//, "")}`, {
    headers: { Accept: "application/json", ...getLaravelAuthHeaders() },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
  return json;
}

function unwrapList(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  return [];
}

async function fetchAllVoucherEntriesLaravel(opts: {
  dateFrom: string;
  dateTo: string;
  branchId?: string | null;
  accountId?: string | null;
  createdBy?: string | null;
  statuses: string[];
  pageSize: number;
}): Promise<any[]> {
  // 1) Fetch matching vouchers (date range + status [+ branch]) via the
  //    generic CRUD endpoint. Paginate to avoid the 1000-row cap.
  const vouchers: any[] = [];
  let offset = 0;
  for (let safety = 0; safety < 50; safety++) {
    const parts: string[] = [
      "select=id,voucher_number,voucher_date,voucher_type,status,description,branch_id",
      `f%5Bvoucher_date%5D%5Bgte%5D=${encodeURIComponent(opts.dateFrom)}`,
      `f%5Bvoucher_date%5D%5Blte%5D=${encodeURIComponent(opts.dateTo)}`,
      `f%5Bstatus%5D%5Bin%5D=${encodeURIComponent(opts.statuses.join(","))}`,
      `f%5Bdeleted_at%5D%5Bis%5D=null`,
      `order%5Bvoucher_date%5D=asc`,
      `limit=${opts.pageSize}`,
      `offset=${offset}`,
    ];
    if (opts.branchId && opts.branchId !== "all") {
      parts.push(`f%5Bbranch_id%5D%5Beq%5D=${encodeURIComponent(opts.branchId)}`);
    }
    if (opts.createdBy && opts.createdBy !== "all") {
      parts.push(`f%5Bcreated_by%5D%5Beq%5D=${encodeURIComponent(opts.createdBy)}`);
    }

    let page: any[] = [];
    try {
      const json = await laravelGet(`db/acc_vouchers?${parts.join("&")}`);
      page = unwrapList(json);
    } catch (e) {
      console.error("[report-fetch] laravel vouchers page error", e);
      break;
    }
    vouchers.push(...page);
    if (page.length < opts.pageSize) break;
    offset += opts.pageSize;
  }
  if (vouchers.length === 0) return [];

  const voucherById = new Map<string, any>(vouchers.map((v) => [String(v.id), v]));
  const voucherIds = vouchers.map((v) => String(v.id));

  // 2) Fetch voucher_entries in chunks of IDs, concurrently — network round-trip
  //    latency (not server/DB time) dominates report load time, so chunks are
  //    fired in parallel instead of awaited one-at-a-time. Chunk size is
  //    configurable via VITE_IN_CHUNK_SIZE (see lib/in-chunk.ts). On a 414
  //    response a chunk is recursively halved and retried (still in parallel)
  //    so a mis-tuned deployment degrades to more, smaller requests instead of
  //    returning an empty report.
  const chunkSize = getInChunkSize();
  let maxUrl = 0;
  let toastedFallback = false;
  const buildPath = (slice: string[]): string => {
    const parts: string[] = [
      "select=id,account_id,debit,credit,narration,voucher_id",
      `f%5Bvoucher_id%5D%5Bin%5D=${encodeURIComponent(slice.join(","))}`,
      `limit=10000`,
    ];
    if (opts.accountId) parts.push(`f%5Baccount_id%5D%5Beq%5D=${encodeURIComponent(opts.accountId)}`);
    return `db/voucher_entries?${parts.join("&")}`;
  };

  const entries = await runChunkedParallel(voucherIds, async (slice) => {
    const path = buildPath(slice);
    maxUrl = Math.max(maxUrl, estimateInClauseUrlLength(path, []));
    try {
      const json = await laravelGet(path);
      const rows: any[] = [];
      for (const e of unwrapList(json)) {
        const v = voucherById.get(String(e.voucher_id));
        if (!v) continue;
        rows.push({ ...e, acc_vouchers: v });
      }
      return { rows };
    } catch (err) {
      if (isUrlTooLargeError(err) && slice.length > 10) {
        if (!toastedFallback) {
          toastedFallback = true;
          toast.warning(
            "Report request exceeded server URL limit — falling back to smaller batches.",
          );
          console.warn("[report-fetch] 414 fallback engaged", { sliceLen: slice.length });
        }
        return { tooLarge: true };
      }
      console.error("[report-fetch] laravel entries page error", err);
      return { rows: [] };
    }
  }, { chunkSize });
  logChunkMetrics("report-fetch/voucher_entries", {
    totalIds: voucherIds.length,
    chunkSize,
    chunkCount: Math.ceil(voucherIds.length / chunkSize) || 0,
    maxUrlBytes: maxUrl,
  });

  // 3) Sort by voucher_date asc (parity with legacy branch).
  entries.sort((a, b) => String(a.acc_vouchers?.voucher_date || "").localeCompare(String(b.acc_vouchers?.voucher_date || "")));
  return entries;
}

/**
 * Account Ledger entries for a period, via the dedicated server-side-join
 * endpoint (`AccountingService::accountLedgerEntries`) — one request instead
 * of the vouchers → entries → counter-accounts three-hop chain the generic
 * CRUD bridge requires. Laravel mode only; returns null on any failure (or
 * outside Laravel mode) so the caller can fall back to the row-by-row path.
 */
export async function fetchAccountLedgerEntriesLaravel(opts: {
  accountId: string;
  dateFrom: string;
  dateTo: string;
  branchId?: string | null;
  createdBy?: string | null;
  statuses: string[];
}): Promise<{ entries: any[]; counterAccounts: Record<string, string[]> } | null> {
  if (!isLaravelMode()) return null;
  try {
    const qs = new URLSearchParams({
      account_id: opts.accountId,
      date_from: opts.dateFrom,
      date_to: opts.dateTo,
      statuses: opts.statuses.join(","),
    });
    if (opts.branchId && opts.branchId !== "all") qs.set("branch_id", opts.branchId);
    if (opts.createdBy && opts.createdBy !== "all") qs.set("created_by", opts.createdBy);
    const json = await laravelGet(`reports/account-ledger-entries?${qs.toString()}`);
    const payload = json?.data ?? json;
    return { entries: payload?.entries ?? [], counterAccounts: payload?.counter_accounts ?? {} };
  } catch (e) {
    console.error("[report-fetch] account-ledger-entries failed, falling back to row-by-row fetch", e);
    return null;
  }
}

/**
 * Distinct users who have created at least one voucher — powers Account
 * Ledger's "User" filter dropdown. Laravel mode only; returns [] otherwise
 * or on any failure (the filter just won't have options, non-fatal).
 */
export async function fetchVoucherCreators(): Promise<{ id: string; name: string }[]> {
  if (!isLaravelMode()) return [];
  try {
    const json = await laravelGet("reports/voucher-creators");
    return unwrapList(json);
  } catch (e) {
    console.error("[report-fetch] voucher-creators failed", e);
    return [];
  }
}

/** Coerce a possibly-string numeric column (decimal) to a number. */
export const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
