import { describe, it, expect } from "vitest";
import {
  buildChallanUrl,
  challanValidationMessage,
  isValidChallanNo,
  validateChallanNo,
  CHALLAN_MIN_LEN,
  CHALLAN_MAX_LEN,
} from "@/lib/challan-utils";

describe("validateChallanNo", () => {
  it("rejects empty / nullish values", () => {
    expect(validateChallanNo(null)).toEqual({ valid: false, reason: "empty" });
    expect(validateChallanNo(undefined)).toEqual({ valid: false, reason: "empty" });
    expect(validateChallanNo("")).toEqual({ valid: false, reason: "empty" });
    expect(validateChallanNo("   ")).toEqual({ valid: false, reason: "empty" });
  });

  it("rejects too-short and too-long", () => {
    expect(validateChallanNo("ab")).toEqual({ valid: false, reason: "too_short" });
    expect(validateChallanNo("a".repeat(CHALLAN_MAX_LEN + 1))).toEqual({
      valid: false,
      reason: "too_long",
    });
  });

  it("rejects bad characters", () => {
    expect(validateChallanNo("abc 123")).toEqual({ valid: false, reason: "bad_chars" });
    expect(validateChallanNo("abc#123")).toEqual({ valid: false, reason: "bad_chars" });
    expect(validateChallanNo("中文abc")).toEqual({ valid: false, reason: "bad_chars" });
  });

  it("accepts valid alphanumeric / -/ combinations", () => {
    expect(validateChallanNo("12345")).toEqual({ valid: true, value: "12345" });
    expect(validateChallanNo("ACS-2026/123")).toEqual({
      valid: true,
      value: "ACS-2026/123",
    });
    expect(validateChallanNo("  123456  ")).toEqual({ valid: true, value: "123456" });
  });

  it("isValidChallanNo mirrors validateChallanNo.valid", () => {
    expect(isValidChallanNo("12345")).toBe(true);
    expect(isValidChallanNo("")).toBe(false);
    expect(isValidChallanNo(null)).toBe(false);
  });

  it("min length constant is respected", () => {
    expect(CHALLAN_MIN_LEN).toBeGreaterThanOrEqual(1);
  });
});

describe("challanValidationMessage", () => {
  it("returns '' for valid input", () => {
    expect(challanValidationMessage({ valid: true, value: "12345" })).toBe("");
  });

  it("returns descriptive messages per reason", () => {
    expect(challanValidationMessage({ valid: false, reason: "empty" })).toMatch(/empty/i);
    expect(challanValidationMessage({ valid: false, reason: "too_short" })).toMatch(/short/i);
    expect(challanValidationMessage({ valid: false, reason: "too_long" })).toMatch(/long/i);
    expect(challanValidationMessage({ valid: false, reason: "bad_chars" })).toMatch(/invalid characters/i);
  });
});

describe("buildChallanUrl", () => {
  it("encodes the challan number into the achallan.gov.bd URL", () => {
    expect(buildChallanUrl("ACS-2026/123")).toBe(
      "http://achallan.gov.bd/acs/General/PrintChallanSlipDetails?challanNo=ACS-2026%2F123",
    );
  });

  it("trims surrounding whitespace before encoding", () => {
    expect(buildChallanUrl("  12345  ")).toBe(
      "http://achallan.gov.bd/acs/General/PrintChallanSlipDetails?challanNo=12345",
    );
  });

  it("always targets the official portal host", () => {
    const url = new URL(buildChallanUrl("12345"));
    expect(url.host).toBe("achallan.gov.bd");
    expect(url.pathname).toBe("/acs/General/PrintChallanSlipDetails");
    expect(url.searchParams.get("challanNo")).toBe("12345");
  });
});
