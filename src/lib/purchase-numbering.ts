import { supabase } from "@/integrations/supabase/client";

/**
 * Compute next document number using purchase_settings prefix.
 * Format: PREFIX-YYYY-NNNN  (per-year sequence per prefix).
 */
export async function nextDocNo(prefix: string, table: string, column: string): Promise<string> {
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
