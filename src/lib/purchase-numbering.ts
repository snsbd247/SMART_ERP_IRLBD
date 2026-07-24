import { supabase } from "@/integrations/supabase/client";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

const VOUCHER_PREFIX_TO_SEQUENCE: Record<string, string> = {
  JV: "journal_voucher",
  PV: "payment_voucher",
  RV: "receipt_voucher",
  CV: "contra_voucher",
};

const VOUCHER_PREFIX_TO_TYPE: Record<string, "journal" | "payment" | "receipt" | "contra"> = {
  JV: "journal",
  PV: "payment",
  RV: "receipt",
  CV: "contra",
};

/**
 * Create + auto-approve an accounting voucher via the real Laravel voucher
 * endpoint (numbering, financial-year resolution, and posting all run
 * server-side — no separate number-reservation RPC needed). Used by the
 * purchase module's auto-post helpers (bills, payments, GRNs, returns).
 */
export async function createVoucherLaravel(params: {
  prefix: "JV" | "PV" | "RV" | "CV";
  voucher_date: string;
  branch_id?: string | null;
  description: string;
  entries: Array<{ account_id: string; debit: number; credit: number; narration?: string }>;
}): Promise<{ voucherId: string; voucherNumber: string }> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("Laravel API URL not configured");
  const voucher_type = VOUCHER_PREFIX_TO_TYPE[params.prefix];
  const res = await fetch(`${base}/v1/vouchers/${voucher_type}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...getLaravelAuthHeaders(),
    },
    body: JSON.stringify({
      voucher_type,
      voucher_date: params.voucher_date,
      branch_id: params.branch_id || null,
      description: params.description,
      entries: params.entries.map((e) => ({
        account_id: e.account_id,
        debit: e.debit || 0,
        credit: e.credit || 0,
        narration: e.narration || params.description,
      })),
      submit: true,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.message || json?.error || `Failed to post voucher (HTTP ${res.status})`);
  }
  const voucher = json?.data?.voucher ?? json?.voucher ?? json?.data ?? json;
  return { voucherId: voucher?.id, voucherNumber: voucher?.voucher_number };
}

/**
 * Compute next document number using purchase_settings prefix.
 * Format: PREFIX-YYYY-NNNN  (per-year sequence per prefix).
 */
export async function nextDocNo(prefix: string, table: string, column: string): Promise<string> {
  if (table === "acc_vouchers" && column === "voucher_number" && VOUCHER_PREFIX_TO_SEQUENCE[prefix]) {
    const { data, error } = await (supabase as any).rpc("reserve_voucher_number", {
      _sequence_id: VOUCHER_PREFIX_TO_SEQUENCE[prefix],
    });

    if (error || !data) {
      throw new Error(`Failed to reserve voucher number: ${error?.message || "No number returned"}`);
    }

    return String(data);
  }

  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const { data } = await supabase
    .from(table as any)
    .select(column)
    .like(column, like)
    .order(column, { ascending: false })
    .limit(1);
  let next = 1;
  if (data && data.length > 0) {
    const last = (data[0] as any)[column] as string;
    const tail = parseInt(last.split("-").pop() || "0", 10);
    if (!Number.isNaN(tail)) next = tail + 1;
  }
  return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
}

export async function getPurchaseSettings() {
  const { data } = await supabase.from("purchase_settings" as any).select("*").limit(1).maybeSingle();
  return data as any;
}

export async function logAudit(params: {
  document_type: string;
  document_id: string;
  document_no?: string;
  action: string;
  notes?: string;
  performed_by?: string;
  performed_by_name?: string;
  old_value?: any;
  new_value?: any;
}) {
  await supabase.from("purchase_audit_log" as any).insert(params as any);
}
