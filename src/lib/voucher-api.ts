import { supabase } from "@/integrations/supabase/client";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

const FUNCTION_NAME = "voucher-api";

// Detect Laravel-mode (VPS) vs Supabase-mode (Lovable preview).
function isLaravelMode(): boolean {
  return (import.meta as any).env?.VITE_LARAVEL_ONLY_MODE === "true"
    || typeof window !== "undefined" && window.location.hostname !== "localhost"
       && !window.location.hostname.includes("lovable");
}

async function laravelFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/v1/admin/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...getLaravelAuthHeaders(),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

async function invokeEdge<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body });
  if (error) throw new Error(error.message || "API error");
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

function unwrapList(json: any): any[] {
  // Laravel paginator: { data: [...], current_page, total } OR raw array OR { data: { data: [...] } }
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  return [];
}

export const voucherApi = {
  list: async (voucher_type: string) => {
    if (isLaravelMode()) {
      const json = await laravelFetch<any>(`vouchers/${voucher_type}`);
      return { data: unwrapList(json) } as { data: any[] };
    }
    return invokeEdge<{ data: any[] }>({ action: "list", voucher_type });
  },

  get: async (id: string) => {
    if (isLaravelMode()) {
      const json = await laravelFetch<any>(`vouchers/${id}`);
      const payload = json?.data ?? json;
      return { voucher: payload?.voucher ?? payload, entries: payload?.entries ?? [] };
    }
    return invokeEdge<{ voucher: any; entries: any[] }>({ action: "get", id });
  },

  create: async (params: {
    voucher_type: string;
    voucher_date: string;
    branch_id?: string;
    financial_year_id?: string;
    description: string;
    entries: Array<{ account_id: string; debit: number; credit: number; narration: string }>;
    submit: boolean;
  }) => {
    if (isLaravelMode()) {
      const { voucher_type, ...body } = params;
      const json = await laravelFetch<any>(`vouchers/${voucher_type}`, {
        method: "POST",
        body: JSON.stringify({ voucher_type, ...body }),
      });
      return { voucher: json?.data ?? json };
    }
    return invokeEdge<{ voucher: any }>({ action: "create", ...params });
  },

  approve: async (id: string) => {
    if (isLaravelMode()) return laravelFetch(`vouchers/${id}/approve`, { method: "POST" });
    return invokeEdge({ action: "approve", id });
  },

  reject: async (id: string, reason?: string) => {
    if (isLaravelMode()) {
      return laravelFetch(`vouchers/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    }
    return invokeEdge({ action: "reject", id, reason });
  },

  editApproved: async (params: {
    id: string;
    description?: string;
    entries?: Array<{ account_id: string; debit: number; credit: number; narration: string }>;
  }) => {
    if (isLaravelMode()) throw new Error("Edit approved voucher is not yet available in Laravel mode.");
    return invokeEdge({ action: "edit_approved", ...params });
  },

  deleteApproved: async (id: string, reason: string) => {
    if (isLaravelMode()) throw new Error("Delete approved voucher is not yet available in Laravel mode.");
    return invokeEdge({ action: "delete_approved", id, reason });
  },

  reopen: async (id: string, reason: string) => {
    if (isLaravelMode()) throw new Error("Reopen voucher is not yet available in Laravel mode.");
    return invokeEdge({ action: "reopen", id, reason });
  },

  reverse: async (id: string, reason: string) => {
    if (isLaravelMode()) throw new Error("Reverse voucher is not yet available in Laravel mode.");
    return invokeEdge({ action: "reverse", id, reason });
  },
};
