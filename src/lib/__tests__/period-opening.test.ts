import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client used by computeCustomerPeriodOpening / fetchAllVoucherEntries
const mockData: Record<string, any[]> = {
  sales_invoices: [],
  party_payments: [],
  sales_returns: [],
  voucher_entries: [],
  chart_of_accounts: [],
};

function getPath(row: any, col: string): any {
  if (!col.includes(".")) return row[col];
  return col.split(".").reduce((o, k) => (o == null ? undefined : o[k]), row);
}

function makeBuilder(table: string) {
  const rows = mockData[table] || [];
  const filters: Array<(r: any) => boolean> = [];
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: any) => { filters.push(r => getPath(r, col) === val); return builder; },
    in: (col: string, vals: any[]) => { filters.push(r => vals.includes(getPath(r, col))); return builder; },
    is: (col: string, val: any) => { filters.push(r => (val === null ? getPath(r, col) == null : getPath(r, col) === val)); return builder; },
    gte: (col: string, val: any) => { filters.push(r => getPath(r, col) >= val); return builder; },
    lte: (col: string, val: any) => { filters.push(r => getPath(r, col) <= val); return builder; },
    order: () => builder,
    range: () => builder,
    maybeSingle: async () => {
      const r = rows.filter(row => filters.every(f => f(row)));
      return { data: r[0] ?? null, error: null };
    },
    then: (resolve: any) => {
      const r = rows.filter(row => filters.every(f => f(row)));
      resolve({ data: r, error: null });
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
  },
}));

vi.mock("@/lib/laravel-auth", () => ({
  isLaravelMode: () => false,
  getApiBaseUrl: () => "",
  getLaravelAuthHeaders: () => ({}),
}));

import { computeCustomerPeriodOpening, computeAccountPeriodOpening, fetchAccountPriorEntries } from "@/lib/period-opening";

beforeEach(() => {
  for (const k of Object.keys(mockData)) mockData[k] = [];
});

describe("computeCustomerPeriodOpening — Customer Statement carry-forward", () => {
  it("returns 0 when there are no prior transactions", async () => {
    const r = await computeCustomerPeriodOpening({ customerId: "cust-1", dateFrom: "2025-08-01" });
    expect(r.opening).toBe(0);
    expect(r.priorRows).toEqual([]);
  });

  it("sums invoices (Dr) minus payments and returns (Cr) strictly before dateFrom", async () => {
    mockData.sales_invoices = [
      { id: "i1", invoice_number: "INV-1", invoice_date: "2025-07-05", net_amount: 1000, total_amount: 1000 },
      { id: "i2", invoice_number: "INV-2", invoice_date: "2025-07-20", net_amount: 500, total_amount: 500 },
      // Should be excluded — falls on dateFrom
      { id: "i3", invoice_number: "INV-3", invoice_date: "2025-08-01", net_amount: 9999, total_amount: 9999, customer_id: "cust-1" },
    ].map(r => ({ ...r, customer_id: "cust-1" }));
    mockData.party_payments = [
      { id: "p1", payment_date: "2025-07-10", amount: 200, party_id: "cust-1", party_type: "customer" },
    ];
    mockData.sales_returns = [
      { id: "r1", return_number: "SR-1", return_date: "2025-07-15", total_amount: 100, customer_id: "cust-1" },
    ];

    const r = await computeCustomerPeriodOpening({ customerId: "cust-1", dateFrom: "2025-08-01" });
    // 1000 - 200 - 100 + 500 = 1200
    expect(r.opening).toBe(1200);
    expect(r.priorRows.map(x => x.id)).toEqual(["i1", "p1", "r1", "i2"]);
  });

  it("preserves negative carry-forward (credit balance) without sign flip", async () => {
    // Payments exceed invoices -> negative (advance) balance
    mockData.party_payments = [
      { id: "p1", payment_date: "2025-07-10", amount: 5000, party_id: "cust-1", party_type: "customer" },
    ];
    mockData.sales_invoices = [
      { id: "i1", invoice_number: "INV-1", invoice_date: "2025-07-05", net_amount: 1000, total_amount: 1000, customer_id: "cust-1" },
    ];
    const r = await computeCustomerPeriodOpening({ customerId: "cust-1", dateFrom: "2025-08-01" });
    expect(r.opening).toBe(-4000);
  });
});

describe("computeAccountPeriodOpening — IFIC Bank July→August regression", () => {
  it("returns July closing as August opening for IFIC Bank (negative carry)", async () => {
    // Base opening 0; July vouchers net to -16,512,262.86 (negative, overdraft-style)
    mockData.chart_of_accounts = [
      { id: "ific", opening_balance: 0, opening_balance_type: "debit" },
    ];
    mockData.voucher_entries = [
      { id: "v1", account_id: "ific", debit: 16512262.86, credit: 0, voucher_id: "vch1" },
    ];
    // Stitch parent vouchers via embedded join — bridge expects `acc_vouchers` on the row.
    // Our mock returns rows directly; computeAccountPeriodOpening reads `e.acc_vouchers?` safely.
    // Inject the embed manually:
    mockData.voucher_entries = mockData.voucher_entries.map(e => ({
      ...e,
      acc_vouchers: { id: "vch1", voucher_number: "PV-001", voucher_date: "2025-07-15", status: "approved", branch_id: null, description: "Cheque payment" },
    }));

    const r = await computeAccountPeriodOpening({
      accountId: "ific",
      dateFrom: "2025-08-01",
      statuses: ["approved", "posted"],
    });
    expect(r.baseOpening).toBe(0);
    expect(r.opening).toBeCloseTo(-16512262.86, 2);
    // The row-level breakdown is now fetched lazily (only when the Opening
    // Balance drilldown is actually opened) via fetchAccountPriorEntries,
    // not eagerly by computeAccountPeriodOpening.
    expect(r.priorEntries).toEqual([]);

    const rows = await fetchAccountPriorEntries({
      accountId: "ific",
      dateFrom: "2025-08-01",
      statuses: ["approved", "posted"],
      baseOpening: r.baseOpening,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].running_balance).toBeCloseTo(-16512262.86, 2);
  });
});
