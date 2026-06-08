// Supabase client — env-driven so the same build works against
// Lovable Cloud, Supabase Cloud, OR a self-hosted Supabase instance.
// In Laravel-only mode (VPS) we export a drop-in bridge that routes all
// .from/.storage/.functions calls through the Laravel REST API instead.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { laravelSupabaseBridge } from './laravel-bridge';
import { getApiBaseUrl } from '@/lib/laravel-auth';

function isLaravelOnlyRuntime(): boolean {
  if (typeof window !== "undefined") {
    if (getApiBaseUrl()) return true;
    if ((window as any).__FORCE_LARAVEL_FALLBACK__) return true;
    try {
      if (sessionStorage.getItem("force_laravel_fallback")) return true;
    } catch { /* ignore */ }
  }
  return Boolean(
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    (import.meta.env.VITE_API_URL as string | undefined)
  );
}

const LARAVEL_ONLY_MODE = isLaravelOnlyRuntime();

function clearSupabaseBrowserSession() {
  if (!LARAVEL_ONLY_MODE || typeof window === "undefined") return;
  Object.keys(window.localStorage)
    .filter((key) => key.startsWith("sb-") || key.includes("supabase.auth.token"))
    .forEach((key) => window.localStorage.removeItem(key));
}

clearSupabaseBrowserSession();

// ─── Laravel-only VPS mode ──────────────────────────────────────────────
// Export the bridge as `supabase` so every existing `supabase.from(...)`,
// `supabase.storage.from(...)`, `supabase.functions.invoke(...)` call works
// without touching the actual Supabase service.
function makeLaravelOnlyClient() {
  // eslint-disable-next-line no-console
  console.info("[supabase] Laravel-only VPS mode — Supabase calls are routed to /api/v1/db/*");
  return laravelSupabaseBridge as unknown as ReturnType<typeof createClient<Database>>;
}

// ─── Real Supabase client (Cloud / preview / *.lovable.app) ─────────────
function makeSupabaseClient() {
  const SUPABASE_URL =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "") ||
    "https://ezwsrtsqiumhxukwgiou.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6d3NydHNxaXVtaHh1a3dnaW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzcxMzksImV4cCI6MjA4OTIxMzEzOX0.NFasz7XQPa3pmyTkzRRsozGXHWoHSldARGuyde6q-iE";

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase = LARAVEL_ONLY_MODE ? makeLaravelOnlyClient() : makeSupabaseClient();

/** Exposed for diagnostics pages — true on VPS, false on Cloud preview. */
export const IS_LARAVEL_ONLY = LARAVEL_ONLY_MODE;
