import { supabase } from "@/integrations/supabase/client";

/** Generate a document number using year + row count. Fallback when number_sequences not seeded. */
export async function genDocNumber(prefix: string, table: string): Promise<string> {
  const yr = new Date().getFullYear();
  const { count } = await supabase.from(table as any).select("*", { count: "exact", head: true });
  return `${prefix}-${yr}-${String((count || 0) + 1).padStart(5, "0")}`;
}

export const PR_PREFIX = "PRQ";
export const POV2_PREFIX = "POV";
export const GRN_PREFIX = "GRN";
export const BILL_PREFIX = "PBL";
export const PAY_PREFIX = "PPM";
