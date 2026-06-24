/**
 * Shared ledger running-balance helpers.
 *
 * Single source of truth for ledger-style reports (Account Ledger,
 * General Ledger, Cash Book, Bank Book).
 *
 * Rule (per business spec):
 *   Closing = Opening + Credit − Debit
 *
 * Withdrawals are recorded as Debit, deposits as Credit. Therefore a
 * withdrawal decreases the running balance and a deposit increases it,
 * matching the user's accounting convention regardless of the natural
 * side of the account.
 */

export interface LedgerEntryAmounts {
  debit: number | string | null | undefined;
  credit: number | string | null | undefined;
}

export type LedgerTxnType =
  | "withdrawal"
  | "deposit"
  | "payment"
  | "receipt"
  | "debit"
  | "credit";

const num = (v: number | string | null | undefined): number => Number(v) || 0;

/** Delta applied to the running balance for a single entry. */
export const balanceDelta = (entry: LedgerEntryAmounts): number =>
  num(entry.credit) - num(entry.debit);

/** Closing balance after applying a single entry. */
export const applyEntry = (opening: number, entry: LedgerEntryAmounts): number =>
  opening + balanceDelta(entry);

/**
 * Compute the closing balance over a sequence of entries.
 * Entries must already be in chronological order.
 */
export const computeClosingBalance = (
  opening: number,
  entries: ReadonlyArray<LedgerEntryAmounts>
): number => entries.reduce((bal, e) => applyEntry(bal, e), opening);

/**
 * Map a transaction type to debit/credit amounts.
 * Withdrawals/payments → Debit. Deposits/receipts → Credit.
 */
export const toDebitCredit = (
  type: LedgerTxnType,
  amount: number | string | null | undefined
): { debit: number; credit: number } => {
  const a = num(amount);
  switch (type) {
    case "withdrawal":
    case "payment":
    case "debit":
      return { debit: a, credit: 0 };
    case "deposit":
    case "receipt":
    case "credit":
      return { debit: 0, credit: a };
    default:
      return { debit: 0, credit: 0 };
  }
};

/**
 * Attach a `running_balance` field to each entry in order.
 * Returns the new array plus the final closing balance.
 */
export const withRunningBalance = <T extends LedgerEntryAmounts>(
  opening: number,
  entries: ReadonlyArray<T>
): { rows: Array<T & { running_balance: number }>; closing: number } => {
  let bal = opening;
  const rows = entries.map((e) => {
    bal = applyEntry(bal, e);
    return { ...e, running_balance: bal };
  });
  return { rows, closing: bal };
};

/**
 * UI validator: returns true when the displayed closing matches the
 * recomputed Opening + Credit − Debit value (within a small epsilon
 * to absorb floating-point drift).
 */
export const verifyClosingBalance = (
  opening: number,
  entries: ReadonlyArray<LedgerEntryAmounts>,
  displayedClosing: number,
  epsilon = 0.005
): boolean =>
  Math.abs(computeClosingBalance(opening, entries) - displayedClosing) < epsilon;
