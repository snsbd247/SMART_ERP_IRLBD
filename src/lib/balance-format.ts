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

/** Canonical opening-balance direction. */
export type OpeningBalanceType = "debit" | "credit";

/**
 * Minimal shape of a chart-of-accounts row needed to compute a signed
 * opening balance. Wider rows (with id/name/code) are accepted via
 * structural typing.
 */
export interface OpeningBalanceSource {
  id?: string | null;
  account_id?: string | null;
  account_code?: string | null;
  account_name?: string | null;
  opening_balance: number | string | null | undefined;
  opening_balance_type: OpeningBalanceType | string | null | undefined;
}

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

const isDev = (): boolean => {
  try {
    return (
      typeof process !== "undefined" &&
      (process as any).env?.NODE_ENV !== "production"
    );
  } catch {
    return false;
  }
};

const failFastEnabled = (): boolean => {
  try {
    return (
      typeof process !== "undefined" &&
      (process as any).env?.VITE_BALANCE_FAIL_FAST === "true"
    );
  } catch {
    return false;
  }
};

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
 *
 * Pass `context` (account id/code/name and optional voucher id) to enrich
 * the dev-mode warning when a stored negative value is paired with
 * `type='credit'`. Set `VITE_BALANCE_FAIL_FAST=true` to throw instead of
 * warn — useful in test environments to catch new bad data.
 */
export interface SignedOpeningContext {
  accountId?: string | null;
  accountCode?: string | null;
  accountName?: string | null;
  voucherId?: string | null;
  voucherType?: string | null;
}

export const signedOpeningBalance = (
  openingBalance: number | string | null | undefined,
  openingBalanceType: OpeningBalanceType | string | null | undefined,
  context: SignedOpeningContext = {}
): number => {
  const n = Number(openingBalance) || 0;
  if (n < 0) {
    if (openingBalanceType === "credit") {
      const payload = {
        openingBalance: n,
        openingBalanceType,
        ...context,
      };
      const msg =
        "[signedOpeningBalance] stored opening_balance is negative AND type='credit'; " +
        "treating stored value as signed to avoid double-negation";
      if (failFastEnabled()) {
        throw new Error(`${msg} ${JSON.stringify(payload)}`);
      }
      if (isDev() && typeof console !== "undefined") {
        console.warn(msg, payload);
      }
    }
    return n;
  }
  return openingBalanceType === "credit" ? -n : n;
};

/**
 * Convenience overload that takes a chart-of-accounts row directly and
 * forwards its identifiers into the warning context. Use this from
 * report code so a misconfigured account is immediately identifiable
 * in the console.
 */
export const signedOpeningBalanceFromRow = (
  row: OpeningBalanceSource,
  extra: Pick<SignedOpeningContext, "voucherId" | "voucherType"> = {}
): number =>
  signedOpeningBalance(row.opening_balance, row.opening_balance_type, {
    accountId: row.id ?? row.account_id ?? null,
    accountCode: row.account_code ?? null,
    accountName: row.account_name ?? null,
    ...extra,
  });

/**
 * Normalize a row into a single source of truth: returns the row with its
 * computed signed opening balance attached. Downstream code should use
 * `signed_opening_balance` instead of recomputing from raw fields, which
 * eliminates the double-negation risk entirely.
 */
export type NormalizedOpeningBalance<T extends OpeningBalanceSource> = T & {
  signed_opening_balance: number;
};

export const normalizeOpeningBalance = <T extends OpeningBalanceSource>(
  row: T
): NormalizedOpeningBalance<T> => ({
  ...row,
  signed_opening_balance: signedOpeningBalanceFromRow(row),
});
