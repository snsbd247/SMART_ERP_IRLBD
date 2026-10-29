import { describe, it, expect } from "vitest";
import {
  DEFAULT_IN_CHUNK_SIZE,
  APACHE_LIMIT_REQUEST_LINE,
  chunkIds,
  estimateInClauseUrlLength,
  assertChunksFit,
  isUrlTooLargeError,
  getInChunkSize,
} from "../in-chunk";

const uuid = (i: number) =>
  `${i.toString(16).padStart(8, "0")}-aaaa-bbbb-cccc-${i.toString(16).padStart(12, "0")}`;

describe("in-chunk helpers", () => {
  it("uses a safe default chunk size", () => {
    expect(getInChunkSize()).toBe(DEFAULT_IN_CHUNK_SIZE);
    expect(DEFAULT_IN_CHUNK_SIZE).toBeLessThanOrEqual(150);
  });

  it("splits ids into chunks of the requested size", () => {
    const ids = Array.from({ length: 250 }, (_, i) => uuid(i));
    const chunks = chunkIds(ids, 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it("regression: 10k UUIDs never build an IN clause exceeding LimitRequestLine", () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => uuid(i));
    // Simulate the longest real base URL we build (Laravel report-fetch path).
    const baseUrl =
      "https://accounting.syncsolutionbd.com/api/v1/db/voucher_entries" +
      "?select=id,account_id,debit,credit,narration,voucher_id" +
      "&f[voucher_id][in]=" +
      "&f[account_id][eq]=" +
      uuid(0) +
      "&limit=10000";
    const max = assertChunksFit(baseUrl, ids);
    expect(max).toBeLessThan(APACHE_LIMIT_REQUEST_LINE);
  });

  it("throws when the configured chunk size would exceed the limit", () => {
    const ids = Array.from({ length: 500 }, (_, i) => uuid(i));
    expect(() => assertChunksFit("/api/x?f[in]=", ids, 500, 4000)).toThrow(/exceeding limit/);
  });

  it("estimates URL length using percent-encoded joins", () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    const len = estimateInClauseUrlLength("/api/x?f[in]=", ids);
    // 3 UUIDs (36 chars each) + 2 encoded commas (%2C = 3 chars) + base
    expect(len).toBe("/api/x?f[in]=".length + 36 * 3 + 3 * 2);
  });

  it("detects 414 / URI-too-large errors from various shapes", () => {
    expect(isUrlTooLargeError({ status: 414 })).toBe(true);
    expect(isUrlTooLargeError({ response: { status: 414 } })).toBe(true);
    expect(isUrlTooLargeError(new Error("HTTP 414 Request-URI Too Large"))).toBe(true);
    expect(isUrlTooLargeError(new Error("Request Header Or Cookie Too Large"))).toBe(true);
    expect(isUrlTooLargeError(new Error("500 server error"))).toBe(false);
    expect(isUrlTooLargeError(null)).toBe(false);
  });
});
