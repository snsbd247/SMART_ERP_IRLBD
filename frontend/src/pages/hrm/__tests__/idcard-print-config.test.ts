import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CARD_MM, PRINT_PAGE, pageFrameCss, backCssBlock } from "../idCardLayout";

const source = readFileSync(resolve(__dirname, "../IdCardsPage.tsx"), "utf8");

// The card is always printed at exact CR80 (54 × 85.6 mm) — smaller than A4
// (210 × 297 mm) and Letter (215.9 × 279.4 mm), so it must fit inside either
// paper size with room to spare. `@page { margin: 0 }` prevents device/browser
// default margins (typ. 6-15 mm) from shifting content or clipping the QR.
describe("ID card print/PDF page config", () => {
  const A4 = { w: 210, h: 297 };
  const LETTER = { w: 215.9, h: 279.4 };

  it("card fits inside both A4 and Letter", () => {
    for (const paper of [A4, LETTER]) {
      expect(CARD_MM.width).toBeLessThan(paper.w);
      expect(CARD_MM.height).toBeLessThan(paper.h);
    }
  });

  it("declares an exact CR80 @page size (not paper-relative)", () => {
    expect(PRINT_PAGE.sizeCss).toBe("54mm 85.6mm");
    expect(pageFrameCss()).toContain("@page { size: 54mm 85.6mm; margin: 0; }");
  });

  it("locks @page margin to 0 so printer defaults cannot shift the QR/padding", () => {
    expect(PRINT_PAGE.marginCss).toBe("0");
    expect(source).toMatch(/@page\s*{\s*size:\s*53\.98mm\s+85\.6mm;\s*margin:\s*0/);
  });

  it("disables browser auto-formatting for phone/email so they render as plain text", () => {
    expect(source).toContain(
      '<meta name="format-detection" content="telephone=no,email=no,address=no" />',
    );
  });

  it("back-side QR padding is expressed in mm (device-independent)", () => {
    expect(backCssBlock()).toMatch(/\.back \.qr\s*{[^}]*padding:\s*\d+mm \d+mm \d+mm \d+mm/);
  });
});
