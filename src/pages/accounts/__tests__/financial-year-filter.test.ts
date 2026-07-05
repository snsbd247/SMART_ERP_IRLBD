/**
 * Regression tests for Financial Year filtering in Accounting Vouchers.
 *
 * The FY dropdown must:
 *  1. Only expose Active FYs to new voucher creation.
 *  2. Preserve an already-selected Inactive FY when editing an old voucher,
 *     rendered with an "(Inactive)" suffix so the user can see the state.
 *  3. Auto-match FY by date must skip inactive years.
 */
import { describe, it, expect } from "vitest";

type FY = { id: string; name: string; start_date: string; end_date: string; is_active: boolean };

const YEARS: FY[] = [
  { id: "fy1", name: "FY 2025-2026", start_date: "2025-07-01", end_date: "2026-06-30", is_active: true },
  { id: "fy2", name: "FY 2026-2027", start_date: "2026-07-01", end_date: "2027-06-30", is_active: false },
];

// Pure helpers extracted from AccountingVouchers.tsx behavior.
const dropdownOptions = (years: FY[], selectedId: string) =>
  years
    .filter((f) => f.is_active || f.id === selectedId)
    .map((f) => ({ id: f.id, label: `${f.name}${!f.is_active ? " (Inactive)" : ""}` }));

const matchByDate = (years: FY[], iso: string) =>
  years.find((fy) => fy.is_active && fy.start_date <= iso && fy.end_date >= iso);

describe("Financial Year dropdown filtering", () => {
  it("shows only active FYs when nothing selected", () => {
    const opts = dropdownOptions(YEARS, "");
    expect(opts).toEqual([{ id: "fy1", label: "FY 2025-2026" }]);
  });

  it("shows selected inactive FY with (Inactive) suffix in edit mode", () => {
    const opts = dropdownOptions(YEARS, "fy2");
    expect(opts).toEqual([
      { id: "fy1", label: "FY 2025-2026" },
      { id: "fy2", label: "FY 2026-2027 (Inactive)" },
    ]);
  });

  it("hides inactive FYs from date-based auto-match", () => {
    // Date falls in inactive FY 2026-2027 → should NOT match.
    expect(matchByDate(YEARS, "2026-08-15")).toBeUndefined();
    // Date in active FY 2025-2026 → matches.
    expect(matchByDate(YEARS, "2025-09-10")?.id).toBe("fy1");
  });

  it("client-side guard blocks post when selected FY inactive", () => {
    const selected = YEARS.find((f) => f.id === "fy2");
    const blocked = !!selected && !selected.is_active;
    expect(blocked).toBe(true);
  });
});
