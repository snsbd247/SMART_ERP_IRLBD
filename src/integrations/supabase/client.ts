// Data client — the real Supabase service has been removed from this app.
// `supabase` is now always the Laravel bridge below, which implements the
// subset of the supabase-js v2 API this codebase uses (.from/.storage/.auth/
// .functions/.rpc/.channel) and routes every call through the Laravel REST
// API instead. Kept under this name/shape so the ~160 existing call sites
// (`supabase.from(...)`, `supabase.storage.from(...)`, etc.) work unchanged.
//
// `SupabaseClient`/`Database` are imported as types only (erased at compile
// time, zero runtime/bundle cost) purely to preserve the rich generated
// table types for those call sites.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { laravelSupabaseBridge } from './laravel-bridge';

function clearLegacySupabaseBrowserSession() {
  if (typeof window === "undefined") return;
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("sb-") || key.includes("supabase.auth.token"))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch { /* ignore */ }
}

clearLegacySupabaseBrowserSession();

// eslint-disable-next-line no-console
console.info("[data-client] Routing to Laravel API at /api/v1/db/*");

export const supabase = laravelSupabaseBridge as unknown as SupabaseClient<Database>;

/** Kept for existing call sites; always true now that Supabase has been removed. */
export const IS_LARAVEL_ONLY = true;
