// Supabase client — env-driven so the same build works against
// Lovable Cloud, Supabase Cloud, OR a self-hosted Supabase instance.
// Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env (or .env.production).
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

function getRuntimeSupabaseUrl(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "erp.irlbd.com") {
      return "https://supabase.erp.irlbd.com";
    }
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
  const configured = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (typeof window !== "undefined" && window.location.hostname === "erp.irlbd.com") {
    return import.meta.env.VITE_SUPABASE_PROJECT_ID === "self-hosted" && configured
      ? configured
      : "vps-local-placeholder-key";
  }
  return configured || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6d3NydHNxaXVtaHh1a3dnaW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzcxMzksImV4cCI6MjA4OTIxMzEzOX0.NFasz7XQPa3pmyTkzRRsozGXHWoHSldARGuyde6q-iE";
}

const SUPABASE_PUBLISHABLE_KEY = getRuntimeSupabaseKey();

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
