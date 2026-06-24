/**
 * Account nature validation for voucher entries.
 *
 * Ledger rule reminder: each entry row carries a `dr_cr` selector plus a
 * debit and credit amount. The amount column MUST match the selector —
 * a "dr" row may only carry a debit amount, a "cr" row only a credit.
 *
 * In addition, the standard accounting nature of an account is:
 *   asset / expense   → Debit nature  (increases on Dr)
 *   liability / equity / income → Credit nature (increases on Cr)
 *
 * Contra entries against the natural side are legal (e.g. reducing an
 * asset via credit), so a mismatch only produces a non-blocking warning.
 */

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "expense"
  | string;

export type DrCr = "dr" | "cr";

export interface VoucherEntryLike {
  account_id: string;
  dr_cr: DrCr;
  debit: number;
  credit: number;
}

export interface AccountInfo {
  id: string;
  account_code?: string | null;
  account_name?: string | null;
  account_type?: AccountType | null;
}

/** Natural (increase) side of an account type. */
export const getNaturalSide = (type: AccountType | null | undefined): DrCr => {
  const t = (type || "").toLowerCase();
  if (t === "liability" || t === "equity" || t === "income") return "cr";
  return "dr"; // asset, expense, unknown → debit-natured
};

export interface NatureValidationIssue {
  account_id: string;
  account_label: string;
  kind: "amount_mismatch" | "nature_warning" | "missing_account" | "zero_amount";
  message: string;
}

export interface NatureValidationResult {
  /** Hard errors that must block save. */
  errors: NatureValidationIssue[];
  /** Soft warnings (contra postings, unknown nature). */
  warnings: NatureValidationIssue[];
}

const label = (a: AccountInfo | undefined, id: string): string =>
  a ? `${a.account_code ?? ""} ${a.account_name ?? ""}`.trim() || id : id;

/**
 * Validate that every entry's amount sits on the column its dr/cr
 * selector indicates, and surface warnings when an entry posts against
 * the account's natural side.
 */
export const validateEntryNature = (
  entries: ReadonlyArray<VoucherEntryLike>,
  accounts: ReadonlyArray<AccountInfo>
): NatureValidationResult => {
  const map = new Map(accounts.map((a) => [a.id, a]));
  const errors: NatureValidationIssue[] = [];
  const warnings: NatureValidationIssue[] = [];

  for (const e of entries) {
    if (!e.account_id) continue;
    const acc = map.get(e.account_id);
    const lbl = label(acc, e.account_id);

    const debit = Number(e.debit) || 0;
    const credit = Number(e.credit) || 0;

    if (debit === 0 && credit === 0) {
      errors.push({
        account_id: e.account_id,
        account_label: lbl,
        kind: "zero_amount",
        message: `"${lbl}" has no debit or credit amount.`,
      });
      continue;
    }

    if (e.dr_cr === "dr" && credit > 0) {
      errors.push({
        account_id: e.account_id,
        account_label: lbl,
        kind: "amount_mismatch",
        message: `"${lbl}" is marked Dr but has a credit amount.`,
      });
    }
    if (e.dr_cr === "cr" && debit > 0) {
      errors.push({
        account_id: e.account_id,
        account_label: lbl,
        kind: "amount_mismatch",
        message: `"${lbl}" is marked Cr but has a debit amount.`,
      });
    }

    if (!acc?.account_type) {
      warnings.push({
        account_id: e.account_id,
        account_label: lbl,
        kind: "missing_account",
        message: `"${lbl}" has no account type configured; nature could not be verified.`,
      });
      continue;
    }

    const natural = getNaturalSide(acc.account_type);
    if (e.dr_cr !== natural) {
      warnings.push({
        account_id: e.account_id,
        account_label: lbl,
        kind: "nature_warning",
        message: `"${lbl}" (${acc.account_type}) is being posted against its natural ${natural.toUpperCase()} side.`,
      });
    }
  }

  return { errors, warnings };
};
