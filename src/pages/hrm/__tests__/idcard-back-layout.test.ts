import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression guard for the ID-card BACK-side layout so that any accidental
// drift from the reference sample (navy body text, red phone/email highlights,
// bottom-left QR with margin-top:auto, and rounded black sidebar) is caught.
const source = readFileSync(
  resolve(__dirname, "../IdCardsPage.tsx"),
  "utf8",
);

describe("ID card back side — sample alignment", () => {
  it("keeps navy body text and red highlight tokens in print CSS", () => {
    expect(source).toContain(".back .sb");
    expect(source).toMatch(/\.back \.sb\s*{[^}]*color:\s*#1e3a8a/);
    expect(source).toMatch(/\.back \.sb \.hl\s*{[^}]*color:\s*#dc2626/);
  });

  it("anchors QR to the bottom of the back main column", () => {
    expect(source).toMatch(/\.back \.qr\s*{[^}]*margin-top:\s*auto/);
    expect(source).toMatch(/\.back \.qr img\s*{[^}]*width:\s*22mm[^}]*height:\s*22mm/);
  });

  it("renders the black sidebar strip with rounded inside corners", () => {
    expect(source).toMatch(/\.back \.side\s*{[^}]*border-radius:\s*1mm 0 0 1mm/);
    expect(source).toContain("rounded-l-md");
  });

  it("wraps Phone/Email values in the red highlight span", () => {
    expect(source).toContain('Phone: <span class="hl">${companyPhone}</span>');
    expect(source).toContain('Email: <span class="hl">${companyEmail}</span>');
  });

  it("preserves the CR80 print page size for the back card", () => {
    expect(source).toMatch(/@page\s*{\s*size:\s*54mm\s+85\.6mm/);
  });
});
