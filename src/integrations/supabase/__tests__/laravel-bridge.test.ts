import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/laravel-auth", () => ({
  getApiBaseUrl: () => "https://erp.test/api",
  getLaravelAuthHeaders: () => ({ Accept: "application/json" }),
  getLaravelToken: () => "token",
}));

import { laravelSupabaseBridge } from "../laravel-bridge";

describe("laravelSupabaseBridge relation embeds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches parent voucher data for voucher_entries ledger queries", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/db/voucher_entries")) {
        return new Response(JSON.stringify([
          { id: "entry-1", voucher_id: "voucher-1", account_id: "account-1", debit: "104500", credit: "0" },
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/v1/db/acc_vouchers")) {
        return new Response(JSON.stringify([
          { id: "voucher-1", voucher_number: "JV-0001", voucher_date: "2025-07-02", description: "Opening entry" },
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify([]), { status: 404, headers: { "content-type": "application/json" } });
    });

    const { data, error } = await laravelSupabaseBridge
      .from("voucher_entries")
      .select("id, voucher_id, account_id, debit, credit, acc_vouchers!inner(id, voucher_number, voucher_date, description)")
      .eq("account_id", "account-1");

    expect(error).toBeNull();
    expect(data).toEqual([
      expect.objectContaining({
        id: "entry-1",
        acc_vouchers: expect.objectContaining({
          voucher_number: "JV-0001",
          voucher_date: "2025-07-02",
          description: "Opening entry",
        }),
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("supports aliased foreign-key embeds such as account:chart_of_accounts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/db/voucher_entries")) {
        return new Response(JSON.stringify([{ id: "entry-1", account_id: "account-1", debit: "10" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/v1/db/chart_of_accounts")) {
        return new Response(JSON.stringify([{ id: "account-1", account_name: "IFIC Bank", account_code: "1252" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), { status: 404, headers: { "content-type": "application/json" } });
    });

    const { data, error } = await laravelSupabaseBridge
      .from("voucher_entries")
      .select("id, account_id, debit, account:chart_of_accounts(account_name, account_code)");

    expect(error).toBeNull();
    expect(data?.[0]?.account).toEqual(expect.objectContaining({ account_name: "IFIC Bank", account_code: "1252" }));
  });
});