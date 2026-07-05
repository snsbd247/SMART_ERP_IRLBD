import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BACK_QR,
  BACK_COLORS,
  BACK_FONT_SCALE,
  CARD_MM,
  PRINT_PAGE,
  backCssBlock,
  pageFrameCss,
} from "../idCardLayout";

const source = readFileSync(resolve(__dirname, "../IdCardsPage.tsx"), "utf8");
const back = backCssBlock();
const page = pageFrameCss();

// Sample-alignment regression for the ID-card BACK side. All values come from
// idCardLayout.ts so any drift in the shared constants is caught in one place.
describe("ID card back side — sample alignment", () => {
  it("uses shared layout constants (no hardcoded values in the page)", () => {
    expect(source).toContain('import { BACK_QR, BACK_FONT_SCALE, backCssBlock, pageFrameCss } from "./idCardLayout"');
    expect(source).toContain("size={BACK_QR.onScreenPx}");
    expect(source).toContain("${backCssBlock(backFontScale)}");
    expect(source).toContain("${pageFrameCss()}");
  });

  it("keeps navy body text + red highlight tokens", () => {
    expect(BACK_COLORS.body.toLowerCase()).toBe("#1e3a8a");
    expect(BACK_COLORS.highlight.toLowerCase()).toBe("#dc2626");
    expect(back).toContain(`color: ${BACK_COLORS.body}`);
    expect(back).toContain(`color: ${BACK_COLORS.highlight}`);
  });

  it("scales back body + header font sizes with BACK_FONT_SCALE", () => {
    const small = backCssBlock(BACK_FONT_SCALE.min);
    const large = backCssBlock(BACK_FONT_SCALE.max);
    expect(back).toContain(`font-size: ${(2.6).toFixed(3)}mm`);
    expect(back).toContain(`font-size: ${(2.2).toFixed(3)}mm`);
    expect(small).toContain(`font-size: ${(2.6 * BACK_FONT_SCALE.min).toFixed(3)}mm`);
    expect(large).toContain(`font-size: ${(2.2 * BACK_FONT_SCALE.max).toFixed(3)}mm`);
    // UI exposes +/- controls wired to BACK_FONT_SCALE bounds.
    expect(source).toContain("BACK_FONT_SCALE.step");
    expect(source).toContain("BACK_FONT_SCALE.min");
    expect(source).toContain("BACK_FONT_SCALE.max");
  });

  it("centers the QR horizontally at the bottom of the main column", () => {
    expect(back).toMatch(/\.back \.qr\s*{[^}]*margin-top:\s*auto/);
    expect(back).toMatch(/\.back \.qr\s*{[^}]*justify-content:\s*center/);
    expect(back).toContain(
      `padding: ${BACK_QR.padMm.top}mm ${BACK_QR.padMm.right}mm ${BACK_QR.padMm.bottom}mm ${BACK_QR.padMm.left}mm`,
    );
    expect(back).toContain(`width: ${BACK_QR.sizeMm}mm; height: ${BACK_QR.sizeMm}mm`);
  });

  it("renders the black sidebar strip flush with the card edge (no rounding, no margin)", () => {
    expect(back).toMatch(/\.back \.side\s*{[^}]*border-radius:\s*0/);
    expect(back).toMatch(/\.back \.side\s*{[^}]*margin:\s*0/);
    expect(source).not.toContain("rounded-l-md");
  });


  it("wraps Phone/Email values in the red highlight span", () => {
    expect(source).toContain('Phone: <span class="hl">${companyPhone}</span>');
    expect(source).toContain('Email: <span class="hl">${companyEmail}</span>');
  });

  it("locks CR80 page geometry with zero device margin", () => {
    expect(PRINT_PAGE.sizeCss).toBe(`${CARD_MM.width}mm ${CARD_MM.height}mm`);
    expect(PRINT_PAGE.marginCss).toBe("0");
    expect(page).toContain(`@page { size: ${PRINT_PAGE.sizeCss}; margin: 0`);
  });
});
