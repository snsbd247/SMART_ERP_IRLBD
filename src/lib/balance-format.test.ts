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
