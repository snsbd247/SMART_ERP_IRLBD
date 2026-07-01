/**
 * Centralized helpers for chunking large `IN (...)` clauses so that GET request
 * URLs never exceed Apache's default `LimitRequestLine` (~8 KB) on VPS
 * (Laravel) deployments.
 *
 * Chunk size is configurable via the `VITE_IN_CHUNK_SIZE` env var (or
 * `window.__IN_CHUNK_SIZE__` at runtime) so we can tune it per deployment
 * without shipping new code. A conservative default keeps us safely under
 * `LimitRequestLine` for 36-char UUIDs plus URL overhead.
 */

/** Safe default: 100 UUIDs (~3.7 KB) + query overhead stays well under 8 KB. */
export const DEFAULT_IN_CHUNK_SIZE = 100;

/**
 * Apache's default `LimitRequestLine`. We warn once we cross 90% of this so
 * ops can raise the limit or lower the chunk size before we start seeing 414s.
 */
export const APACHE_LIMIT_REQUEST_LINE = 8190;

/** Resolve the configured chunk size at call time (respects hot reloads). */
export function getInChunkSize(): number {
  // Runtime override (useful for tests / ops toggles from the browser console)
  try {
    const w: any = typeof window !== "undefined" ? window : undefined;
    const runtime = w?.__IN_CHUNK_SIZE__;
    if (Number.isFinite(runtime) && runtime > 0) return Math.floor(runtime);
  } catch {
    /* ignore */
  }
  // Build-time override via Vite env
  try {
    const raw = (import.meta as any)?.env?.VITE_IN_CHUNK_SIZE;
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  } catch {
    /* ignore */
  }
  return DEFAULT_IN_CHUNK_SIZE;
}

/** Split `ids` into chunks of the configured size. */
export function chunkIds<T>(ids: readonly T[], size = getInChunkSize()): T[][] {
  const chunk = Math.max(1, size);
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += chunk) out.push(ids.slice(i, i + chunk));
  return out;
}

/**
 * Estimate the URL length that a chunk will produce. Used both by the
 * regression test and by runtime metrics.
 */
export function estimateInClauseUrlLength(baseUrl: string, ids: readonly (string | number)[]): number {
  // Percent-encoded comma (%2C) is 3 chars each; ids are joined by "," → encodeURIComponent → "%2C".
  const joined = ids.map(String).join(",");
  return baseUrl.length + encodeURIComponent(joined).length;
}

/**
 * Assert (test-only) that every chunk of `ids` will fit within `limit`.
 * Returns the largest observed URL length so callers can log it.
 */
export function assertChunksFit(
  baseUrl: string,
  ids: readonly (string | number)[],
  size = getInChunkSize(),
  limit = APACHE_LIMIT_REQUEST_LINE,
): number {
  let max = 0;
  for (const c of chunkIds(ids, size)) {
    const len = estimateInClauseUrlLength(baseUrl, c);
    if (len > max) max = len;
    if (len > limit) {
      throw new Error(
        `IN chunk would produce a ${len}-byte URL, exceeding limit ${limit}. Lower VITE_IN_CHUNK_SIZE.`,
      );
    }
  }
  return max;
}

/** Detect the family of "URL/header too large" errors we can fall back from. */
export function isUrlTooLargeError(err: unknown): boolean {
  const status = (err as any)?.status ?? (err as any)?.response?.status;
  if (status === 414 || status === 431) return true;
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("414") ||
    msg.includes("request-uri too large") ||
    msg.includes("uri too long") ||
    msg.includes("request header or cookie too large")
  );
}

/** Lightweight structured logger for chunk metrics. */
export function logChunkMetrics(context: string, meta: {
  totalIds: number;
  chunkSize: number;
  chunkCount: number;
  maxUrlBytes?: number;
}): void {
  // Keep it a single console.info line so it's easy to grep in prod logs.
  const near = meta.maxUrlBytes && meta.maxUrlBytes > APACHE_LIMIT_REQUEST_LINE * 0.9;
  const level = near ? "warn" : "info";
  (console as any)[level](
    `[in-chunk] ${context} ids=${meta.totalIds} size=${meta.chunkSize} chunks=${meta.chunkCount}` +
      (meta.maxUrlBytes ? ` maxUrl=${meta.maxUrlBytes}B` : ""),
  );
}
