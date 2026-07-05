import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../IdCardsPage.tsx"), "utf8");

// Regression guard for the ID-card FRONT-side layout so accidental drift from
// the reference sample (orange top band, transparent logo, blue photo frame,
// centered name/designation, JsBarcode + employee code) is caught.
describe("ID card front side — sample alignment", () => {
  it("uses the orange (#ef7a1a) top band with fixed 340×539 preview frame", () => {
    expect(source).toContain('className="w-[340px] h-[539px]');
    expect(source).toContain('bg-[#ef7a1a]');
    expect(source).toContain('h-[340px]'); // top band height in preview
  });

  it("renders the company logo transparently (no white pill background)", () => {
    // Logo <img> and fallback both drop bg-white / rounded pill.
    expect(source).toContain('<img src={companyLogo} alt="Logo" className="h-10 w-10 object-contain" />');
    expect(source).not.toMatch(/alt="Logo"[^/]*bg-white/);
  });

  it("keeps the blue photo frame + centered name/designation", () => {
    expect(source).toMatch(/border-\[3px\] border-\[#2f6bd6\]/);
    expect(source).toMatch(/text-lg font-extrabold[^"]*"[^>]*>\{emp\.first_name\} \{emp\.last_name\}/);
  });

  it("renders the barcode canvas + tracked employee code", () => {
    expect(source).toContain('<canvas ref={barcodeRef}');
    expect(source).toMatch(/tracking-\[4px\][^>]*>\{emp\.employee_code\}/);
  });

  it("prints the front-side CSS with matching orange band + barcode dims", () => {
    expect(source).toMatch(/\.front \.top\s*{[^}]*background:\s*#ef7a1a[^}]*height:\s*54mm/);
    expect(source).toMatch(/\.front \.bc img\s*{[^}]*height:\s*11mm[^}]*width:\s*40mm/);
  });
});
