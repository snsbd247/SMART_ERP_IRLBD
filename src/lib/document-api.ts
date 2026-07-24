import { supabase, IS_LARAVEL_ONLY } from "@/integrations/supabase/client";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

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

// REST route prefix (under /v1) for document types backed by a real Laravel
// controller with approve/cancel/edit-approved/delete-approved endpoints
// (see erp-backend/routes/api.php). acc_voucher intentionally has its own
// dedicated client (`@/lib/voucher-api`) with richer voucher-specific
// payloads, so it is not routed through here.
const LARAVEL_ROUTE_PREFIX: Partial<Record<DocumentType, string>> = {
  sales_invoice: "sales-invoices",
  production: "production",
  stock_transfer: "stock-transfers",
  sales_return: "sales-returns",
};

async function laravelFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const apiBase = getApiBaseUrl();
  if (!apiBase) throw new Error("Laravel API URL not configured");
  const base = apiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/v1/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...getLaravelAuthHeaders(),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text || `HTTP ${res.status}` };
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export const documentApi = {
  approve: (docType: DocumentType, id: string) => {
    if (IS_LARAVEL_ONLY && LARAVEL_SIMPLE_TABLES[docType]) {
      return laravelStatusUpdate(docType, id, "approved");
    }
    if (IS_LARAVEL_ONLY && LARAVEL_ROUTE_PREFIX[docType]) {
      return laravelFetch(`${LARAVEL_ROUTE_PREFIX[docType]}/${id}/approve`, { method: "POST" });
    }
    return invoke({ action: "approve", doc_type: docType, id });
  },

  cancel: (docType: DocumentType, id: string, reason?: string) => {
    if (IS_LARAVEL_ONLY && LARAVEL_SIMPLE_TABLES[docType]) {
      return laravelStatusUpdate(docType, id, "cancelled");
    }
    if (IS_LARAVEL_ONLY && LARAVEL_ROUTE_PREFIX[docType]) {
      return laravelFetch(`${LARAVEL_ROUTE_PREFIX[docType]}/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    }
    return invoke({ action: "cancel", doc_type: docType, id, reason });
  },

  editApproved: (docType: DocumentType, id: string, updates?: Record<string, any>, newItems?: any[]) => {
    if (IS_LARAVEL_ONLY && LARAVEL_ROUTE_PREFIX[docType]) {
      // NOTE: newItems is sent for backward compatibility with callers that
      // pass an item list, but the Laravel edit-approved endpoints for these
      // document types intentionally only update header fields — they do
      // NOT recompute items/stock/accounting (no reversal helper exists for
      // that yet). Extra fields are simply ignored server-side.
      return laravelFetch(`${LARAVEL_ROUTE_PREFIX[docType]}/${id}/edit-approved`, {
        method: "POST",
        body: JSON.stringify({ ...updates, new_items: newItems }),
      });
    }
    return invoke({ action: "edit_approved", doc_type: docType, id, updates, new_items: newItems });
  },

  deleteApproved: (docType: DocumentType, id: string, reason: string) => {
    if (IS_LARAVEL_ONLY && LARAVEL_ROUTE_PREFIX[docType]) {
      return laravelFetch(`${LARAVEL_ROUTE_PREFIX[docType]}/${id}/delete-approved`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    }
    return invoke({ action: "delete_approved", doc_type: docType, id, reason });
  },
};
