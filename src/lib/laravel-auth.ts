/**
 * Laravel (Sanctum) auth client. Active when VITE_API_BASE_URL or VITE_API_URL is set,
 * or (as a fallback) whenever the app is served from a non-local origin — in which case
 * it defaults to the same-origin Laravel API.
 */

const TOKEN_KEY = "laravel_auth_token";
const LEGACY_TOKEN_KEY = "auth_token";

export function getApiBaseUrl(): string | null {
  const url =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    (import.meta.env.VITE_API_URL as string | undefined) ||
    null;
  if (!url && typeof window !== "undefined") {
    const host = window.location.hostname;
    // If a Laravel auth token is already stored in this browser, the user is
    // signed into the Laravel backend on the current origin — keep using it.
    let hasLaravelToken = false;
    try {
      hasLaravelToken = !!(
        localStorage.getItem("laravel_auth_token") || localStorage.getItem("auth_token") ||
        sessionStorage.getItem("laravel_auth_token") || sessionStorage.getItem("auth_token")
      );
    } catch { /* ignore */ }
    if (hasLaravelToken || (host !== "localhost" && host !== "127.0.0.1")) {
      return `${window.location.origin}/api`;
    }
  }
  if (!url) return null;
  const clean = url.replace(/\/+$/, "");
  return clean.endsWith("/api") ? clean : `${clean}/api`;
}

export function isLaravelMode(): boolean {
  if (typeof window !== "undefined" && (window as any).__FORCE_LARAVEL_FALLBACK__) return true;
  return !!getApiBaseUrl();
}

/**
 * Mark Supabase as unreachable (e.g. 503 from LARAVEL_ONLY_MODE) so subsequent
 * calls automatically prefer the Laravel API. Persisted for the session only.
 */
export function markSupabaseUnavailable(reason?: string): void {
  if (typeof window === "undefined") return;
  (window as any).__FORCE_LARAVEL_FALLBACK__ = true;
  try { sessionStorage.setItem("force_laravel_fallback", reason || "1"); } catch { /* ignore */ }
  // eslint-disable-next-line no-console
  console.warn("[laravel-auth] Supabase unavailable — falling back to Laravel API.", reason);
}

// Restore fallback flag on module load (survives HMR / page reload within session).
if (typeof window !== "undefined") {
  try {
    if (sessionStorage.getItem("force_laravel_fallback")) {
      (window as any).__FORCE_LARAVEL_FALLBACK__ = true;
    }
  } catch { /* ignore */ }
}

/** True when any Supabase error indicates the project is in Laravel-only mode. */
export function isSupabaseDisabledError(err: unknown): boolean {
  const msg = (err as any)?.message || String(err || "");
  const code = (err as any)?.status || (err as any)?.code;
  return code === 503 || /supabase is disabled|laravel[_ ]only/i.test(msg);
}

// Auth tokens are stored in localStorage so the session persists across
// browser tabs and refreshes. Legacy sessionStorage tokens are migrated.
function popLegacySessionToken(): string | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(LEGACY_TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    return token;
  } catch { return null; }
}

export function getLaravelToken(): string | null {
  if (typeof window === "undefined") return null;
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
  } catch { /* ignore */ }
  if (!token) {
    token = popLegacySessionToken();
    if (token) {
      try {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(LEGACY_TOKEN_KEY, token);
      } catch { /* ignore */ }
    }
  }
  if (!token) return null;
  if (!/^[\x20-\x7E]+$/.test(token)) {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch { /* ignore */ }
    popLegacySessionToken();
    return null;
  }
  return token;
}

export function setLaravelToken(token: string | null) {
  if (typeof window === "undefined") return;
  popLegacySessionToken();
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(LEGACY_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
  } catch { /* ignore */ }
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
