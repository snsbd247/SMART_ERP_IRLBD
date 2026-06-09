import { findAccountByName } from "@/lib/accounting-utils";

export interface CoAValidationResult {
  ok: boolean;
  missing: string[];
  found: Record<string, string>;
}

/**
 * Validate that the Chart of Accounts contains all required accounts
 * for a purchase bill / payment posting. Returns a list of missing names
 * so the UI can show a clear warning before posting.
 */
export async function validatePurchaseAccounts(opts: {
  needVat?: boolean;
  needTds?: boolean;
  needBank?: boolean;
  needCash?: boolean;
}): Promise<CoAValidationResult> {
  const required: string[] = ["Purchase", "Accounts Payable"];
  if (opts.needVat) required.push("VAT Receivable");
  if (opts.needTds) required.push("TDS Payable");
  if (opts.needBank) required.push("Bank");
  if (opts.needCash) required.push("Cash");

  const found: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of required) {
    const id = await findAccountByName(name);
    if (id) found[name] = id; else missing.push(name);
  }
  return { ok: missing.length === 0, missing, found };
}
