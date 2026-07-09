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
});