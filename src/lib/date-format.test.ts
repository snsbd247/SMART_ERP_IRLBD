import { describe, it, expect } from "vitest";
import {
  toDateInputValue,
  isoToDmy,
  dmyToIso,
  isoToLocalDate,
  localDateToIso,
  formatDateDMY,
} from "./date-format";

describe("date-format helpers", () => {
  describe("toDateInputValue", () => {
    it("returns empty string for nullish values", () => {
      expect(toDateInputValue(null)).toBe("");
      expect(toDateInputValue(undefined)).toBe("");
      expect(toDateInputValue("")).toBe("");
    });

    it("keeps plain YYYY-MM-DD untouched (no TZ shift)", () => {
      expect(toDateInputValue("2026-07-10")).toBe("2026-07-10");
    });

    it("formats a Date object using local calendar parts", () => {
      const d = new Date(2026, 6, 10); // local July 10, 2026
      expect(toDateInputValue(d)).toBe("2026-07-10");
    });

    it("resolves UTC-serialised timestamps in local time without off-by-one", () => {
      // A Date pinned to local midnight should always round-trip.
      const localMidnight = new Date(2026, 6, 10, 0, 0, 0);
      expect(toDateInputValue(localMidnight.toISOString())).toBe(
        toDateInputValue(localMidnight),
      );
    });
  });

  describe("isoToDmy <-> dmyToIso", () => {
    it("converts ISO to DD-MM-YYYY", () => {
      expect(isoToDmy("2026-07-10")).toBe("10-07-2026");
      expect(isoToDmy("2026-01-01")).toBe("01-01-2026");
    });

    it("converts DD-MM-YYYY back to ISO", () => {
      expect(dmyToIso("10-07-2026")).toBe("2026-07-10");
      expect(dmyToIso("1-1-2026")).toBe("2026-01-01");
    });

    it("accepts slash and dot separators", () => {
      expect(dmyToIso("10/07/2026")).toBe("2026-07-10");
      expect(dmyToIso("10.07.2026")).toBe("2026-07-10");
    });

    it("rejects invalid dates", () => {
      expect(dmyToIso("31-02-2026")).toBe(""); // Feb 31
      expect(dmyToIso("00-07-2026")).toBe("");
      expect(dmyToIso("10-13-2026")).toBe("");
      expect(dmyToIso("garbage")).toBe("");
      expect(dmyToIso("")).toBe("");
      expect(dmyToIso(null)).toBe("");
    });

    it("returns empty string for invalid ISO input", () => {
      expect(isoToDmy("")).toBe("");
      expect(isoToDmy("not-a-date")).toBe("");
    });

    it("round-trips ISO -> DMY -> ISO", () => {
      const samples = ["2026-07-10", "2024-02-29", "1999-12-31", "2026-01-01"];
      for (const iso of samples) {
        expect(dmyToIso(isoToDmy(iso))).toBe(iso);
      }
    });

    it("round-trips DMY -> ISO -> DMY", () => {
      const samples = ["10-07-2026", "29-02-2024", "31-12-1999", "01-01-2026"];
      for (const dmy of samples) {
        expect(isoToDmy(dmyToIso(dmy))).toBe(dmy);
      }
    });
  });

  describe("isoToLocalDate / localDateToIso", () => {
    it("parses ISO into a local Date and back without shifting", () => {
      const d = isoToLocalDate("2026-07-10");
      expect(d).toBeInstanceOf(Date);
      expect(localDateToIso(d!)).toBe("2026-07-10");
    });

    it("returns undefined for invalid ISO", () => {
      expect(isoToLocalDate("bogus")).toBeUndefined();
      expect(isoToLocalDate("")).toBeUndefined();
    });

    it("localDateToIso returns empty string for nullish", () => {
      expect(localDateToIso(null)).toBe("");
      expect(localDateToIso(undefined)).toBe("");
    });
  });

  describe("formatDateDMY", () => {
    it("returns em-dash for empty input", () => {
      expect(formatDateDMY(null)).toBe("—");
      expect(formatDateDMY("")).toBe("—");
    });

    it("formats valid dates as DD-MM-YYYY", () => {
      expect(formatDateDMY("2026-07-10")).toBe("10-07-2026");
    });
  });
});
