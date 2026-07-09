import { describe, expect, it } from "vitest";
import { canShowVoucherDeleteAction, evaluateVoucherPermission, type VoucherType } from "../voucher-permissions";

const evaluateWith = (grants: string[], isSuperAdmin = false) => (type: string, action: "delete") =>
  evaluateVoucherPermission(
    {
      isSuperAdmin,
      hasPermission: (module, column) => {
        const actionName = column === "can_delete" ? "delete" : column;
        return grants.includes(`${module}.${actionName}`);
      },
    },
    type as VoucherType,
    action,
  );

describe("voucher delete UI permission", () => {
  it("shows delete for Accountant receipt delete permission", () => {
    expect(canShowVoucherDeleteAction({ voucherType: "receipt", evaluate: evaluateWith(["receipt.delete"]) })).toBe(true);
  });

  it("shows delete for accounts umbrella delete permission", () => {
    expect(canShowVoucherDeleteAction({ voucherType: "receipt", evaluate: evaluateWith(["accounts.delete"]) })).toBe(true);
  });

  it("hides delete for another voucher type permission", () => {
    expect(canShowVoucherDeleteAction({ voucherType: "receipt", evaluate: evaluateWith(["journal.delete"]) })).toBe(false);
  });

  it("hides delete for already deleted vouchers", () => {
    expect(canShowVoucherDeleteAction({ isDeleted: true, voucherType: "receipt", evaluate: evaluateWith(["receipt.delete"]) })).toBe(false);
  });

  it("shows delete for Super Admin regardless of grants", () => {
    const evaluate = evaluateWith([], true);
    for (const t of ["journal", "payment", "receipt", "contra"] as const) {
      expect(canShowVoucherDeleteAction({ voucherType: t, evaluate })).toBe(true);
    }
  });
});

/**
 * UI behavior contract for the row-level Delete icon in AccountingVouchers.tsx:
 *   - Rendered only when canDeleteVoucher(v) && !v.deleted_at (button is HIDDEN otherwise).
 *   - No tooltip is shown when hidden, because the button is unmounted entirely.
 * This test locks that contract per the four canonical roles.
 */
describe("row-level delete button visibility by role", () => {
  type Role = { name: string; grants: string[]; isSuperAdmin?: boolean };
  const roles: Role[] = [
    { name: "SuperAdmin", grants: [], isSuperAdmin: true },
    { name: "Admin",      grants: ["accounts.delete", "accounts.view", "accounts.edit"] },
    { name: "Accountant", grants: ["receipt.delete", "payment.delete", "journal.delete", "contra.delete"] },
    { name: "Manager",    grants: ["accounts.view", "accounts.edit"] },
    { name: "Viewer",     grants: ["accounts.view"] },
  ];

  const expected: Record<string, Record<string, boolean>> = {
    SuperAdmin: { journal: true,  payment: true,  receipt: true,  contra: true  },
    Admin:      { journal: true,  payment: true,  receipt: true,  contra: true  },
    Accountant: { journal: true,  payment: true,  receipt: true,  contra: true  },
    Manager:    { journal: false, payment: false, receipt: false, contra: false },
    Viewer:     { journal: false, payment: false, receipt: false, contra: false },
  };

  for (const role of roles) {
    for (const type of ["journal", "payment", "receipt", "contra"] as VoucherType[]) {
      it(`${role.name} ${expected[role.name][type] ? "sees" : "does NOT see"} Delete for ${type}`, () => {
        const evaluate = evaluateWith(role.grants, role.isSuperAdmin);
        expect(canShowVoucherDeleteAction({ voucherType: type, evaluate })).toBe(expected[role.name][type]);
      });
    }
  }

  it("hides Delete for an already-deleted voucher even with full permission", () => {
    const evaluate = evaluateWith([], true);
    expect(canShowVoucherDeleteAction({ isDeleted: true, voucherType: "receipt", evaluate })).toBe(false);
  });
});
