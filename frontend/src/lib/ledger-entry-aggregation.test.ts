import { describe, expect, it } from "vitest";
import { aggregateEntriesByVoucherAccount } from "./ledger-entry-aggregation";

describe("aggregateEntriesByVoucherAccount", () => {
  it("nets duplicate rows for the same voucher and ledger account", () => {
    const rows = aggregateEntriesByVoucherAccount([
      {
        id: "row-1",
        voucher_id: "voucher-1",
        account_id: "ar-marico",
        debit: 1000,
        credit: 0,
        narration: "debit side",
        acc_vouchers: { id: "voucher-1", voucher_number: "RV-2026-00151" },
      },
      {
        id: "row-2",
        voucher_id: "voucher-1",
        account_id: "ar-marico",
        debit: 0,
        credit: 1000,
        narration: "credit side",
        acc_vouchers: { id: "voucher-1", voucher_number: "RV-2026-00151" },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      voucher_id: "voucher-1",
      account_id: "ar-marico",
      debit: 1000,
      credit: 1000,
    });
    expect(rows[0].narration).toContain("debit side");
    expect(rows[0].narration).toContain("credit side");
  });

  it("keeps the same voucher split by different ledger accounts", () => {
    const rows = aggregateEntriesByVoucherAccount([
      { voucher_id: "voucher-1", account_id: "cash", debit: 500, credit: 0 },
      { voucher_id: "voucher-1", account_id: "sales", debit: 0, credit: 500 },
    ]);

    expect(rows).toHaveLength(2);
  });
});