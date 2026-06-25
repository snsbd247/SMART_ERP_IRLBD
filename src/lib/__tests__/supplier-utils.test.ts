import { describe, it, expect } from "vitest";
import {
  nextSupplierCode,
  findDuplicateSupplierCode,
  buildSupplierPayload,
} from "../supplier-utils";

describe("nextSupplierCode", () => {
  it("starts at SUP-0001 when no suppliers exist", () => {
    expect(nextSupplierCode([])).toBe("SUP-0001");
  });
  it("increments past the max trailing number", () => {
    expect(nextSupplierCode([{ code: "SUP-0007" }, { code: "SUP-0003" }])).toBe("SUP-0008");
  });
  it("skips an already-used candidate", () => {
    expect(
      nextSupplierCode([{ code: "SUP-0004" }, { code: "SUP-0005" }]),
    ).toBe("SUP-0006");
  });
});

describe("findDuplicateSupplierCode", () => {
  const items = [
    { id: "a", code: "SUP-0001" },
    { id: "b", code: "SUP-0002" },
  ];
  it("detects duplicate (case-insensitive)", () => {
    expect(findDuplicateSupplierCode(items, "sup-0001")).toBe("a");
  });
  it("returns null when unique", () => {
    expect(findDuplicateSupplierCode(items, "SUP-0099")).toBeNull();
  });
  it("ignores the row being edited", () => {
    expect(findDuplicateSupplierCode(items, "SUP-0001", "a")).toBeNull();
  });
});

describe("buildSupplierPayload — is_active regression", () => {
  it("defaults is_active to true when creating", () => {
    const p = buildSupplierPayload({ code: "X", name: "Y" });
    expect(p.is_active).toBe(true);
  });
  it("preserves explicit true on edit toggle", () => {
    const p = buildSupplierPayload({ code: "X", name: "Y", is_active: true });
    expect(p.is_active).toBe(true);
  });
  it("preserves explicit false on edit toggle", () => {
    const p = buildSupplierPayload({ code: "X", name: "Y", is_active: false });
    expect(p.is_active).toBe(false);
  });
  it("treats null/undefined as true (never silently deactivates)", () => {
    expect(buildSupplierPayload({ is_active: null }).is_active).toBe(true);
    expect(buildSupplierPayload({}).is_active).toBe(true);
  });
  it("normalises numeric and date fields", () => {
    const p = buildSupplierPayload({
      credit_limit: "1500" as any,
      credit_days: "30" as any,
      opening_balance_date: "",
    });
    expect(p.credit_limit).toBe(1500);
    expect(p.credit_days).toBe(30);
    expect(p.opening_balance_date).toBeNull();
  });
});
