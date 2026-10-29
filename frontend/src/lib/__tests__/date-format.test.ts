import { describe, it, expect } from "vitest";
import { formatDateDMY } from "@/lib/date-format";

describe("formatDateDMY", () => {
  it("converts ISO YYYY-MM-DD to DD-MM-YYYY", () => {
    expect(formatDateDMY("2026-06-22")).toBe("22-06-2026");
  });

  it("handles ISO timestamps by slicing the date portion", () => {
    expect(formatDateDMY("2026-01-05T10:30:00.000Z")).toBe("05-01-2026");
  });

  it("formats Date objects", () => {
    expect(formatDateDMY(new Date(2026, 11, 9))).toBe("09-12-2026");
  });

  it("returns em-dash for null/undefined/empty", () => {
    expect(formatDateDMY(null)).toBe("—");
    expect(formatDateDMY(undefined)).toBe("—");
    expect(formatDateDMY("")).toBe("—");
  });

  it("returns the input unchanged when not ISO-shaped", () => {
    expect(formatDateDMY("22-06-2026")).toBe("22-06-2026");
    expect(formatDateDMY("not-a-date")).toBe("not-a-date");
  });

  it("does not mutate the underlying ISO ordering (sort safety)", () => {
    const iso = ["2026-01-10", "2025-12-31", "2026-06-22"];
    const sorted = [...iso].sort();
    expect(sorted).toEqual(["2025-12-31", "2026-01-10", "2026-06-22"]);
    // Display values do not affect sort because sorting happens on ISO source.
    expect(sorted.map(formatDateDMY)).toEqual([
      "31-12-2025",
      "10-01-2026",
      "22-06-2026",
    ]);
  });
});
