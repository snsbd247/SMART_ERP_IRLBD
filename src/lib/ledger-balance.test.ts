import { describe, expect, it } from "vitest";
import {
  applyEntry,
  balanceDelta,
  computeClosingBalance,
  toDebitCredit,
  verifyClosingBalance,
  withRunningBalance,
} from "./ledger-balance";

describe("ledger-balance: Closing = Opening + Credit - Debit", () => {
  it("withdrawal (debit) decreases a negative opening balance further", () => {
    // From the user's spec: Opening -16407762.86 - Withdrawal 104500 = -16512262.86
    const opening = -16407762.86;
    const { debit, credit } = toDebitCredit("withdrawal", 104500);
    expect(applyEntry(opening, { debit, credit })).toBeCloseTo(-16512262.86, 2);
  });

  it("deposit (credit) reduces the magnitude of a negative opening balance", () => {
    // Opening -17959805.86 + Deposit 63250 = -17896555.86
    const opening = -17959805.86;
    const { debit, credit } = toDebitCredit("deposit", 63250);
    expect(applyEntry(opening, { debit, credit })).toBeCloseTo(-17896555.86, 2);
  });

  it("balanceDelta = credit - debit", () => {
    expect(balanceDelta({ debit: 100, credit: 0 })).toBe(-100);
    expect(balanceDelta({ debit: 0, credit: 100 })).toBe(100);
    expect(balanceDelta({ debit: "40", credit: "10" })).toBe(-30);
    expect(balanceDelta({ debit: null, credit: undefined })).toBe(0);
  });

  it("computeClosingBalance over a sequence matches the user's formula", () => {
    const opening = -16407762.86;
    const closing = computeClosingBalance(opening, [
      { debit: 104500, credit: 0 },   // withdrawal
      { debit: 0, credit: 63250 },    // deposit
      { debit: 5000, credit: 0 },     // withdrawal
    ]);
    expect(closing).toBeCloseTo(opening - 104500 + 63250 - 5000, 2);
  });

  it("withRunningBalance attaches a correct running_balance per row", () => {
    const { rows, closing } = withRunningBalance(1000, [
      { debit: 0, credit: 200 },
      { debit: 50, credit: 0 },
      { debit: 0, credit: 10 },
    ]);
    expect(rows.map((r) => r.running_balance)).toEqual([1200, 1150, 1160]);
    expect(closing).toBe(1160);
  });

  it("toDebitCredit maps transaction types to the correct side", () => {
    expect(toDebitCredit("withdrawal", 100)).toEqual({ debit: 100, credit: 0 });
    expect(toDebitCredit("payment", 100)).toEqual({ debit: 100, credit: 0 });
    expect(toDebitCredit("debit", 100)).toEqual({ debit: 100, credit: 0 });
    expect(toDebitCredit("deposit", 100)).toEqual({ debit: 0, credit: 100 });
    expect(toDebitCredit("receipt", 100)).toEqual({ debit: 0, credit: 100 });
    expect(toDebitCredit("credit", 100)).toEqual({ debit: 0, credit: 100 });
  });

  it("verifyClosingBalance flags mismatched displayed closing", () => {
    const opening = -16407762.86;
    const entries = [{ debit: 104500, credit: 0 }];
    expect(verifyClosingBalance(opening, entries, -16512262.86)).toBe(true);
    expect(verifyClosingBalance(opening, entries, -16303262.86)).toBe(false);
  });

  it("integration: same transactions produce identical closing across reports", () => {
    // Simulates Account Ledger / General Ledger / Cash Book / Bank Book all
    // running through the same helper for the same entry set.
    const opening = -1_000_000;
    const entries = [
      { debit: 250_000, credit: 0 },
      { debit: 0, credit: 100_000 },
      { debit: 75_000, credit: 0 },
      { debit: 0, credit: 500_000 },
    ];
    const accountLedger = computeClosingBalance(opening, entries);
    const generalLedger = computeClosingBalance(opening, entries);
    const cashBook = computeClosingBalance(opening, entries);
    const bankBook = computeClosingBalance(opening, entries);
    expect(accountLedger).toBe(generalLedger);
    expect(generalLedger).toBe(cashBook);
    expect(cashBook).toBe(bankBook);
    expect(accountLedger).toBe(opening - 250_000 + 100_000 - 75_000 + 500_000);
  });
});
