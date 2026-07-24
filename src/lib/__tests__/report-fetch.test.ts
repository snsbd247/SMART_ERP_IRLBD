import { describe, it, expect, vi, beforeEach } from "vitest";

// Build a chainable query mock that captures filter calls and returns rows.
function makeQueryMock(rows: any[]) {
  const calls: Record<string, any[]> = { in: [], is: [], eq: [], gte: [], lte: [], order: [], range: [] };
  const q: any = {};
  const chain = (key: string) => (...args: any[]) => { calls[key]?.push(args); return q; };
  q.select = chain("select");
  q.in = chain("in");
  q.is = chain("is");
  q.eq = chain("eq");
  q.gte = chain("gte");
  q.lte = chain("lte");
  q.order = chain("order");
  q.range = (..._args: any[]) => Promise.resolve({ data: rows, error: null });
  return { q, calls };
}

const { fromMock, lastQuery } = vi.hoisted(() => {
  const state: any = { lastQuery: null };
  return {
    fromMock: vi.fn((_: string) => {
      const { q, calls } = makeQueryMock(state.rows ?? []);
      state.lastQuery = { q, calls };
      return q;
    }),
    lastQuery: state,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

import { fetchAllVoucherEntries } from "../report-fetch";

describe("fetchAllVoucherEntries", () => {
  beforeEach(() => {
    fromMock.mockClear();
    lastQuery.rows = [];
    lastQuery.lastQuery = null;
  });

  it("includes both approved and posted statuses by default", async () => {
    lastQuery.rows = [
      { id: "1", debit: 100, credit: 0, acc_vouchers: { status: "approved" } },
      { id: "2", debit: 0, credit: 50, acc_vouchers: { status: "posted" } },
    ];
    const rows = await fetchAllVoucherEntries({ dateFrom: "2026-01-01", dateTo: "2026-12-31" });
    expect(rows).toHaveLength(2);
    const inCall = lastQuery.lastQuery.calls.in.find((c: any[]) => c[0] === "acc_vouchers.status");
    expect(inCall).toBeTruthy();
    expect(inCall[1]).toEqual(expect.arrayContaining(["approved", "posted"]));
  });

  it("respects an explicit statuses filter", async () => {
    lastQuery.rows = [{ id: "1", debit: 10, credit: 0, acc_vouchers: { status: "posted" } }];
    await fetchAllVoucherEntries({ dateFrom: "2026-01-01", dateTo: "2026-12-31", statuses: ["posted"] });
    const inCall = lastQuery.lastQuery.calls.in.find((c: any[]) => c[0] === "acc_vouchers.status");
    expect(inCall[1]).toEqual(["posted"]);
  });
});
