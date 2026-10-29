import { dataClient } from "@/integrations/data/client";
import { nextNumber } from "@/lib/db-utils";
import { isLaravelMode, getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

interface AccountingEntry {
  account_id: string;
  debit: number;
  credit: number;
  narration?: string;
}

interface AutoPostParams {
  voucher_type: "journal" | "payment" | "receipt" | "contra";
  voucher_date: string;
  description: string;
  branch_id?: string | null;
  financial_year_id?: string | null;
  entries: AccountingEntry[];
  reference_type?: string;
  reference_id?: string;
  created_by?: string;
  auto_approve?: boolean;
}

/**
 * Auto-post an accounting voucher from a transaction module.
 * Creates an acc_voucher + voucher_entries in one go.
 */
export async function autoPostAccounting(params: AutoPostParams) {
  const {
    voucher_type,
    voucher_date,
    description,
    branch_id,
    financial_year_id,
    entries,
    created_by,
    auto_approve = true,
  } = params;

  // Validate balanced
  const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0);
  const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Accounting entries not balanced: Debit=${totalDebit}, Credit=${totalCredit}`);
  }

  // Laravel mode: go through the real voucher endpoint so numbering,
  // financial-year resolution, and posting all run through the same
  // server-side logic as manually-created vouchers (no separate
  // number-reservation RPC needed — Laravel assigns the number itself).
  if (isLaravelMode()) {
    const base = getApiBaseUrl();
    if (!base) throw new Error("Laravel API URL not configured");
    const res = await fetch(`${base}/v1/vouchers/${voucher_type}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...getLaravelAuthHeaders(),
      },
      body: JSON.stringify({
        voucher_type,
        voucher_date,
        description,
        branch_id: branch_id || null,
        financial_year_id: financial_year_id || null,
        entries: entries.map((e) => ({
          account_id: e.account_id,
          debit: e.debit || 0,
          credit: e.credit || 0,
          narration: e.narration || description,
        })),
        submit: true,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.message || json?.error || `Failed to auto-post voucher (HTTP ${res.status})`;
      throw new Error(msg);
    }
    const voucher = json?.data?.voucher ?? json?.voucher ?? json?.data ?? json;
    return { voucherNumber: voucher?.voucher_number, voucherId: voucher?.id };
  }

  // ─── Legacy path ─────────────────────────────────────
  // Map voucher_type to sequence id
  const seqMap: Record<string, string> = {
    journal: "journal_voucher",
    payment: "payment_voucher",
    receipt: "receipt_voucher",
    contra: "contra_voucher",
  };

  const seqId = seqMap[voucher_type];
  if (!seqId) throw new Error(`Unknown voucher type: ${voucher_type}`);

  const voucherNumber = await nextNumber(seqId);

  const { data: voucher, error: vErr } = await dataClient
    .from("acc_vouchers")
    .insert({
      voucher_number: voucherNumber,
      voucher_type,
      voucher_date,
      description,
      branch_id: branch_id || null,
      financial_year_id: financial_year_id || null,
      total_amount: totalDebit,
      status: auto_approve ? "approved" : "draft",
      created_by: created_by || null,
      approved_at: auto_approve ? new Date().toISOString() : null,
      approved_by: auto_approve ? created_by || null : null,
    })
    .select()
    .single();

  if (vErr) throw new Error("Failed to create accounting voucher: " + vErr.message);

  const entryRows = entries.map((e, idx) => ({
    voucher_id: (voucher as any).id,
    account_id: e.account_id,
    debit: e.debit || 0,
    credit: e.credit || 0,
    narration: e.narration || "",
    sort_order: idx,
  }));

  const { error: eErr } = await dataClient.from("voucher_entries").insert(entryRows);
  if (eErr) throw new Error("Failed to create voucher entries: " + eErr.message);

  return { voucherNumber, voucherId: (voucher as any).id };
}

/**
 * Find a Chart-of-Accounts row by name.
 * Resolution order (to avoid wrong-ledger mapping bugs):
 *   1. Exact (case-insensitive) name match on an active account.
 *   2. Fallback: partial ILIKE — but ONLY if it returns exactly one row;
 *      otherwise we refuse to guess and return null with a console warning.
 */
export async function findAccountByName(name: string): Promise<string | null> {
  // 1. Exact match
  const { data: exact } = await dataClient
    .from("chart_of_accounts")
    .select("id")
    .ilike("account_name", name)
    .eq("is_active", true)
    .limit(2);
  if (exact && exact.length === 1) return (exact[0] as any).id;
  if (exact && exact.length > 1) {
    console.warn(`findAccountByName: multiple active accounts named "${name}" — refusing to guess.`);
    return null;
  }

  // 2. Partial fallback (unique only)
  const { data: partial } = await dataClient
    .from("chart_of_accounts")
    .select("id, account_name")
    .ilike("account_name", `%${name}%`)
    .eq("is_active", true)
    .limit(2);
  if (partial && partial.length === 1) return (partial[0] as any).id;
  if (partial && partial.length > 1) {
    console.warn(`findAccountByName: "${name}" is ambiguous (matches: ${partial.map((p: any) => p.account_name).join(", ")}). Use the exact CoA name.`);
  }
  return null;
}


/**
 * Find an account by account code.
 */
export async function findAccountByCode(code: string): Promise<string | null> {
  const { data } = await dataClient
    .from("chart_of_accounts")
    .select("id")
    .eq("account_code", code)
    .eq("is_active", true)
    .limit(1)
    .single();
  return data?.id || null;
}
