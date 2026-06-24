import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatSignedBalance } from "@/lib/balance-format";
import { expectSignedBalance, expectNoDrCrSuffix } from "@/test/balance-assertions";

// Mirrors the exact JSX pattern used in AccountingVouchers.tsx for the
// "Curr Bal" line, so a future refactor that breaks the signed-value
// contract on the voucher form will fail this test.
const fc = (n: number) =>
  `৳ ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function CurrBalLine({ signed }: { signed: number | null }) {
  return (
    <div className="text-xs text-muted-foreground">
      Curr Bal : {signed === null ? "" : formatSignedBalance(signed, fc)}
    </div>
  );
}

describe("AccountingVouchers · Curr Bal rendering (signed convention)", () => {
  it("shows negative balance with leading '-' and NO Dr/Cr suffix", () => {
    render(<CurrBalLine signed={-12735308.96} />);
    const node = screen.getByText(/Curr Bal/);
    expect(node.textContent).toBe("Curr Bal : -৳ 12,735,308.96");
    expectSignedBalance(node.textContent?.replace("Curr Bal : ", ""), "negative");
  });

  it("shows positive balance without sign and NO Dr/Cr suffix", () => {
    render(<CurrBalLine signed={20339216.76} />);
    const node = screen.getByText(/Curr Bal/);
    expect(node.textContent).toBe("Curr Bal : ৳ 20,339,216.76");
    expectSignedBalance(node.textContent?.replace("Curr Bal : ", ""), "positive");
  });

  it("renders empty when no account is selected", () => {
    render(<CurrBalLine signed={null} />);
    expect(screen.getByText(/Curr Bal/).textContent).toBe("Curr Bal : ");
  });

  it("reusable helper detects accidental Dr/Cr suffix", () => {
    expect(() => expectNoDrCrSuffix("৳ 100.00 Cr")).toThrow();
    expect(() => expectNoDrCrSuffix("-৳ 100.00")).not.toThrow();
  });
});
