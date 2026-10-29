import { describe, it, expect } from "vitest";

/**
 * Mirrors the payment/due calculation used by:
 *   - SalesInvoiceDetailPage.tsx
 *   - SalesPage.tsx
 *   - CustomerProfilePage.tsx
 *
 * Rule: allocations whose parent payment is soft-deleted (payment.deleted_at IS NOT NULL)
 * MUST be excluded from paidAmount so the invoice returns to DUE when the receipt is deleted.
 */
type Allocation = { allocated_amount: number; payment: { id: string; deleted_at: string | null } | null };

function paidAmountFromAllocations(allocs: Allocation[]): number {
  return allocs
    .filter((a) => a.payment && !a.payment.deleted_at)
    .reduce((s, a) => s + Number(a.allocated_amount || 0), 0);
}

function dueFrom(grandTotal: number, paid: number): number {
  return Math.max(0, grandTotal - paid);
}

function status(grandTotal: number, paid: number): "PAID" | "PARTIAL" | "DUE" {
  const due = dueFrom(grandTotal, paid);
  if (due <= 0) return "PAID";
  if (paid > 0) return "PARTIAL";
  return "DUE";
}

describe("invoice due recalculates when receipt is deleted", () => {
  const grandTotal = 1000;

  it("marks invoice PAID while receipt is active", () => {
    const allocs: Allocation[] = [{ allocated_amount: 1000, payment: { id: "p1", deleted_at: null } }];
    const paid = paidAmountFromAllocations(allocs);
    expect(paid).toBe(1000);
    expect(status(grandTotal, paid)).toBe("PAID");
    expect(dueFrom(grandTotal, paid)).toBe(0);
  });

  it("reverts to DUE after the receipt is soft-deleted", () => {
    const allocs: Allocation[] = [
      { allocated_amount: 1000, payment: { id: "p1", deleted_at: "2026-07-08T10:00:00Z" } },
    ];
    const paid = paidAmountFromAllocations(allocs);
    expect(paid).toBe(0);
    expect(status(grandTotal, paid)).toBe("DUE");
    expect(dueFrom(grandTotal, paid)).toBe(1000);
  });

  it("recomputes PARTIAL when one of two receipts is deleted", () => {
    const allocs: Allocation[] = [
      { allocated_amount: 400, payment: { id: "p1", deleted_at: null } },
      { allocated_amount: 600, payment: { id: "p2", deleted_at: "2026-07-08T10:00:00Z" } },
    ];
    const paid = paidAmountFromAllocations(allocs);
    expect(paid).toBe(400);
    expect(status(grandTotal, paid)).toBe("PARTIAL");
    expect(dueFrom(grandTotal, paid)).toBe(600);
  });

  it("ignores allocations with null payment (orphaned rows)", () => {
    const allocs: Allocation[] = [
      { allocated_amount: 500, payment: null },
      { allocated_amount: 500, payment: { id: "p1", deleted_at: null } },
    ];
    expect(paidAmountFromAllocations(allocs)).toBe(500);
  });
});
