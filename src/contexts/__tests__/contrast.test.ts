import { describe, it, expect } from "vitest";
import { contrastRatio, parseHsl } from "../BrandingContext";

/**
 * WCAG 2.1 contrast tests for the branding color system.
 * Covers light/dark surfaces × Primary/Secondary edge cases so the
 * Branding page's Pass/Low badges stay reliable.
 */
describe("parseHsl", () => {
  it("parses standard HSL triples", () => {
    expect(parseHsl("161 100% 12%")).toEqual([161, 100, 12]);
    expect(parseHsl("43 55% 54%")).toEqual([43, 55, 54]);
  });
  it("returns null for garbage", () => {
    expect(parseHsl("")).toBeNull();
    expect(parseHsl("not-a-color")).toBeNull();
    expect(parseHsl("#003C28")).toBeNull();
  });
});

describe("contrastRatio (WCAG)", () => {
  const WHITE = "0 0% 100%";
  const BLACK = "0 0% 0%";

  it("is symmetric and ranges 1..21", () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 0);
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 0);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 1);
  });

  describe("brand defaults (deep green / gold)", () => {
    const PRIMARY = "161 100% 12%";   // #003C28
    const ACCENT = "43 55% 54%";      // #C9A84C

    it("PASS: white text on deep-green primary clears 4.5", () => {
      expect(contrastRatio(WHITE, PRIMARY)).toBeGreaterThanOrEqual(4.5);
    });
    it("PASS: deep-green text on gold accent clears 4.5", () => {
      expect(contrastRatio(PRIMARY, ACCENT)).toBeGreaterThanOrEqual(4.5);
    });
    it("LOW: white text on gold accent fails 4.5 (predictable Low badge)", () => {
      expect(contrastRatio(WHITE, ACCENT)).toBeLessThan(4.5);
    });
  });

  describe("edge cases for Pass/Low reliability", () => {
    it("very light primary → white text fails", () => {
      expect(contrastRatio(WHITE, "0 0% 90%")).toBeLessThan(4.5);
    });
    it("very dark primary → white text passes", () => {
      expect(contrastRatio(WHITE, "0 0% 10%")).toBeGreaterThanOrEqual(4.5);
    });
    it("mid-gray primary → both white and black fail AA", () => {
      const gray = "0 0% 50%";
      expect(contrastRatio(WHITE, gray)).toBeLessThan(4.5);
      expect(contrastRatio(BLACK, gray)).toBeGreaterThanOrEqual(4.5); // black still ok
    });
    it("dark-mode surface vs gold accent passes", () => {
      // Dark background tinted with primary green at 6% L
      expect(contrastRatio("43 55% 54%", "161 35% 6%")).toBeGreaterThanOrEqual(4.5);
    });
    it("invalid HSL is treated as black (ratio still finite)", () => {
      const r = contrastRatio("garbage", WHITE);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThan(1);
    });
  });
});
