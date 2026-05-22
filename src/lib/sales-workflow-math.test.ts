import { describe, it, expect } from "vitest";
import { computeLine, computeTotals, settledAmount } from "@/lib/sales-workflow-math";

describe("sales-workflow-math", () => {
  it("computes a single line with 15% VAT", () => {
    expect(computeLine({ qty: 100, rate: 520, vat_pct: 15 })).toEqual({
      line_subtotal: 52000,
      line_vat: 7800,
      line_total: 59800,
    });
  });

  it("computes a zero-VAT line", () => {
    expect(computeLine({ qty: 10, rate: 25, vat_pct: 0 })).toEqual({
      line_subtotal: 250,
      line_vat: 0,
      line_total: 250,
    });
  });

  it("handles string inputs from form controls", () => {
    expect(computeLine({ qty: "50", rate: "95", vat_pct: "15" })).toEqual({
      line_subtotal: 4750,
      line_vat: 712.5,
      line_total: 5462.5,
    });
  });

  it("rounds VAT to 2 decimals (half-up)", () => {
    // 33.33 * 1 * 7.5% = 2.49975 → 2.50
    expect(computeLine({ qty: 1, rate: 33.33, vat_pct: 7.5 }).line_vat).toBe(2.5);
  });

  it("aggregates multi-line totals matching the demo PO", () => {
    const totals = computeTotals([
      { qty: 100, rate: 520, vat_pct: 15 }, // 52000 + 7800
      { qty: 50, rate: 95, vat_pct: 15 },   //  4750 +  712.5
    ]);
    expect(totals).toEqual({
      subtotal: 56750,
      vat_amount: 8512.5,
      grand_total: 65262.5,
    });
  });

  it("treats null/undefined/empty as zero", () => {
    expect(computeTotals([
      { qty: "", rate: 10, vat_pct: 15 },
      { qty: 5, rate: null as any, vat_pct: 15 },
    ])).toEqual({ subtotal: 0, vat_amount: 0, grand_total: 0 });
  });

  it("settles received + TDS for money receipts", () => {
    // BDT 100,000 grand total, customer withholds 5% TDS, pays 95k cash
    expect(settledAmount(95000, 5000)).toBe(100000);
    expect(settledAmount("95000", "5000")).toBe(100000);
    expect(settledAmount(100000)).toBe(100000);
  });
});
