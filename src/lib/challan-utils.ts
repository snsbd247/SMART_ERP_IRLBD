/**
 * A-Challan (achallan.gov.bd) print-slip helpers.
 * Pure functions — kept module-isolated so the Treasury page stays
 * free of accounting side-effects and so they are easy to unit test.
 */

export const CHALLAN_MIN_LEN = 3;
export const CHALLAN_MAX_LEN = 64;

// A-Challan numbers are alphanumeric; the portal also accepts '-' and '/'.
// We reject whitespace, control chars, and anything else to keep the URL safe.
const CHALLAN_PATTERN = /^[A-Za-z0-9\-/]+$/;

export type ChallanValidation =
  | { valid: true; value: string }
  | { valid: false; reason: "empty" | "too_short" | "too_long" | "bad_chars" };

export function validateChallanNo(
  v: string | null | undefined,
): ChallanValidation {
  if (v === null || v === undefined) return { valid: false, reason: "empty" };
  const t = String(v).trim();
  if (!t) return { valid: false, reason: "empty" };
  if (t.length < CHALLAN_MIN_LEN) return { valid: false, reason: "too_short" };
  if (t.length > CHALLAN_MAX_LEN) return { valid: false, reason: "too_long" };
  if (!CHALLAN_PATTERN.test(t)) return { valid: false, reason: "bad_chars" };
  return { valid: true, value: t };
}

export function isValidChallanNo(v: string | null | undefined): v is string {
  return validateChallanNo(v).valid;
}

export function challanValidationMessage(r: ChallanValidation): string {
  if (r.valid) return "";
  const reason: "empty" | "too_short" | "too_long" | "bad_chars" = (r as { valid: false; reason: "empty" | "too_short" | "too_long" | "bad_chars" }).reason;
  if (reason === "empty")
    return "Challan number is empty. Add the A-Challan number to this entry before printing.";
  if (reason === "too_short")
    return `Challan number is too short. It must be at least ${CHALLAN_MIN_LEN} characters.`;
  if (reason === "too_long")
    return `Challan number is too long. It must be at most ${CHALLAN_MAX_LEN} characters.`;
  if (reason === "bad_chars")
    return "Challan number contains invalid characters. Only letters, digits, '-' and '/' are allowed.";
  return "Invalid challan number.";
}

export function buildChallanUrl(challanNo: string): string {
  return `http://achallan.gov.bd/acs/General/PrintChallanSlipDetails?challanNo=${encodeURIComponent(
    challanNo.trim(),
  )}`;
}
