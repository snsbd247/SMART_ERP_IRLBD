import { describe, it, expect } from "vitest";
import { formatSignedBalance } from "./balance-format";

// Minimal currency formatter mimicking the project's `fc` helper.
const fc = (n: number) => `৳ ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe("formatSignedBalance", () => {
  it("renders a negative balance with a single leading '-' and no Dr/Cr suffix (voucher scenario)", () => {
    const out = formatSignedBalance(-12735308.96, fc);
    expect(out).toBe("-৳ 12,735,308.96");
    expect(out).not.toMatch(/\b(Dr|Cr)\b/);
  });

  it("renders a positive balance without any sign and no Dr/Cr suffix (ledger scenario)", () => {
    const out = formatSignedBalance(16512262.86, fc);
    expect(out).toBe("৳ 16,512,262.86");
    expect(out).not.toMatch(/^-/);
    expect(out).not.toMatch(/\b(Dr|Cr)\b/);
  });

  it("renders zero without a sign", () => {
    expect(formatSignedBalance(0, fc)).toBe("৳ 0.00");
  });

  it("coerces null/NaN/string inputs to 0 safely", () => {
    expect(formatSignedBalance(NaN, fc)).toBe("৳ 0.00");
    expect(formatSignedBalance(Number("not-a-number"), fc)).toBe("৳ 0.00");
  });

  it("matches Account Ledger closing-balance convention for both scenarios", () => {
    // Account Ledger shows e.g. "-12,735,308.96" for an overdrawn bank
    // and "16,512,262.86" for a positive cash balance.
    expect(formatSignedBalance(-12735308.96, fc).startsWith("-")).toBe(true);
    expect(formatSignedBalance(16512262.86, fc).startsWith("-")).toBe(false);
  });
});
