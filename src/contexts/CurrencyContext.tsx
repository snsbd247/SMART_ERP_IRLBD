import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataClient } from "@/integrations/data/client";
import { getApiBaseUrl, getLaravelAuthHeaders, getLaravelToken, setLaravelToken } from "@/lib/laravel-auth";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Full company_settings row — one shared shape/query for both CurrencyContext
 * (currency formatting, used app-wide) and useCompanySettings() (report
 * headers, print layouts, branding). Both used to fetch `/v1/settings/company`
 * independently, doubling that request on every page that used both. Same
 * query key here means React Query dedupes and caches it as a single fetch.
 */
export const COMPANY_SETTINGS_QUERY_KEY = ["company-settings"] as const;

export interface CompanySettingsRow {
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

async function fetchCompanySettings(): Promise<CompanySettingsRow | null> {
  const base = getApiBaseUrl();
  if (base) {
    const res = await fetch(`${base}/v1/settings/company`, { headers: getLaravelAuthHeaders() });
    if (res.ok) {
      const payload = await res.json().catch(() => ({}));
      return (payload?.data ?? payload) as CompanySettingsRow | null;
    }
    // Token rejected — clear it so we don't keep hitting 401s.
    if (res.status === 401) setLaravelToken(null);
    return null;
  }
  const { data } = await dataClient.from("company_settings" as any).select("*").maybeSingle();
  return (data as unknown) as CompanySettingsRow | null;
}

export function useCompanySettingsQuery() {
  const { profile, loading: authLoading } = useAuth();
  return useQuery({
    queryKey: COMPANY_SETTINGS_QUERY_KEY,
    queryFn: fetchCompanySettings,
    enabled: !authLoading && !!profile && !!getLaravelToken(),
    staleTime: 5 * 60 * 1000,
  });
}

interface CurrencyConfig {
  currency_name: string;
  currency_code: string;
  currency_symbol: string;
  currency_position: string;
}

interface CurrencyContextType {
  config: CurrencyConfig;
  /** Format a number as currency string using system settings */
  fc: (amount: number) => string;
  loading: boolean;
  refetch: () => Promise<void>;
}

const defaults: CurrencyConfig = {
  currency_name: "Bangladeshi Taka",
  currency_code: "BDT",
  currency_symbol: "৳",
  currency_position: "before",
};

const CurrencyContext = createContext<CurrencyContextType>({
  config: defaults,
  fc: (n) => `৳${n.toLocaleString()}`,
  loading: true,
  refetch: async () => {},
});

export const useCurrency = () => useContext(CurrencyContext);

export const CurrencyProvider = ({ children }: { children: ReactNode }) => {
  const { data, isLoading, refetch } = useCompanySettingsQuery();

  const config: CurrencyConfig = data?.currency_symbol
    ? {
        currency_name: data.currency_name || defaults.currency_name,
        currency_code: data.currency_code || defaults.currency_code,
        currency_symbol: data.currency_symbol,
        currency_position: data.currency_position || defaults.currency_position,
      }
    : defaults;

  const fc = (amount: number): string => {
    const formatted = Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return config.currency_position === "after"
      ? `${formatted} ${config.currency_symbol}`
      : `${config.currency_symbol} ${formatted}`;
  };

  return (
    <CurrencyContext.Provider value={{ config, fc, loading: isLoading, refetch: async () => { await refetch(); } }}>
      {children}
    </CurrencyContext.Provider>
  );
};
