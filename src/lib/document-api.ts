import { supabase, IS_LARAVEL_ONLY } from "@/integrations/supabase/client";

const FUNCTION_NAME = "document-api";

async function invoke<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body,
  });
  if (error) throw new Error(error.message || "API error");
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export type DocumentType = "sales_invoice" | "production" | "stock_transfer" | "sales_return" | "acc_voucher" | "customer";

// In Laravel/VPS mode the `document-api` edge function isn't deployed.
// For lightweight party records (customer) we can safely fall back
// to a direct table status update — there are no stock or ledger side-effects.
const LARAVEL_SIMPLE_TABLES: Partial<Record<DocumentType, string>> = {
  customer: "customers",
};

async function laravelStatusUpdate(docType: DocumentType, id: string, status: string) {
  const table = LARAVEL_SIMPLE_TABLES[docType];
  if (!table) {
    throw new Error(`Action not supported for '${docType}' in Laravel mode.`);
  }
  const { error } = await (supabase.from(table as any) as any).update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export const documentApi = {
  approve: (docType: DocumentType, id: string) => {
    if (IS_LARAVEL_ONLY && LARAVEL_SIMPLE_TABLES[docType]) {
      return laravelStatusUpdate(docType, id, "approved");
    }
    return invoke({ action: "approve", doc_type: docType, id });
  },

  cancel: (docType: DocumentType, id: string, reason?: string) => {
    if (IS_LARAVEL_ONLY && LARAVEL_SIMPLE_TABLES[docType]) {
      return laravelStatusUpdate(docType, id, "cancelled");
    }
    return invoke({ action: "cancel", doc_type: docType, id, reason });
  },

  editApproved: (docType: DocumentType, id: string, updates?: Record<string, any>, newItems?: any[]) =>
    invoke({ action: "edit_approved", doc_type: docType, id, updates, new_items: newItems }),

  deleteApproved: (docType: DocumentType, id: string, reason: string) =>
    invoke({ action: "delete_approved", doc_type: docType, id, reason }),
};
