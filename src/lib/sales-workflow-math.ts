/**
 * Canonical Bangladesh VAT math used across the Sales Workflow.
 * Pure functions only — safe to import in both UI and tests.
 *
 * Standard rate: 15% (configurable per line).
 * Formula:  line_subtotal = qty × rate
 *           line_vat      = line_subtotal × vat_pct / 100
 *           line_total    = line_subtotal + line_vat
 *           grand_total   = Σ line_total
 */

export type WorkflowLine = {
  qty: number | string;
  rate: number | string;
  vat_pct?: number | string;
};

export type WorkflowTotals = {
  subtotal: number;
  vat_amount: number;
  grand_total: number;
};

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export function computeLine(line: WorkflowLine) {
  const qty = n(line.qty);
  const rate = n(line.rate);
  const vatPct = n(line.vat_pct);
  const sub = round2(qty * rate);
  const vat = round2((sub * vatPct) / 100);
  return { line_subtotal: sub, line_vat: vat, line_total: round2(sub + vat) };
}

export function computeTotals(lines: WorkflowLine[]): WorkflowTotals {
  return lines.reduce<WorkflowTotals>(
    (acc, l) => {
      const c = computeLine(l);
      acc.subtotal = round2(acc.subtotal + c.line_subtotal);
      acc.vat_amount = round2(acc.vat_amount + c.line_vat);
      acc.grand_total = round2(acc.grand_total + c.line_total);
      return acc;
    },
    { subtotal: 0, vat_amount: 0, grand_total: 0 },
  );
}

/** Money receipt math: settled = received + tds_withheld. */
export function settledAmount(amountReceived: number | string, tdsAmount: number | string = 0) {
  return round2(n(amountReceived) + n(tdsAmount));
}

/** Round half-up to 2 decimal places. */
export const money2 = round2;
