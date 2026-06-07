// Supabase client — env-driven so the same build works against
// Lovable Cloud, Supabase Cloud, OR a self-hosted Supabase instance.
// Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env (or .env.production).
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

function isLaravelOnlyRuntime(): boolean {
  if (typeof window !== "undefined" && window.location.hostname === "erp.irlbd.com") {
    return true;
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

function getRuntimeSupabaseUrl(): string {
  if (LARAVEL_ONLY_MODE) {
    return typeof window !== "undefined"
      ? `${window.location.origin}/supabase-disabled`
      : "http://localhost/supabase-disabled";
  }

  const configured = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, "");

  if (typeof window !== "undefined") {
    const parts = window.location.hostname.split(".");
    if (parts.length >= 2) {
      const rootDomain = parts.slice(-2).join(".");
      return `https://supabase.${rootDomain}`;
    }
  }

  return "https://ezwsrtsqiumhxukwgiou.supabase.co";
}

const SUPABASE_URL = getRuntimeSupabaseUrl();

function getRuntimeSupabaseKey(): string {
  if (LARAVEL_ONLY_MODE) {
    return "vps-laravel-mode-no-supabase";
  }

  const configured = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  return configured || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6d3NydHNxaXVtaHh1a3dnaW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzcxMzksImV4cCI6MjA4OTIxMzEzOX0.NFasz7XQPa3pmyTkzRRsozGXHWoHSldARGuyde6q-iE";
}

const SUPABASE_PUBLISHABLE_KEY = getRuntimeSupabaseKey();

clearSupabaseBrowserSession();

const disabledSupabaseFetch: typeof fetch = async () => new Response(
  JSON.stringify({ message: "Supabase is disabled in Laravel VPS mode." }),
  { status: 503, headers: { "Content-Type": "application/json" } }
);

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: LARAVEL_ONLY_MODE || typeof window === "undefined" ? undefined : window.localStorage,
    persistSession: !LARAVEL_ONLY_MODE,
    autoRefreshToken: !LARAVEL_ONLY_MODE,
    detectSessionInUrl: !LARAVEL_ONLY_MODE,
  },
  ...(LARAVEL_ONLY_MODE ? {
    global: { fetch: disabledSupabaseFetch },
  } : {}),
});
