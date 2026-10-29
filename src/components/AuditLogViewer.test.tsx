import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuditLogViewer } from "./AuditLogViewer";

// Capture the args passed to `.in("module", ...)` so we can assert that the
// component queries every module key the app writes to (accounting,
// accounting_vouchers, vouchers) — this is what prevents the historical
// "voucher_date_changed events missing from history" regression.
const inSpy = vi.fn();

vi.mock("@/integrations/data/client", () => {
  const rows = [
    {
      id: "a1",
      user_name: "Alice",
      module: "accounting_vouchers",
      action: "voucher_date_changed",
      record_id: "v-1",
      details: "old=01-07-2025 new=02-07-2025",
      ip_address: null,
      created_at: "2025-07-02T10:00:00Z",
    },
    {
      id: "a2",
      user_name: "Bob",
      module: "accounting",
      action: "voucher_date_changed",
      record_id: "v-2",
      details: "old=05-07-2025 new=07-07-2025",
      ip_address: null,
      created_at: "2025-07-07T10:00:00Z",
    },
  ];

  const builder: any = {
    select: vi.fn(() => builder),
    in: vi.fn((...args: any[]) => {
      inSpy(...args);
      return builder;
    }),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };

  return { dataClient: { from: vi.fn(() => builder) } };
});

describe("AuditLogViewer", () => {
  beforeEach(() => inSpy.mockClear());

  it("accepts a single module string and queries it via .in()", async () => {
    render(<AuditLogViewer open onOpenChange={() => {}} module="accounting" />);
    await waitFor(() => expect(inSpy).toHaveBeenCalled());
    expect(inSpy).toHaveBeenCalledWith("module", ["accounting"]);
  });

  it("accepts an array of modules to avoid module-key mismatches", async () => {
    render(
      <AuditLogViewer
        open
        onOpenChange={() => {}}
        module={["accounting", "accounting_vouchers", "vouchers"]}
      />,
    );
    await waitFor(() => expect(inSpy).toHaveBeenCalled());
    expect(inSpy).toHaveBeenCalledWith("module", [
      "accounting",
      "accounting_vouchers",
      "vouchers",
    ]);
  });

  it("renders voucher_date_changed entries with old and new dates for each edited voucher", async () => {
    render(
      <AuditLogViewer
        open
        onOpenChange={() => {}}
        module={["accounting", "accounting_vouchers", "vouchers"]}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText("voucher_date_changed").length).toBe(2);
    });
    expect(screen.getByText(/old=01-07-2025 new=02-07-2025/)).toBeInTheDocument();
    expect(screen.getByText(/old=05-07-2025 new=07-07-2025/)).toBeInTheDocument();
  });
});
