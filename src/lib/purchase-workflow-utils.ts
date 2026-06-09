import { supabase } from "@/integrations/supabase/client";
import { nextNumber } from "@/lib/db-utils";

export const newPRNumber = () => nextNumber("purchase_requisition");
export const newPONumber = () => nextNumber("purchase_order_v2");
export const newGRNNumber = () => nextNumber("grn");
export const newBillNumber = () => nextNumber("purchase_bill");
export const newPaymentNumber = () => nextNumber("purchase_bill_payment");

export async function getActiveFinancialYearId(): Promise<string | null> {
  const { data } = await supabase
    .from("financial_years")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return data ? (data as any).id : null;
}
