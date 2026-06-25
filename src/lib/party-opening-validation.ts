/**
 * Shared validation + normalization for party (customer / supplier) opening
 * balance & opening-balance date. Used by CustomersPage and SuppliersPage.
 *
 * Rules:
 *  - opening_balance: must be a finite number; |amount| <= 1e15 (DB numeric guard).
 *    Empty / NaN coerces to 0.
 *  - opening_balance_date: optional. If provided, must match YYYY-MM-DD and be a
 *    real calendar date not in the future. Empty string -> null.
 *  - If amount !== 0 and date is null, we require the date (so reports can
 *    attribute the brought-forward balance to a period).
 */

export interface PartyOpeningInput {
  opening_balance: unknown;
  opening_balance_date: unknown;
}

export interface PartyOpeningNormalized {
  opening_balance: number;
  /** ISO YYYY-MM-DD or null. Empty strings collapse to null. */
  opening_balance_date: string | null;
}

export interface PartyOpeningValidationResult {
  ok: boolean;
  errors: string[];
  value: PartyOpeningNormalized;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ABS = 1e15;

export function normalizePartyOpening(input: PartyOpeningInput): PartyOpeningNormalized {
  const rawAmt = input.opening_balance;
  const amt = typeof rawAmt === "number" ? rawAmt : parseFloat(String(rawAmt ?? ""));
  const opening_balance = Number.isFinite(amt) ? amt : 0;

  const rawDate = input.opening_balance_date;
  let opening_balance_date: string | null = null;
  if (typeof rawDate === "string") {
    const trimmed = rawDate.trim();
    opening_balance_date = trimmed.length > 0 ? trimmed.slice(0, 10) : null;
  } else if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
    opening_balance_date = rawDate.toISOString().slice(0, 10);
  }
  return { opening_balance, opening_balance_date };
}

export function validatePartyOpening(input: PartyOpeningInput): PartyOpeningValidationResult {
  const value = normalizePartyOpening(input);
  const errors: string[] = [];

  if (!Number.isFinite(value.opening_balance)) {
    errors.push("Opening balance must be a number");
  } else if (Math.abs(value.opening_balance) > MAX_ABS) {
    errors.push("Opening balance is out of range");
  }

  if (value.opening_balance_date !== null) {
    if (!ISO_DATE_RE.test(value.opening_balance_date)) {
      errors.push("Opening balance date must be in YYYY-MM-DD format");
    } else {
      const d = new Date(value.opening_balance_date + "T00:00:00");
      if (isNaN(d.getTime())) {
        errors.push("Opening balance date is not a valid date");
      } else {
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        if (d.getTime() > today.getTime()) {
          errors.push("Opening balance date cannot be in the future");
        }
      }
    }
  }

  if (value.opening_balance !== 0 && value.opening_balance_date === null) {
    errors.push("Opening balance date is required when opening balance is non-zero");
  }

  return { ok: errors.length === 0, errors, value };
}
