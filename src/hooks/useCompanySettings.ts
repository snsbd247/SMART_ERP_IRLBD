import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getApiBaseUrl, getLaravelAuthHeaders, getLaravelToken, setLaravelToken } from "@/lib/laravel-auth";
import { useAuth } from "@/contexts/AuthContext";

export interface CompanySettings {
  id: string;
  company_name: string;
  company_logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  currency_name: string;
  currency_code: string;
  currency_symbol: string;
  currency_position: string;
  default_branch_id: string | null;
  default_financial_year_id: string | null;
  public_employee_registration_enabled?: boolean;
  bin_number?: string | null;
}

export function useCompanySettings() {
  const { profile, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    try {
      const base = getApiBaseUrl();
      const hasToken = !!getLaravelToken();
      if (base) {
        // Only call the authenticated endpoint when we actually have a session.
        if (!hasToken || !profile) { setLoading(false); return; }
        const res = await fetch(`${base}/v1/settings/company`, { headers: getLaravelAuthHeaders() });
        if (res.ok) {
          const payload = await res.json().catch(() => ({}));
          const row = (payload?.data ?? payload) as CompanySettings | null;
          setSettings(row || null);
          setLoading(false);
          return;
        }
        // Token rejected — clear it so we don't keep hitting 401s.
        if (res.status === 401) setLaravelToken(null);
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("company_settings" as any)
        .select("*")
        .maybeSingle();
      setSettings(data as any);
    } catch (e) {
      console.warn("[useCompanySettings] load failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, profile?.id]);

  return { settings, loading, refetch: fetchSettings };
}

export function formatCurrency(amount: number, settings: CompanySettings | null): string {
  if (!settings) return amount.toLocaleString();
  const formatted = amount.toLocaleString();
  return settings.currency_position === "before"
    ? `${settings.currency_symbol}${formatted}`
    : `${formatted}${settings.currency_symbol}`;
}
