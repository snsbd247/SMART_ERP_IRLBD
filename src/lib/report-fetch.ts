import { supabase } from "@/integrations/supabase/client";

/**
 * Fetch ALL approved voucher_entries for a date range (paginated past the
 * 1000-row Supabase default so reports stay accurate as data grows).
 *
 * The shape matches a typical report select:
 *   account_id, debit, credit, narration, voucher_id,
 *   acc_vouchers!inner(id, voucher_number, voucher_date, voucher_type, status, description, branch_id)
 */
export async function fetchAllVoucherEntries(opts: {
  dateFrom: string;
  dateTo: string;
  branchId?: string | null;
  accountId?: string | null;
  statuses?: string[];
  pageSize?: number;
}): Promise<any[]> {
  const pageSize = opts.pageSize ?? 1000;
  const statuses = opts.statuses && opts.statuses.length > 0 ? opts.statuses : ["approved", "posted"];
  const all: any[] = [];
  let from = 0;
  // Hard cap to avoid runaway loops (50k entries)
  for (let safety = 0; safety < 50; safety++) {
    let q = supabase
      .from("voucher_entries")
      .select(
        "id, account_id, debit, credit, narration, voucher_id, acc_vouchers!inner(id, voucher_number, voucher_date, voucher_type, status, description, branch_id)"
      )
      .in("acc_vouchers.status", statuses)
      .gte("acc_vouchers.voucher_date", opts.dateFrom)
      .lte("acc_vouchers.voucher_date", opts.dateTo)
      .order("voucher_date", { foreignTable: "acc_vouchers", ascending: true })
      .range(from, from + pageSize - 1);
    if (opts.branchId && opts.branchId !== "all") q = q.eq("acc_vouchers.branch_id", opts.branchId);
    if (opts.accountId) q = q.eq("account_id", opts.accountId);
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

/** Coerce a possibly-string numeric column (Supabase decimal) to a number. */
export const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
