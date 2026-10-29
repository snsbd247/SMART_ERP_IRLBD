/**
 * Supplier form helpers extracted for testability.
 * Pure functions only — no network calls.
 */

export interface SupplierLike {
  code?: string | null;
  name?: string | null;
}

/**
 * Generate the next sequential supplier code in the form SUP-XXXX,
 * based on the highest trailing-numeric suffix of existing supplier codes.
 * Skips any value that already exists (case-insensitive).
 */
export function nextSupplierCode(existing: SupplierLike[], prefix = "SUP-", pad = 4): string {
  let max = 0;
  const used = new Set<string>();
  for (const s of existing) {
    const code = String(s.code || "").trim();
    if (!code) continue;
    used.add(code.toLowerCase());
    const m = code.match(/(\d+)\s*$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  let n = max + 1;
  // Defensive: skip any collision (e.g. mixed prefixes already using this number).
  // 10k iteration cap prevents infinite loops on pathological data.
  for (let i = 0; i < 10000; i++) {
    const candidate = `${prefix}${String(n).padStart(pad, "0")}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
    n++;
  }
  return `${prefix}${String(max + 1).padStart(pad, "0")}`;
}

/** Returns the id of the duplicate supplier, or null if the code is unique. */
export function findDuplicateSupplierCode(
  items: Array<{ id: string; code?: string | null }>,
  code: string,
  excludeId?: string | null,
): string | null {
  const c = String(code || "").trim().toLowerCase();
  if (!c) return null;
  for (const i of items) {
    if (excludeId && i.id === excludeId) continue;
    if (String(i.code || "").trim().toLowerCase() === c) return i.id;
  }
  return null;
}

export interface SupplierFormInput {
  code?: string | null;
  name?: string | null;
  supplier_type?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  currency?: string | null;
  vat_reg_no?: string | null;
  bin_no?: string | null;
  credit_limit?: number | string | null;
  credit_days?: number | string | null;
  branch_id?: string | null;
  payable_account_id?: string | null;
  is_active?: boolean | null;
  opening_balance?: number | null;
  opening_balance_date?: string | null;
}

/**
 * Build the whitelisted payload sent to the Laravel API.
 * Critically, `is_active` is always coerced to a real boolean so that
 * undefined / null never silently flips a row to inactive.
 */
export function buildSupplierPayload(form: SupplierFormInput) {
  return {
    code: String(form.code || "").trim(),
    name: String(form.name || "").trim(),
    supplier_type: form.supplier_type || "local",
    contact_person: form.contact_person ?? null,
    phone: form.phone ?? null,
    email: form.email ?? null,
    address: form.address ?? null,
    currency: form.currency || "BDT",
    vat_reg_no: form.vat_reg_no ?? null,
    bin_no: form.bin_no ?? null,
    credit_limit: Number(form.credit_limit) || 0,
    credit_days: Number(form.credit_days) || 0,
    branch_id: form.branch_id || null,
    payable_account_id: form.payable_account_id || null,
    is_active: form.is_active === false ? false : true,
    opening_balance: Number(form.opening_balance) || 0,
    opening_balance_date: form.opening_balance_date || null,
  };
}
