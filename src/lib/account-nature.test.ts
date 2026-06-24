import { describe, it, expect } from "vitest";
import { getNaturalSide, validateEntryNature } from "./account-nature";

describe("getNaturalSide", () => {
  it("maps asset/expense to dr and liability/equity/income to cr", () => {
    expect(getNaturalSide("asset")).toBe("dr");
    expect(getNaturalSide("expense")).toBe("dr");
    expect(getNaturalSide("liability")).toBe("cr");
    expect(getNaturalSide("equity")).toBe("cr");
    expect(getNaturalSide("income")).toBe("cr");
    expect(getNaturalSide(null)).toBe("dr");
  });
});

describe("validateEntryNature", () => {
  const accounts = [
    { id: "a1", account_code: "1000", account_name: "Cash", account_type: "asset" },
    { id: "a2", account_code: "4000", account_name: "Sales", account_type: "income" },
    { id: "a3", account_code: "9000", account_name: "Mystery", account_type: null },
  ];

  it("flags dr row with credit amount as an error", () => {
    const { errors } = validateEntryNature(
      [{ account_id: "a1", dr_cr: "dr", debit: 0, credit: 100 }],
      accounts
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("amount_mismatch");
  });

  it("flags rows with no amount at all", () => {
    const { errors } = validateEntryNature(
      [{ account_id: "a1", dr_cr: "dr", debit: 0, credit: 0 }],
      accounts
    );
    expect(errors[0].kind).toBe("zero_amount");
  });

  it("warns (not errors) when posting against natural side", () => {
    // Crediting an asset is a legal contra entry → warning only.
    const { errors, warnings } = validateEntryNature(
      [{ account_id: "a1", dr_cr: "cr", debit: 0, credit: 50 }],
      accounts
    );
    expect(errors).toHaveLength(0);
    expect(warnings[0].kind).toBe("nature_warning");
  });

  it("warns when account_type is missing", () => {
    const { warnings } = validateEntryNature(
      [{ account_id: "a3", dr_cr: "dr", debit: 10, credit: 0 }],
      accounts
    );
    expect(warnings[0].kind).toBe("missing_account");
  });

  it("passes clean for a standard sale: Dr Cash / Cr Sales", () => {
    const { errors, warnings } = validateEntryNature(
      [
        { account_id: "a1", dr_cr: "dr", debit: 100, credit: 0 },
        { account_id: "a2", dr_cr: "cr", debit: 0, credit: 100 },
      ],
      accounts
    );
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
