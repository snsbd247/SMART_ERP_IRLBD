/**
 * Laravel (Sanctum) auth client. Active when VITE_API_BASE_URL or VITE_API_URL is set.
 * Falls back silently when not configured so Supabase mode keeps working.
 */

const TOKEN_KEY = "laravel_auth_token";
const LEGACY_TOKEN_KEY = "auth_token";

export function getApiBaseUrl(): string | null {
  const url =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    (import.meta.env.VITE_API_URL as string | undefined) ||
    null;
  if (!url && typeof window !== "undefined" && window.location.hostname === "erp.irlbd.com") {
    return `${window.location.origin}/api`;
  }
  if (!url) return null;
  const clean = url.replace(/\/+$/, "");
  return clean.endsWith("/api") ? clean : `${clean}/api`;
}

export function isLaravelMode(): boolean {
  return !!getApiBaseUrl();
}

export function getLaravelToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!token) return null;
  // Browser Headers only accept ISO-8859-1-safe values. If an old placeholder
  // or copied Bengali text was stored as token, remove it before fetch().
  if (!/^[\x20-\x7E]+$/.test(token)) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    return null;
  }
  return token;
}

export function setLaravelToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(LEGACY_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
}

export function getLaravelAuthHeaders(includeJson = false): Record<string, string> {
  const token = getLaravelToken();
  return {
    Accept: "application/json",
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("Laravel API URL not configured");
  const headers: Record<string, string> = {
    ...getLaravelAuthHeaders(true),
    ...((init.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const contentType = res.headers.get("content-type") || "";
  const json = contentType.includes("application/json") ? await res.json().catch(() => ({})) : null;
  if (!json) {
    const text = await res.text().catch(() => "");
    const isHtml = contentType.includes("text/html") || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
    if (isHtml) {
      throw new Error("API route is serving the frontend instead of Laravel. Point the domain/DNS to the VPS or configure VITE_API_BASE_URL to the Laravel backend URL.");
    }
    throw new Error(`Unexpected API response${res.status ? ` (HTTP ${res.status})` : ""}`);
  }
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

export async function laravelUpdateProfile(data: Pick<LaravelUser, "name" | "username" | "email" | "phone">): Promise<LaravelUser> {
  const res = await request<{ success: boolean; data: { user: LaravelUser } }>("/auth/profile", {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return ((res as any).data?.user ?? (res as any).user ?? (res as any).data ?? res) as LaravelUser;
}

export async function laravelChangePassword(newPassword: string, confirmPassword: string, currentPassword?: string): Promise<void> {
  await request("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword || undefined,
      new_password: newPassword,
      new_password_confirmation: confirmPassword,
    }),
  });
}
