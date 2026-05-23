/**
 * Laravel (Sanctum) auth client. Active when VITE_API_BASE_URL or VITE_API_URL is set.
 * Falls back silently when not configured so Supabase mode keeps working.
 */

const TOKEN_KEY = "laravel_auth_token";

export function getApiBaseUrl(): string | null {
  const url =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    (import.meta.env.VITE_API_URL as string | undefined) ||
    null;
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

export function isLaravelMode(): boolean {
  return !!getApiBaseUrl();
}

export function getLaravelToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setLaravelToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("Laravel API URL not configured");
  const token = getLaravelToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.message || (json as any)?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export interface LaravelUser {
  id: string;
  username: string;
  name: string;
  email: string;
  phone: string | null;
  branch_id: string | null;
  employee_id: string | null;
  is_super_admin: boolean;
  roles: any[];
  permissions: string[];
}

export async function laravelLogin(username: string, password: string): Promise<LaravelUser> {
  const res = await request<{ success: boolean; data: { token: string; user: LaravelUser } }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) }
  );
  const payload = (res as any).data ?? res;
  setLaravelToken(payload.token);
  return payload.user;
}

export async function laravelMe(): Promise<LaravelUser | null> {
  try {
    const res = await request<{ success: boolean; data: any }>("/auth/me");
    const payload = (res as any).data ?? res;
    const u = payload.user ?? payload;
    return {
      ...u,
      is_super_admin: payload.is_super_admin ?? u.is_super_admin ?? false,
      permissions: payload.permissions ?? u.permissions ?? [],
    } as LaravelUser;
  } catch {
    setLaravelToken(null);
    return null;
  }
}

export async function laravelLogout(): Promise<void> {
  try { await request("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  setLaravelToken(null);
}
