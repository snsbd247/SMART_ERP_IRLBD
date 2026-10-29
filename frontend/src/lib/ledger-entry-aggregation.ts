type VoucherEntryLike = {
  id?: string;
  voucher_id?: string | null;
  account_id?: string | null;
  debit?: number | string | null;
  credit?: number | string | null;
  narration?: string | null;
  sort_order?: number | null;
  acc_vouchers?: {
    id?: string | null;
    voucher_number?: string | null;
    voucher_date?: string | null;
    description?: string | null;
  } | null;
  [key: string]: unknown;
};

const toAmount = (value: number | string | null | undefined): number => Number(value) || 0;

const voucherKey = (entry: VoucherEntryLike): string =>
  String(entry.voucher_id || entry.acc_vouchers?.id || entry.id || "");

export function aggregateEntriesByVoucherAccount<T extends VoucherEntryLike>(entries: T[]): T[] {
  const grouped = new Map<string, T & { debit: number; credit: number; narration?: string | null }>();

  entries.forEach((entry) => {
    const key = `${voucherKey(entry)}::${entry.account_id || ""}`;
    const debit = toAmount(entry.debit);
    const credit = toAmount(entry.credit);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, { ...entry, debit, credit });
      return;
    }

    existing.debit += debit;
    existing.credit += credit;

    const narration = String(entry.narration || "").trim();
    if (narration && !String(existing.narration || "").includes(narration)) {
      existing.narration = [existing.narration, narration].filter(Boolean).join("; ");
    }
  });

  return Array.from(grouped.values());
}