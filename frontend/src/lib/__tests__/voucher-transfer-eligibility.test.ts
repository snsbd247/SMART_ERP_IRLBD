import { describe, it, expect } from "vitest";

/**
 * Mirror of the eligibility predicate used in AccountingVouchers.tsx to render
 * the Change Type (Transfer) action. If this rule ever drifts, update BOTH
 * locations at the same time — auto-posted vouchers (source_module set) must
 * never be transferable, even for Super Admin.
 */
type VLike = {
  status?: string;
  voucher_type: string;
  deleted_at?: string | null;
  source_module?: string | null;
};

function canShowChangeType(
  v: VLike,
  opts: { canEditSource: boolean; hasAnyOtherCreatable: boolean }
): boolean {
  return (
    !v.deleted_at &&
    v.status !== "transferred" &&
    !v.source_module &&
    opts.canEditSource &&
    opts.hasAnyOtherCreatable
  );
}

describe("Change Type (Transfer) UI eligibility", () => {
  const base: VLike = { status: "approved", voucher_type: "payment" };
  const perms = { canEditSource: true, hasAnyOtherCreatable: true };

  it("shows for a normal manual payment voucher", () => {
    expect(canShowChangeType(base, perms)).toBe(true);
  });

  it("hides for auto-posted vouchers (Sales/Purchase)", () => {
    expect(canShowChangeType({ ...base, source_module: "sales" }, perms)).toBe(false);
    expect(canShowChangeType({ ...base, source_module: "purchase" }, perms)).toBe(false);
  });

  it("hides for already-transferred vouchers", () => {
    expect(canShowChangeType({ ...base, status: "transferred" }, perms)).toBe(false);
  });

  it("hides for soft-deleted vouchers", () => {
    expect(canShowChangeType({ ...base, deleted_at: "2026-07-02" }, perms)).toBe(false);
  });

  it("hides when user cannot edit the source voucher", () => {
    expect(canShowChangeType(base, { ...perms, canEditSource: false })).toBe(false);
  });

  it("hides when no other voucher type is creatable", () => {
    expect(canShowChangeType(base, { ...perms, hasAnyOtherCreatable: false })).toBe(false);
  });
});
