import { describe, it, expect } from "vitest";
import { isOverdraftAccount, validateOpeningBalance } from "./opening-balance";

describe("isOverdraftAccount", () => {
  it("flags CC bank accounts", () => {
    expect(isOverdraftAccount("HBL CC Account")).toBe(true);
    expect(isOverdraftAccount("Cash Credit - DBBL")).toBe(true);
    expect(isOverdraftAccount("Bank Overdraft")).toBe(true);
    expect(isOverdraftAccount("OD Account - City Bank")).toBe(true);
  });

  it("ignores normal accounts", () => {
    expect(isOverdraftAccount("Cash in Hand")).toBe(false);
    expect(isOverdraftAccount("Sales Revenue")).toBe(false);
    expect(isOverdraftAccount("")).toBe(false);
    expect(isOverdraftAccount(null)).toBe(false);
    expect(isOverdraftAccount(undefined)).toBe(false);
  });
});

describe("validateOpeningBalance", () => {
  it("accepts zero / positive on any account", () => {
    expect(validateOpeningBalance("0", "Cash")).toEqual({ ok: true, value: 0 });
    expect(validateOpeningBalance("1500.75", "Cash")).toEqual({ ok: true, value: 1500.75 });
    expect(validateOpeningBalance("", "Cash")).toEqual({ ok: true, value: 0 });
  });

  it("accepts negative only for overdraft accounts", () => {
    const r = validateOpeningBalance("-50000", "HBL CC Account");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(-50000);
  });

  it("rejects negative on non-overdraft accounts", () => {
    const r = validateOpeningBalance("-100", "Cash in Hand");
    expect(r.ok).toBe(false);
  });

  it("rejects non-numeric input", () => {
    const r = validateOpeningBalance("abc", "HBL CC Account");
    expect(r.ok).toBe(false);
  });
});
