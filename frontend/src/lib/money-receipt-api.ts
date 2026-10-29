import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

const API_BASE = getApiBaseUrl() || "";

async function apiCall(url: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...getLaravelAuthHeaders(), ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
  if (!res.ok) {
    const validationMessages = json?.errors && typeof json.errors === "object"
      ? Object.entries(json.errors).flatMap(([field, value]) =>
          Array.isArray(value) ? value.map((v) => `${field}: ${v}`) : [`${field}: ${String(value)}`])
      : [];
    throw new Error([json.message || `HTTP ${res.status}`, ...validationMessages].filter(Boolean).join("\n"));
  }
  return json;
}

export interface MoneyReceipt {
  id: string;
  receipt_no: string;
  receipt_voucher_id: string | null;
  receipt_voucher?: { id: string; voucher_number: string; voucher_date?: string; total_amount?: number } | null;
  customer_id: string | null;
  customer?: { id: string; name: string; address?: string | null } | null;
  received_from: string;
  address: string | null;
  on_account_of: string | null;
  on_account_ledger_id: string | null;
  on_account_ledger?: { id: string; account_name: string; account_code?: string } | null;
  payment_mode: "cash" | "cheque" | "po" | "dd";
  payment_ref_no: string | null;
  receipt_date: string;
  against_bill_no: string | null;
  against_bill_date: string | null;
  amount: number;
  amount_in_words: string | null;
  branch_id: string | null;
  verify_code: string;
  created_by: string | null;
  creator?: { id: string; name?: string | null; username?: string | null } | null;
  created_at: string;
}

export interface MoneyReceiptListParams {
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
}

export const moneyReceiptApi = {
  list: async (params: MoneyReceiptListParams = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    qs.set("page", String(params.page || 1));
    qs.set("per_page", String(params.per_page || 50));
    const json = await apiCall(`/v1/money-receipts?${qs.toString()}`);
    return { data: (json.data || []) as MoneyReceipt[], total: Number(json?.meta?.total ?? (json.data || []).length) || 0 };
  },

  get: async (id: string) => {
    const json = await apiCall(`/v1/money-receipts/${id}`);
    return (json.data ?? json) as MoneyReceipt;
  },

  create: async (payload: Partial<MoneyReceipt>) => {
    const json = await apiCall(`/v1/money-receipts`, { method: "POST", body: JSON.stringify(payload) });
    return (json.data ?? json) as MoneyReceipt;
  },

  update: async (id: string, payload: Partial<MoneyReceipt>) => {
    const json = await apiCall(`/v1/money-receipts/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    return (json.data ?? json) as MoneyReceipt;
  },

  remove: async (id: string) => {
    await apiCall(`/v1/money-receipts/${id}`, { method: "DELETE" });
  },

  getSettings: async () => {
    const json = await apiCall(`/v1/money-receipts-settings`);
    return json.data as { last_number: number; next_number: string };
  },

  updateSettings: async (lastNumber: number) => {
    const json = await apiCall(`/v1/money-receipts-settings`, { method: "PUT", body: JSON.stringify({ last_number: lastNumber }) });
    return json.data as { last_number: number; next_number: string };
  },

  receiptVouchersForCustomer: async (customerId: string) => {
    const json = await apiCall(`/v1/money-receipts/customers/${customerId}/receipt-vouchers`);
    return (json.data || []) as Array<{ id: string; voucher_number: string; voucher_date: string; total_amount: number }>;
  },
};
