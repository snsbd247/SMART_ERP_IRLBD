import { expect } from "vitest";

/**
 * Asserts a rendered balance string follows the signed convention:
 *  - Never contains a standalone "Dr" or "Cr" token.
 *  - Negative values start with "-"; positives never do.
 *
 * Use on any new UI that renders a signed balance to guarantee the
 * Dr/Cr suffix never creeps back in.
 */
export function expectSignedBalance(text: string | null | undefined, expectedSign: "negative" | "positive" | "zero") {
  const t = (text ?? "").trim();
  expect(t, "balance text should not be empty").not.toBe("");
  expect(t, "balance text should not contain Dr/Cr suffix").not.toMatch(/\b(Dr|Cr)\b/);
  if (expectedSign === "negative") {
    expect(t.startsWith("-"), `expected leading '-' in: ${t}`).toBe(true);
  } else {
    expect(t.startsWith("-"), `expected no leading '-' in: ${t}`).toBe(false);
  }
}

/**
 * Asserts that a node (or its textContent) never carries Dr/Cr.
 * Useful for snapshot-style checks on balance components.
 */
export function expectNoDrCrSuffix(node: { textContent: string | null } | string | null | undefined) {
  const t = typeof node === "string" ? node : (node?.textContent ?? "");
  expect(t, "node should not contain Dr/Cr suffix").not.toMatch(/\b(Dr|Cr)\b/);
}
