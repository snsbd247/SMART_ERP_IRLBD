import { useCompanySettingsQuery, type CompanySettingsRow } from "@/contexts/CurrencyContext";

export type CompanySettings = CompanySettingsRow;

/**
 * Shares its query (and thus its network request) with CurrencyContext via
 * useCompanySettingsQuery() — see the comment there. Return shape kept
 * identical to the previous standalone-fetch implementation.
 */
export function useCompanySettings() {
  const { data, isLoading, refetch } = useCompanySettingsQuery();
  return {
    settings: data ?? null,
    loading: isLoading,
    refetch: async () => { await refetch(); },
  };
}

export function formatCurrency(amount: number, settings: CompanySettings | null): string {
  if (!settings) return amount.toLocaleString();
  const formatted = amount.toLocaleString();
  return settings.currency_position === "before"
    ? `${settings.currency_symbol}${formatted}`
    : `${formatted}${settings.currency_symbol}`;
}
