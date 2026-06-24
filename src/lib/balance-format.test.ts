import { describe, it, expect, vi } from "vitest";
import { formatBalance, balanceToneClass, signedOpeningBalance } from "@/lib/balance-format";

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

  it("handles null/undefined/string inputs", () => {
    expect(signedOpeningBalance(null, "debit")).toBe(0);
    expect(Object.is(signedOpeningBalance(undefined, "credit"), 0) || signedOpeningBalance(undefined, "credit") === 0).toBe(true);
    expect(signedOpeningBalance("1500.5", "credit")).toBe(-1500.5);
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
