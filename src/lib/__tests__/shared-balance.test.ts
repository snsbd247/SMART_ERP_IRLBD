import { describe, it, expect } from "vitest";
import {
  BALANCE_VOUCHER_STATUSES,
  computeAccountBalance,
  computeBalancesByAccount,
} from "@/lib/shared-balance";

describe("shared-balance", () => {
  it("exposes exactly the approved+posted statuses (guards against divergence)", () => {
    // If this ever fails, Voucher entry and Account Ledger will show different
    // balances. Update BOTH consumers, not just the constant.
    expect([...BALANCE_VOUCHER_STATUSES].sort()).toEqual(["approved", "posted"]);
  });

  it("computes closing = opening + credit - debit for a debit-nature account", () => {
    const r = computeAccountBalance(
      [
        { account_id: "a", debit: 500, credit: 0 },
        { account_id: "a", debit: 0, credit: 200 },
      ],
      1000,
      "debit",
    );
    // opening (+1000, debit → +1000) + 200 - 500 = 700
    expect(r.signed_balance).toBe(700);
    expect(r.closing_balance).toBe(700);
    expect(r.closing_balance_type).toBe("debit");
    expect(r.total_debit).toBe(500);
    expect(r.total_credit).toBe(200);
  });

  it("flips sign when credits exceed debits + opening", () => {
    const r = computeAccountBalance(
      [{ account_id: "a", debit: 100, credit: 900 }],
      0,
      "debit",
    );
    expect(r.signed_balance).toBe(800);
    // Credit-nature opening
    const r2 = computeAccountBalance([{ account_id: "a", debit: 500, credit: 0 }], 100, "credit");
    // opening credit → -100, then -500 = -600
    expect(r2.signed_balance).toBe(-600);
    expect(r2.closing_balance_type).toBe("credit");
  });

  it("groups by account and merges opening-only accounts", () => {
    const opening = new Map([
      ["a", { opening: 100, opening_type: "debit" }],
      ["b", { opening: 0, opening_type: "debit" }],
    ]);
    const entries = [
      { account_id: "a", debit: 50, credit: 0 },
      { account_id: "b", debit: 0, credit: 200 },
    ];
    const out = computeBalancesByAccount(entries, opening);
    expect(out.get("a")?.signed_balance).toBe(50);
    expect(out.get("b")?.signed_balance).toBe(200);
  });
});
