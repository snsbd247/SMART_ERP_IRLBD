import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatBalance,
  balanceToneClass,
  signedOpeningBalance,
  signedOpeningBalanceFromRow,
  normalizeOpeningBalance,
} from "@/lib/balance-format";

const fc = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe("formatBalance", () => {
  it("renders negative balances with a leading minus", () => {
    expect(formatBalance(-16512262.86, fc)).toBe("-16,512,262.86");
  });

  it("renders positive balances without a leading minus", () => {
    expect(formatBalance(16512262.86, fc)).toBe("16,512,262.86");
  });

  it("renders zero without a sign", () => {
    expect(formatBalance(0, fc)).toBe("0.00");
  });

  it("coerces non-finite/invalid input to zero", () => {
    expect(formatBalance(NaN as unknown as number, fc)).toBe("0.00");
  });
});

describe("balanceToneClass", () => {
  it("returns destructive class for negatives", () => {
    expect(balanceToneClass(-1)).toBe("text-destructive");
  });
  it("returns empty for zero and positives", () => {
    expect(balanceToneClass(0)).toBe("");
    expect(balanceToneClass(10)).toBe("");
  });
});

describe("signedOpeningBalance", () => {
  it("legacy positive magnitude + debit → positive", () => {
    expect(signedOpeningBalance(16407762.86, "debit")).toBe(16407762.86);
  });

  it("legacy positive magnitude + credit → negated", () => {
    expect(signedOpeningBalance(16407762.86, "credit")).toBe(-16407762.86);
  });

  it("stored negative value + credit → kept negative (no double-negation)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(signedOpeningBalance(-16407762.86, "credit")).toBe(-16407762.86);
    warn.mockRestore();
  });

  it("stored negative value + debit (CC/overdraft) → kept negative", () => {
    expect(signedOpeningBalance(-50000, "debit")).toBe(-50000);
  });

  it("logs a dev warning when stored value is negative and type=credit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    signedOpeningBalance(-1, "credit");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("includes account identifiers in the warning payload", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    signedOpeningBalance(-1, "credit", {
      accountId: "acc-1",
      accountCode: "1010",
      accountName: "HBL CC",
      voucherId: "v-9",
      voucherType: "payment",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[signedOpeningBalance]"),
      expect.objectContaining({
        accountId: "acc-1",
        accountCode: "1010",
        accountName: "HBL CC",
        voucherId: "v-9",
        voucherType: "payment",
        openingBalance: -1,
        openingBalanceType: "credit",
      })
    );
    warn.mockRestore();
  });

  it("throws when VITE_BALANCE_FAIL_FAST=true", () => {
    const prev = (process as any).env.VITE_BALANCE_FAIL_FAST;
    (process as any).env.VITE_BALANCE_FAIL_FAST = "true";
    try {
      expect(() => signedOpeningBalance(-1, "credit", { accountCode: "1010" }))
        .toThrow(/signedOpeningBalance/);
    } finally {
      if (prev === undefined) delete (process as any).env.VITE_BALANCE_FAIL_FAST;
      else (process as any).env.VITE_BALANCE_FAIL_FAST = prev;
    }
  });

  it("handles null/undefined/string inputs", () => {
    expect(signedOpeningBalance(null, "debit")).toBe(0);
    expect(signedOpeningBalance(undefined, "credit") === 0).toBe(true);
    expect(signedOpeningBalance("1500.5", "credit")).toBe(-1500.5);
  });
});

describe("signedOpeningBalanceFromRow / normalizeOpeningBalance", () => {
  afterEach(() => vi.restoreAllMocks());

  it("derives the signed balance from a CoA-shaped row", () => {
    expect(
      signedOpeningBalanceFromRow({
        id: "a1",
        account_code: "1010",
        account_name: "Cash",
        opening_balance: 100,
        opening_balance_type: "credit",
      })
    ).toBe(-100);
  });

  it("normalize attaches signed_opening_balance and never double-negates", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = normalizeOpeningBalance({
      id: "a1",
      account_code: "1010",
      account_name: "HBL CC",
      opening_balance: -16407762.86,
      opening_balance_type: "credit",
    });
    expect(row.signed_opening_balance).toBe(-16407762.86);
  });
});

describe("running balance integration (ledger calc)", () => {
  // Mirrors the per-row computation used in AccountLedgerReport /
  // GeneralLedgerReport / Cash & Bank Book: runBal starts from the signed
  // opening, then each row applies (debit - credit).
  const computeRunning = (
    opening: number,
    type: "debit" | "credit",
    entries: Array<{ debit: number; credit: number }>
  ) => {
    let bal = signedOpeningBalance(opening, type);
    const series = entries.map((e) => (bal += e.debit - e.credit));
    return { closing: bal, series };
  };

  it("keeps the sign negative after additional credits on a credit-typed opening", () => {
    const { closing, series } = computeRunning(16407762.86, "credit", [
      { debit: 0, credit: 100000 },
      { debit: 0, credit: 50000 },
    ]);
    expect(series[0]).toBeCloseTo(-16507762.86, 2);
    expect(closing).toBeCloseTo(-16557762.86, 2);
    expect(closing).toBeLessThan(0);
  });

  it("does not double-negate when storage is already signed negative", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { closing } = computeRunning(-16407762.86, "credit", [
      { debit: 0, credit: 1000 },
    ]);
    expect(closing).toBeCloseTo(-16408762.86, 2);
    warn.mockRestore();
  });

  it("debit entries can flip a negative opening back toward zero", () => {
    const { closing } = computeRunning(1_000_000, "credit", [
      { debit: 1_500_000, credit: 0 },
    ]);
    expect(closing).toBeCloseTo(500_000, 2);
  });
});
