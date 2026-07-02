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
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text || `HTTP ${res.status}` };
  }
  if (!res.ok) {
    const validationMessages = json?.errors && typeof json.errors === "object"
      ? Object.entries(json.errors)
          .flatMap(([field, value]) => Array.isArray(value) ? value.map((v) => `${field}: ${v}`) : [`${field}: ${String(value)}`])
      : [];
    const msg = [json?.message || json?.error || `HTTP ${res.status}`, ...validationMessages]
      .filter(Boolean)
      .join("\n");
    const err = new Error(msg) as Error & {
      status?: number;
      correlationId?: string;
      requiredAnyOf?: string[];
      payload?: any;
    };
    err.status = res.status;
    err.correlationId = json?.correlation_id ?? json?.data?.correlation_id ?? json?.errors?.correlation_id;
    err.requiredAnyOf = json?.required_any_of ?? json?.data?.required_any_of ?? json?.errors?.required_any_of;
    err.payload = json;
    throw err;
  }
  return json as T;
}

async function invokeEdge<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body });
  if (error) throw new Error(error.message || "API error");
  if ((data as any)?.error) {
    const err = new Error((data as any).error) as Error & { status?: number; correlationId?: string };
    err.status = (data as any)?.status;
    err.correlationId = (data as any)?.correlation_id;
    throw err;
  }
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

export interface VoucherListParams {
  search?: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  page?: number; // 1-based
  per_page?: number;
}

export const voucherApi = {
  list: async (
    voucher_type: string,
    include_deleted = false,
    params: VoucherListParams = {}
  ) => {
    const { search, from, to, page = 1, per_page = 50 } = params;
    if (isLaravelMode()) {
      const qs = new URLSearchParams();
      if (include_deleted) qs.set("include_deleted", "1");
      if (search) qs.set("search", search);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      qs.set("page", String(page));
      qs.set("per_page", String(per_page));
      const json = await laravelFetch<any>(`vouchers/${voucher_type}?${qs.toString()}`);
      const total = Number(json?.meta?.total ?? json?.total ?? unwrapList(json).length) || 0;
      return { data: unwrapList(json), total, page, per_page } as { data: any[]; total: number; page: number; per_page: number };
    }
    return invokeEdge<{ data: any[]; total?: number; page?: number; per_page?: number }>({
      action: "list",
      voucher_type,
      include_deleted,
      search,
      from,
      to,
      page,
      per_page,
    });
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
      const json = await laravelFetch<any>("db/financial_years?select=id,name,start_date,end_date,is_active&order[start_date]=desc");
      return { data: unwrapList(json) } as { data: any[] };
    }
    return supabase.from("financial_years").select("id, name, start_date, end_date, is_active").order("start_date", { ascending: false });
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.voucher_date)) {
      throw new Error("Voucher date is required and must be YYYY-MM-DD.");
    }
    const totalDebit = body.entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
    const { error: voucherError } = await supabase.from("acc_vouchers").update({
      voucher_date: body.voucher_date,
      branch_id: body.branch_id || null,
      financial_year_id: body.financial_year_id || null,
      description: body.description || "",
      total_amount: totalDebit,
      status: body.submit ? "pending" : "draft",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (voucherError) throw voucherError;
    const { error: deleteError } = await supabase.from("voucher_entries").delete().eq("voucher_id", id);
    if (deleteError) throw deleteError;
    const { error: insertError } = await supabase.from("voucher_entries").insert(body.entries.map((e, i) => ({ ...e, voucher_id: id, sort_order: i })));
    if (insertError) throw insertError;
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
    voucher_date?: string;
    branch_id?: string | null;
    financial_year_id?: string | null;
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

  /** Permanently delete a soft-deleted voucher (Super Admin only). */
  purge: async (id: string, reason?: string) => {
    if (isLaravelMode()) return laravelFetch(`vouchers/${id}/purge`, { method: "POST", body: JSON.stringify({ reason }) });

    // Authorization: only Super Admin (null employee_id) may permanently delete.
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) throw new Error("Not authenticated");
    const { data: profile } = await supabase.from("profiles").select("id, name, employee_id").eq("id", uid).single();
    if (!profile || (profile as any).employee_id !== null) {
      throw new Error("Permanent delete is restricted to Super Admins.");
    }

    // Capture voucher snapshot for audit before deletion.
    const { data: voucher } = await supabase.from("acc_vouchers").select("voucher_number, voucher_type, total_amount, status").eq("id", id).single();

    await supabase.from("voucher_entries").delete().eq("voucher_id", id);
    const { error } = await supabase.from("acc_vouchers").delete().eq("id", id);
    if (error) throw error;

    // Audit log entry with voucher id, user, timestamp + reason.
    await supabase.from("audit_log").insert({
      user_id: uid,
      user_name: (profile as any).name || "Super Admin",
      module: "accounting_vouchers",
      action: "voucher_permanently_deleted",
      record_id: id,
      details: `Permanently deleted ${(voucher as any)?.voucher_type || ""} ${(voucher as any)?.voucher_number || id} (amount: ${(voucher as any)?.total_amount ?? "—"}). Reason: ${reason || "(none)"}`,
    } as any);

    return { success: true };
  },

  /**
   * Change an existing voucher's type (e.g. Payment → Journal).
   * Old voucher is soft-deleted with status='transferred'; its serial
   * number is released to the free-list and the very next entry of the
   * old type reuses it. Auto-posted vouchers cannot be transferred.
   * Only implemented on Laravel/VPS mode.
   */
  changeType: async (id: string, newType: string, reason?: string) => {
    if (isLaravelMode()) {
      return laravelFetch<any>(`vouchers/${id}/change-type`, {
        method: "POST",
        body: JSON.stringify({ new_type: newType, reason }),
      });
    }
    throw new Error("Voucher type change is only supported on the VPS/Laravel backend.");
  },
};



