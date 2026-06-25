import { describe, it, expect } from "vitest";
import { normalizePartyOpening, validatePartyOpening } from "../party-opening-validation";

describe("normalizePartyOpening", () => {
  it("coerces empty date string to null", () => {
    expect(normalizePartyOpening({ opening_balance: 100, opening_balance_date: "" })).toEqual({
      opening_balance: 100,
      opening_balance_date: null,
    });
  });

  it("trims whitespace-only date to null (regression)", () => {
    expect(normalizePartyOpening({ opening_balance: 0, opening_balance_date: "   " })).toEqual({
      opening_balance: 0,
      opening_balance_date: null,
    });
  });

  it("keeps null date as null", () => {
    expect(normalizePartyOpening({ opening_balance: 0, opening_balance_date: null }).opening_balance_date).toBeNull();
  });

  it("slices ISO timestamp to YYYY-MM-DD", () => {
    expect(normalizePartyOpening({ opening_balance: 50, opening_balance_date: "2025-08-01T00:00:00Z" }).opening_balance_date).toBe("2025-08-01");
  });

  it("coerces NaN / undefined balance to 0", () => {
    expect(normalizePartyOpening({ opening_balance: "abc", opening_balance_date: null }).opening_balance).toBe(0);
    expect(normalizePartyOpening({ opening_balance: undefined, opening_balance_date: null }).opening_balance).toBe(0);
  });

  it("preserves negative balances (advance / contra)", () => {
    expect(normalizePartyOpening({ opening_balance: -250.5, opening_balance_date: "2025-07-31" }).opening_balance).toBe(-250.5);
  });
});

describe("validatePartyOpening", () => {
  it("accepts zero balance with no date", () => {
    const r = validatePartyOpening({ opening_balance: 0, opening_balance_date: "" });
    expect(r.ok).toBe(true);
    expect(r.value.opening_balance_date).toBeNull();
  });

  it("requires a date when balance is non-zero", () => {
    const r = validatePartyOpening({ opening_balance: 500, opening_balance_date: "" });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/date is required/i);
  });

  it("rejects future dates", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
    const r = validatePartyOpening({ opening_balance: 100, opening_balance_date: future });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/future/i);
  });

  it("rejects malformed date", () => {
    const r = validatePartyOpening({ opening_balance: 100, opening_balance_date: "31/07/2025" });
    expect(r.ok).toBe(false);
  });

  it("accepts valid past date with positive balance", () => {
    const r = validatePartyOpening({ opening_balance: 12345.67, opening_balance_date: "2025-07-31" });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ opening_balance: 12345.67, opening_balance_date: "2025-07-31" });
  });
});
