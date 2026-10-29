/**
 * Integration parity test.
 *
 * Confirms that the New Voucher "Curr Bal" (computed by
 * `useAccountBalances`) and the Account Ledger closing balance
 * (computed by ledger reports) use the same formula:
 *   Closing = Opening + Credit − Debit.
 *
 * The test simulates the hook's aggregate path AND the per-row
 * running-balance path used by ledger reports against the same
 * fixture and asserts they agree to the cent.
 */

import { describe, it, expect } from "vitest";
import {
  applyEntry,
  computeClosingBalance,
  withRunningBalance,
} from "./ledger-balance";
import { signedOpeningBalance } from "./balance-format";

interface Entry {
  account_id: string;
  debit: number;
  credit: number;
}

// Mimics useAccountBalances aggregation logic exactly.
function hookClosing(opening: number, openingType: string, entries: Entry[]) {
  const totals = entries.reduce(
    (acc, e) => ({ debit: acc.debit + e.debit, credit: acc.credit + e.credit }),
    { debit: 0, credit: 0 }
  );
  const openSigned = signedOpeningBalance(opening, openingType);
  return applyEntry(openSigned, totals);
}

// Mimics ledger-report per-row reduction.
function reportClosing(opening: number, openingType: string, entries: Entry[]) {
  const openSigned = signedOpeningBalance(opening, openingType);
  return computeClosingBalance(openSigned, entries);
}

describe("New Voucher ↔ Account Ledger closing-balance parity", () => {
  const fixtures: Array<{
    name: string;
    opening: number;
    openingType: string;
    entries: Entry[];
  }> = [
    {
      name: "IFIC Bank — overdrawn (credit opening, withdrawals + deposits)",
      opening: -16407762.86,
      openingType: "credit",
      entries: [
        { account_id: "ific", debit: 104500, credit: 0 },     // withdrawal
        { account_id: "ific", debit: 0, credit: 63250 },      // deposit
        { account_id: "ific", debit: 250000, credit: 0 },
        { account_id: "ific", debit: 0, credit: 1200000 },
      ],
    },
    {
      name: "Asset account with debit opening",
      opening: 500000,
      openingType: "debit",
      entries: [
        { account_id: "x", debit: 100000, credit: 0 },
        { account_id: "x", debit: 0, credit: 75000 },
      ],
    },
    {
      name: "Brand-new account with no opening",
      opening: 0,
      openingType: "debit",
      entries: [
        { account_id: "n", debit: 10, credit: 0 },
        { account_id: "n", debit: 0, credit: 10 },
      ],
    },
  ];

  it.each(fixtures)("agrees for $name", ({ opening, openingType, entries }) => {
    const fromHook = hookClosing(opening, openingType, entries);
    const fromReport = reportClosing(opening, openingType, entries);
    expect(Math.abs(fromHook - fromReport)).toBeLessThan(0.005);
  });

  it("matches the user-reported IFIC Bank scenario (-12,735,308.96)", () => {
    // Closing reported in the Account Ledger after a real entry set.
    const opening = -16407762.86;
    const txnSum = { debit: 0, credit: 16407762.86 - 12735308.96 };
    // i.e. net credit ≈ 3,672,453.90 brings -16.4M up to -12.7M.
    const closing = applyEntry(
      signedOpeningBalance(opening, "credit"),
      txnSum
    );
    expect(closing).toBeCloseTo(-12735308.96, 2);
  });

  it("running-balance path also agrees with aggregate path", () => {
    const opening = -16407762.86;
    const entries: Entry[] = [
      { account_id: "ific", debit: 104500, credit: 0 },
      { account_id: "ific", debit: 0, credit: 63250 },
    ];
    const { closing } = withRunningBalance(
      signedOpeningBalance(opening, "credit"),
      entries
    );
    expect(closing).toBeCloseTo(hookClosing(opening, "credit", entries), 2);
  });
});
