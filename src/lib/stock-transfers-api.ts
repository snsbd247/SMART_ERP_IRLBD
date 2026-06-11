import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

const path = "/stock-transfers";

async function req(method: string, url: string, body?: any) {
  const base = getApiBaseUrl();
  if (!base) throw new Error("Laravel API base URL not configured");
  const res = await fetch(`${base}${url}`, {
    method,
    headers: getLaravelAuthHeaders(true),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  return json?.data ?? json;
}

export const stockTransfersApi = {
  list: (params: Record<string, any> = {}) => {
    const qs = new URLSearchParams({ per_page: "100", ...params }).toString();
    return req("GET", `${path}?${qs}`);
  },
  get: (id: string) => req("GET", `${path}/${id}`),
  create: (payload: {
    transfer_date: string;
    from_warehouse_id: string;
    to_warehouse_id: string;
    item_id: string;
    quantity: number;
    notes?: string;
  }) => req("POST", path, payload),
  approve: (id: string) => req("POST", `${path}/${id}/approve`),
  cancel: (id: string, reason?: string) => req("POST", `${path}/${id}/cancel`, { reason }),
  remove: (id: string) => req("DELETE", `${path}/${id}`),
};
