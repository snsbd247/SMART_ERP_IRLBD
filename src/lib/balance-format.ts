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
