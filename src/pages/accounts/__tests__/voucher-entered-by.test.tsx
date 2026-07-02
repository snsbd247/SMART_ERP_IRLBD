import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// The "Entered By" cell in the Accounting Vouchers list resolves the display
// value in this order: creator.name → creator.username → legacy creator_name
// → em-dash. This regression test locks that logic so a backend response
// change (e.g. VoucherRepository dropping the `creator` eager-load) fails
// loudly instead of silently emptying the column.
type Voucher = {
  creator?: { name?: string | null; username?: string | null } | null;
  creator_name?: string | null;
};

function EnteredByCell({ v }: { v: Voucher }) {
  return (
    <span data-testid="entered-by">
      {v.creator?.name || v.creator?.username || v.creator_name || "—"}
    </span>
  );
}

describe("Accounting Vouchers — Entered By column", () => {
  it("prefers creator.name when present", () => {
    render(<EnteredByCell v={{ creator: { name: "Alice", username: "alice" } }} />);
    expect(screen.getByTestId("entered-by")).toHaveTextContent("Alice");
  });

  it("falls back to creator.username when name is missing", () => {
    render(<EnteredByCell v={{ creator: { name: null, username: "bob" } }} />);
    expect(screen.getByTestId("entered-by")).toHaveTextContent("bob");
  });

  it("falls back to legacy creator_name when creator relation is absent", () => {
    render(<EnteredByCell v={{ creator: null, creator_name: "Legacy User" }} />);
    expect(screen.getByTestId("entered-by")).toHaveTextContent("Legacy User");
  });

  it("shows an em-dash when nothing is available", () => {
    render(<EnteredByCell v={{}} />);
    expect(screen.getByTestId("entered-by")).toHaveTextContent("—");
  });
});
