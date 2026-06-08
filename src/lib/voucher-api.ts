import { supabase } from "@/integrations/supabase/client";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

const FUNCTION_NAME = "voucher-api";

// Detect Laravel-mode (VPS) vs Supabase-mode (Lovable preview).
function isLaravelMode(): boolean {
  return (import.meta as any).env?.VITE_LARAVEL_ONLY_MODE === "true" || Boolean(getApiBaseUrl());
}

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

function unwrapItem(json: any): any {
  return json?.data ?? json;
}

export const voucherApi = {
  list: async (voucher_type: string, include_deleted = false) => {
    if (isLaravelMode()) {
      const qs = include_deleted ? "?include_deleted=1" : "";
      const json = await laravelFetch<any>(`vouchers/${voucher_type}${qs}`);
      return { data: unwrapList(json) } as { data: any[] };
    }
    return invokeEdge<{ data: any[] }>({ action: "list", voucher_type, include_deleted });
  },

  get: async (id: string) => {
    if (isLaravelMode()) {
      const json = await laravelFetch<any>(`vouchers/${id}`);
      const payload = unwrapItem(json);
      return { voucher: payload?.voucher ?? payload, entries: payload?.entries ?? [] };
    }
    return invokeEdge<{ voucher: any; entries: any[] }>({ action: "get", id });
  },

  listAccounts: async () => {
    if (isLaravelMode()) {
      const json = await laravelFetch<any>("db/chart_of_accounts?select=id,account_name,account_code,account_type,parent_id,opening_balance,opening_balance_type,is_active&order[account_code]=asc");
      return { data: unwrapList(json) } as { data: any[] };
    }
    return supabase.from("chart_of_accounts").select("id, account_name, account_code, account_type, parent_id, opening_balance, opening_balance_type, is_active").order("account_code");
  },

  listBranches: async () => {
    if (isLaravelMode()) {
      const json = await laravelFetch<any>("db/branches?select=id,name&order[name]=asc");
      return { data: unwrapList(json) } as { data: any[] };
    }
    return supabase.from("branches").select("id, name");
  },

  listFinancialYears: async () => {
    if (isLaravelMode()) {
      const json = await laravelFetch<any>("db/financial_years?select=id,name&order[start_date]=desc");
      return { data: unwrapList(json) } as { data: any[] };
    }
    return supabase.from("financial_years").select("id, name");
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

  update: async (params: {
    id: string;
    voucher_date: string;
    branch_id?: string | null;
    financial_year_id?: string | null;
    description?: string | null;
    entries: Array<{ account_id: string; debit: number; credit: number; narration: string }>;
    submit: boolean;
  }) => {
    const { id, ...body } = params;
    if (isLaravelMode()) {
      const json = await laravelFetch<any>(`vouchers/${id}`, { method: "PUT", body: JSON.stringify(body) });
      return { voucher: unwrapItem(json) };
    }
    const totalDebit = body.entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
    await supabase.from("acc_vouchers").update({
      voucher_date: body.voucher_date,
      branch_id: body.branch_id || null,
      financial_year_id: body.financial_year_id || null,
      description: body.description || "",
      total_amount: totalDebit,
      status: body.submit ? "pending" : "draft",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    await supabase.from("voucher_entries").delete().eq("voucher_id", id);
    await supabase.from("voucher_entries").insert(body.entries.map((e, i) => ({ ...e, voucher_id: id, sort_order: i })));
    return { voucher: { id } };
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
    if (isLaravelMode()) return laravelFetch(`vouchers/${params.id}/edit-approved`, { method: "POST", body: JSON.stringify(params) });
    return invokeEdge({ action: "edit_approved", ...params });
  },

  deleteApproved: async (id: string, reason: string) => {
    if (isLaravelMode()) return laravelFetch(`vouchers/${id}/delete-approved`, { method: "POST", body: JSON.stringify({ reason }) });
    return invokeEdge({ action: "delete_approved", id, reason });
  },

  restore: async (id: string, reason?: string) => {
    if (isLaravelMode()) return laravelFetch(`vouchers/${id}/restore`, { method: "POST", body: JSON.stringify({ reason }) });
    return invokeEdge({ action: "restore", id, reason });
  },

  reopen: async (id: string, reason: string) => {
    if (isLaravelMode()) return laravelFetch(`vouchers/${id}/reopen`, { method: "POST", body: JSON.stringify({ reason }) });
    return invokeEdge({ action: "reopen", id, reason });
  },

  reverse: async (id: string, reason: string) => {
    if (isLaravelMode()) return laravelFetch(`vouchers/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
    return invokeEdge({ action: "reverse", id, reason });
  },
};
