/**
 * Single source of truth for computing account balances shared by:
 *   - Accounting Voucher entry ("Curr Bal" column) → `useAccountBalances`
 *   - Account Ledger report                       → `AccountLedgerReport`
 *
 * Any divergence between the two views was historically caused by different
 * status filters (e.g. voucher entry counted only "approved" while the ledger
 * counted "approved" + "posted"). Both callers MUST import the constants and
 * helpers below rather than hard-coding their own copies.
 */

import { signedOpeningBalance } from "@/lib/balance-format";

/** Voucher statuses that contribute to a live account balance.
 *  Do NOT hard-code this array elsewhere — import from here. */
export const BALANCE_VOUCHER_STATUSES = ["approved", "posted"] as const;
export type BalanceVoucherStatus = (typeof BALANCE_VOUCHER_STATUSES)[number];

export interface BalanceEntry {
  account_id: string;
  debit: number | string | null;
  credit: number | string | null;
}

export interface AccountBalanceResult {
  total_debit: number;
  total_credit: number;
  /** Signed: positive = Dr (net asset/expense), negative = Cr (net liability). */
  signed_balance: number;
  closing_balance: number;
  closing_balance_type: "debit" | "credit";
}

/**
 * Aggregate raw voucher-entry rows for a single account and combine with the
 * opening balance using the canonical formula:
 *
 *     closing = opening + Σcredit − Σdebit    (for credit-nature accounts)
 *     closing = opening + Σdebit  − Σcredit   (for debit-nature accounts)
 *
 * We keep it symmetrical by using `signedOpeningBalance()` for the opening and
 * always computing `openSigned + credit - debit` — matching the existing
 * behavior of both `useAccountBalances` and `AccountLedgerReport`.
 */
export function computeAccountBalance(
  entries: readonly BalanceEntry[],
  opening: number,
  openingType: string,
): AccountBalanceResult {
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    debit += Number(e.debit) || 0;
    credit += Number(e.credit) || 0;
  }
  const openSigned = signedOpeningBalance(Number(opening) || 0, openingType);
  const closing = openSigned + credit - debit;
  return {
    total_debit: debit,
    total_credit: credit,
    signed_balance: closing,
    closing_balance: Math.abs(closing),
    closing_balance_type: closing >= 0 ? "debit" : "credit",
  };
}

/** Group entries by account_id then apply {@link computeAccountBalance}. */
export function computeBalancesByAccount(
  entries: readonly BalanceEntry[],
  openingByAccount: Map<string, { opening: number; opening_type: string }>,
): Map<string, AccountBalanceResult> {
  const grouped = new Map<string, BalanceEntry[]>();
  for (const e of entries) {
    const arr = grouped.get(e.account_id) || [];
    arr.push(e);
    grouped.set(e.account_id, arr);
  }
  const out = new Map<string, AccountBalanceResult>();
  // Include accounts that only have an opening balance (no txns).
  for (const [id, meta] of openingByAccount) {
    out.set(id, computeAccountBalance(grouped.get(id) || [], meta.opening, meta.opening_type));
  }
  for (const [id, list] of grouped) {
    if (!out.has(id)) out.set(id, computeAccountBalance(list, 0, "debit"));
  }
  return out;
}
