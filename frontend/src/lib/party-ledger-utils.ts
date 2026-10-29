import { dataClient } from "@/integrations/data/client";

const SUPPLIER_PARENT_NAMES = ["Supplier Payable", "Accounts Payable", "Sundry Creditors"];
const CUSTOMER_PARENT_NAMES = ["Accounts Receivable", "Customer Receivable", "Sundry Debtors"];

async function findOrCreateParent(
  candidateNames: string[],
  accountType: "asset" | "liability",
  fallbackCode: string,
): Promise<{ id: string; account_code: string } | null> {
  // Try each candidate name (case-insensitive)
  for (const n of candidateNames) {
    const { data } = await dataClient
      .from("chart_of_accounts")
      .select("id, account_code")
      .ilike("account_name", n)
      .eq("account_type", accountType)
      .limit(1);
    if (data && data.length > 0) return data[0] as any;
  }

  // Not found — create the first candidate as parent
  const { data: created, error } = await dataClient
    .from("chart_of_accounts")
    .insert({
      account_code: fallbackCode,
      account_name: candidateNames[0],
      account_type: accountType,
      opening_balance: 0,
      opening_balance_type: accountType === "asset" ? "debit" : "credit",
      is_active: true,
    })
    .select("id, account_code")
    .single();
  if (error) {
    console.error("[party-ledger] failed to create parent", error);
    return null;
  }
  return created as any;
}

async function nextChildCode(parentCode: string): Promise<string> {
  const { data } = await dataClient
    .from("chart_of_accounts")
    .select("account_code")
    .ilike("account_code", `${parentCode}%`)
    .order("account_code", { ascending: false })
    .limit(50);

  let max = 0;
  (data || []).forEach((r: any) => {
    const tail = String(r.account_code).slice(parentCode.length);
    const n = parseInt(tail, 10);
    if (!isNaN(n) && n > max) max = n;
  });
  const next = String(max + 1).padStart(3, "0");
  return `${parentCode}${next}`;
}

async function createPartyLedger(
  partyName: string,
  candidateNames: string[],
  accountType: "asset" | "liability",
  fallbackParentCode: string,
  parentId?: string,
): Promise<string | null> {
  try {
    // Avoid duplicates by exact name — return existing id if present
    const { data: existing } = await dataClient
      .from("chart_of_accounts")
      .select("id")
      .eq("account_name", partyName)
      .eq("account_type", accountType)
      .limit(1);
    if (existing && existing.length > 0) return (existing[0] as any).id;

    let parent: { id: string; account_code: string } | null = null;
    if (parentId) {
      const { data } = await dataClient
        .from("chart_of_accounts")
        .select("id, account_code")
        .eq("id", parentId)
        .limit(1);
      if (data && data.length > 0) parent = data[0] as any;
    }
    if (!parent) {
      parent = await findOrCreateParent(candidateNames, accountType, fallbackParentCode);
    }
    if (!parent) return null;

    const code = await nextChildCode(parent.account_code);

    const { data: inserted, error } = await dataClient.from("chart_of_accounts").insert({
      account_code: code,
      account_name: partyName,
      account_type: accountType,
      parent_id: parent.id,
      opening_balance: 0,
      opening_balance_type: accountType === "asset" ? "debit" : "credit",
      is_active: true,
    }).select("id").single();
    if (error) {
      console.error("[party-ledger] failed to create ledger", error);
      return null;
    }
    return (inserted as any).id;
  } catch (e) {
    console.error("[party-ledger] unexpected error", e);
    return null;
  }
}

// Parent codes match the Bangladesh standard CoA:
//   1240 = Accounts Receivable (customers)
//   2210 = Accounts & Other Payable (suppliers/vendors)
export const createSupplierLedger = (name: string, parentId?: string) =>
  createPartyLedger(name, SUPPLIER_PARENT_NAMES, "liability", "2210", parentId);

export const createCustomerLedger = (name: string, parentId?: string) =>
  createPartyLedger(name, CUSTOMER_PARENT_NAMES, "asset", "1240", parentId);

/**
 * Mirror a party's opening balance onto its linked chart_of_accounts ledger so
 * that all ledger / period-opening calculations pick it up automatically.
 *
 * @param accountId - linked chart_of_accounts.id (receivable_account_id for
 *                    customers, payable_account_id for suppliers)
 * @param amount    - signed opening balance entered by the user. Positive =
 *                    normal side of the ledger (Dr for customers, Cr for
 *                    suppliers). Negative = contra (advance / overpayment).
 * @param side      - "debit" for customer (asset) ledgers, "credit" for
 *                    supplier (liability) ledgers.
 */
export async function syncPartyOpeningToLedger(
  accountId: string | null | undefined,
  amount: number,
  side: "debit" | "credit",
): Promise<void> {
  if (!accountId) return;
  const safe = Number.isFinite(amount) ? amount : 0;
  const { error } = await dataClient
    .from("chart_of_accounts")
    .update({ opening_balance: safe, opening_balance_type: side } as any)
    .eq("id", accountId);
  if (error) console.error("[party-ledger] failed to sync opening", error);
}



