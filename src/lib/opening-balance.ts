/**
 * Opening balance helpers for Chart of Accounts.
 *
 * Business rules:
 *  - Negative opening balances are permitted ONLY on overdraft-style accounts
 *    (Cash Credit / CC / Overdraft / OD bank accounts), where the bank balance
 *    is naturally negative from the company's perspective.
 *  - All other accounts must have a non-negative opening balance; use the
 *    debit/credit type field to express direction instead.
 */

const OVERDRAFT_KEYWORDS = [
  "cc",
  "cash credit",
  "overdraft",
  "od ",
  " od",
  "od-",
  "-od",
];

/**
 * Returns true when the account name (or code description) indicates a
 * CC / overdraft bank account that is allowed to hold a negative balance.
 */
export function isOverdraftAccount(accountName: string | null | undefined): boolean {
  if (!accountName) return false;
  const n = ` ${accountName.toLowerCase().trim()} `;
  return OVERDRAFT_KEYWORDS.some((kw) => n.includes(kw));
}

export type OpeningBalanceValidation =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Validate an opening balance input string against the account context.
 * Negative values are rejected unless `isOverdraftAccount(accountName)` is true.
 */
export function validateOpeningBalance(
  raw: string,
  accountName: string,
  openingBalanceType?: "debit" | "credit" | null
): OpeningBalanceValidation {
  const trimmed = (raw ?? "").toString().trim();
  if (trimmed === "") return { ok: true, value: 0 };
  const value = parseFloat(trimmed);
  if (isNaN(value) || !isFinite(value)) {
    return { ok: false, error: "Opening balance must be a valid number." };
  }
  if (
    value < 0 &&
    !isOverdraftAccount(accountName) &&
    openingBalanceType !== "credit"
  ) {
    return {
      ok: false,
      error:
        "Negative opening balance is only allowed for CC / Overdraft bank accounts, or when the Opening Balance Type is set to Credit.",
    };
  }
  return { ok: true, value };
}
