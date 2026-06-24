/**
 * Shared balance formatting helpers for ledger/report screens.
 *
 * Rule: negative balances always render with a leading "-" before the amount
 * (e.g. "-16,512,262.86"); positives have no sign (e.g. "16,512,262.86").
 *
 * Pass in the project's currency formatter (`fc` from useCurrency) so the
 * currency symbol/position stays consistent. Do NOT pre-apply Math.abs.
 */
export type CurrencyFormatter = (amount: number) => string;

/**
 * Format a signed balance. Negatives keep their leading "-".
 * Uses the provided `fc` so currency symbol/position is respected.
 */
export const formatBalance = (value: number, fc: CurrencyFormatter): string => {
  const n = Number(value) || 0;
  return fc(n);
};

/**
 * Tailwind class helper: red text for negative balances, empty otherwise.
 */
export const balanceToneClass = (value: number): string =>
  (Number(value) || 0) < 0 ? "text-destructive" : "";

/**
 * Compute the signed opening balance from a chart-of-accounts row.
 *
 * Storage is ambiguous historically:
 *  - Legacy rows store a positive magnitude with `opening_balance_type`
 *    indicating direction ("debit" → +, "credit" → -).
 *  - Newer rows (CC / overdraft / credit-typed) may store an already-signed
 *    negative number, in which case applying the type sign again would
 *    incorrectly flip it back to positive.
 *
 * Rule: if the stored value is already negative, treat it as signed and
 * return it as-is. Otherwise apply the type to derive the sign.
 */
export const signedOpeningBalance = (
  openingBalance: number | string | null | undefined,
  openingBalanceType: string | null | undefined
): number => {
  const n = Number(openingBalance) || 0;
  if (n < 0) return n;
  return openingBalanceType === "credit" ? -n : n;
};
