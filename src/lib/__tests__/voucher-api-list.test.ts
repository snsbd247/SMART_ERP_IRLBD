/**
 * Regression tests for voucher list parameter forwarding.
 *
 * Ensures that:
 *  - Laravel mode includes `search`, `from`, `to`, `page`, `per_page` in the
 *    querystring so server-side filters + pagination actually take effect.
 *  - Supabase mode forwards the same fields in the edge function body.
 *
 * Branch scoping itself is enforced server-side (BranchScope middleware on
 * Laravel, profile-based scope in the edge function). These tests pin the
 * client contract so neither path silently drops a filter and regresses to
 * "all branches, page 1 only".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async (_name, { body }: any) => ({ data: { data: [], total: 0, ...body }, error: null })) },
    from: vi.fn(),
  },
}));

vi.mock("@/lib/laravel-auth", () => ({
  getApiBaseUrl: vi.fn(() => ""),
  getLaravelAuthHeaders: vi.fn(() => ({})),
}));

import { voucherApi } from "@/lib/voucher-api";
import { getApiBaseUrl } from "@/lib/laravel-auth";
import { supabase } from "@/integrations/supabase/client";

describe("voucherApi.list — Laravel mode", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    (getApiBaseUrl as any).mockReturnValue("https://api.example.com");
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [], total: 0 }), { status: 200, headers: { "content-type": "application/json" } })
    ) as any;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    (getApiBaseUrl as any).mockReturnValue("");
  });

  it("forwards search, from, to, page, per_page in the querystring", async () => {
    await voucherApi.list("journal", false, {
      search: "JV-2025",
      from: "2025-01-01",
      to: "2025-12-31",
      page: 3,
      per_page: 100,
    });
    const url = String((globalThis.fetch as any).mock.calls[0][0]);
    expect(url).toContain("vouchers/journal");
    expect(url).toContain("search=JV-2025");
    expect(url).toContain("from=2025-01-01");
    expect(url).toContain("to=2025-12-31");
    expect(url).toContain("page=3");
    expect(url).toContain("per_page=100");
  });

  it("includes include_deleted=1 only when requested", async () => {
    await voucherApi.list("payment", true);
    const url = String((globalThis.fetch as any).mock.calls[0][0]);
    expect(url).toContain("include_deleted=1");
  });

  it("sends voucher_date when editing an approved voucher", async () => {
    await voucherApi.editApproved({
      id: "11111111-1111-1111-1111-111111111111",
      voucher_date: "2025-07-02",
      branch_id: null,
      financial_year_id: null,
      description: "date correction",
      entries: [],
    });
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(String(init.body)).toContain('"voucher_date":"2025-07-02"');
  });

  it("sends voucher_date on create", async () => {
    await voucherApi.create({
      voucher_type: "journal",
      voucher_date: "2025-08-15",
      description: "opening",
      entries: [
        { account_id: "a1", debit: 10, credit: 0, narration: "" },
        { account_id: "a2", debit: 0, credit: 10, narration: "" },
      ],
    } as any);
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(String(init.body)).toContain('"voucher_date":"2025-08-15"');
  });

  it("sends voucher_date on plain update (non-approved)", async () => {
    await voucherApi.update({
      id: "33333333-3333-3333-3333-333333333333",
      voucher_date: "2025-09-01",
      description: "d",
      entries: [
        { account_id: "a1", debit: 1, credit: 0, narration: "" },
        { account_id: "a2", debit: 0, credit: 1, narration: "" },
      ],
    } as any);
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(String(init.body)).toContain('"voucher_date":"2025-09-01"');
  });
});

describe("voucherApi.list — Supabase mode", () => {
  beforeEach(() => {
    (getApiBaseUrl as any).mockReturnValue("");
    (supabase.functions.invoke as any).mockClear();
  });

  it("forwards filters + pagination in the edge function body", async () => {
    await voucherApi.list("receipt", false, {
      search: "rent",
      from: "2025-07-01",
      to: "2025-07-31",
      page: 2,
      per_page: 25,
    });
    const body = (supabase.functions.invoke as any).mock.calls[0][1].body;
    expect(body).toMatchObject({
      action: "list",
      voucher_type: "receipt",
      include_deleted: false,
      search: "rent",
      from: "2025-07-01",
      to: "2025-07-31",
      page: 2,
      per_page: 25,
    });
  });

  it("forwards voucher_date to the edge function for approved voucher edits", async () => {
    await voucherApi.editApproved({
      id: "22222222-2222-2222-2222-222222222222",
      voucher_date: "2025-07-02",
      branch_id: null,
      financial_year_id: null,
      description: "date correction",
      entries: [],
    });
    const body = (supabase.functions.invoke as any).mock.calls[0][1].body;
    expect(body).toMatchObject({
      action: "edit_approved",
      id: "22222222-2222-2222-2222-222222222222",
      voucher_date: "2025-07-02",
      branch_id: null,
      financial_year_id: null,
    });
  });
});
