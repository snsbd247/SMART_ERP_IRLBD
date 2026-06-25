import { describe, it, expect, vi, beforeEach } from "vitest";

const updateCalls: any[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (_t: string) => ({
      update: (payload: any) => {
        const chain: any = {
          eq: (col: string, val: any) => {
            updateCalls.push({ payload, col, val });
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      },
    }),
  },
}));

import { syncPartyOpeningToLedger } from "../party-ledger-utils";
import { normalizePartyOpening } from "../party-opening-validation";

beforeEach(() => { updateCalls.length = 0; });

describe("syncPartyOpeningToLedger", () => {
  it("mirrors customer opening as DEBIT on receivable account", async () => {
    await syncPartyOpeningToLedger("acc-cust-1", 1500.25, "debit");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      payload: { opening_balance: 1500.25, opening_balance_type: "debit" },
      col: "id",
      val: "acc-cust-1",
    });
  });

  it("mirrors supplier opening as CREDIT on payable account", async () => {
    await syncPartyOpeningToLedger("acc-sup-1", 999.99, "credit");
    expect(updateCalls[0]).toMatchObject({
      payload: { opening_balance: 999.99, opening_balance_type: "credit" },
      val: "acc-sup-1",
    });
  });

  it("preserves negative (contra/advance) balances without flipping side", async () => {
    await syncPartyOpeningToLedger("acc-x", -250, "debit");
    expect(updateCalls[0].payload).toEqual({ opening_balance: -250, opening_balance_type: "debit" });
  });

  it("is a no-op when accountId is missing", async () => {
    await syncPartyOpeningToLedger(null, 100, "debit");
    await syncPartyOpeningToLedger(undefined, 100, "credit");
    await syncPartyOpeningToLedger("", 100, "credit");
    expect(updateCalls).toHaveLength(0);
  });

  it("coerces NaN/Infinity amount to 0 to avoid corrupt ledger writes", async () => {
    await syncPartyOpeningToLedger("acc-y", Number.NaN, "debit");
    await syncPartyOpeningToLedger("acc-z", Number.POSITIVE_INFINITY, "credit");
    expect(updateCalls.map(c => c.payload.opening_balance)).toEqual([0, 0]);
  });

  it("integrates with validation: normalized date forwarded by caller as YYYY-MM-DD or null", async () => {
    // syncPartyOpeningToLedger does not write the date directly (CoA has no
    // date column) — the date lives on customers/suppliers. We assert that
    // the validation layer produces values matching what callers persist.
    const a = normalizePartyOpening({ opening_balance: 500, opening_balance_date: "2025-07-31T00:00:00Z" });
    const b = normalizePartyOpening({ opening_balance: 500, opening_balance_date: "" });
    expect(a.opening_balance_date).toBe("2025-07-31");
    expect(b.opening_balance_date).toBeNull();

    await syncPartyOpeningToLedger("acc-d1", a.opening_balance, "debit");
    await syncPartyOpeningToLedger("acc-d2", b.opening_balance, "credit");
    expect(updateCalls.map(c => c.payload.opening_balance)).toEqual([500, 500]);
  });
});
