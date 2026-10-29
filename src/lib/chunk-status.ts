/**
 * Lightweight pub/sub for 414/URL-too-large retry events so a global UI
 * indicator can show live status without prop-drilling through every report.
 */

export type ChunkRetryPhase = "retrying" | "success" | "failed";

export interface ChunkRetryEvent {
  context: string;
  phase: ChunkRetryPhase;
  chunkSize: number;
  retryCount: number;
  uriLength?: number;
  message?: string;
  timestamp: number;
}

type Listener = (e: ChunkRetryEvent) => void;
const listeners = new Set<Listener>();

export function subscribeChunkRetry(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitChunkRetry(e: Omit<ChunkRetryEvent, "timestamp">): void {
  const evt = { ...e, timestamp: Date.now() };
  listeners.forEach((l) => {
    try { l(evt); } catch { /* ignore listener errors */ }
  });
  // Also persist to audit log (fire-and-forget) so 414 incidents are traceable.
  void persistChunkAudit(evt);
}

async function persistChunkAudit(e: ChunkRetryEvent): Promise<void> {
  // Only persist noteworthy events (retries + failures). Success is UI-only.
  if (e.phase === "success") return;
  try {
    const { dataClient } = await import("@/integrations/data/client");
    await dataClient.from("audit_log").insert({
      module: "system",
      action: "chunk_retry",
      details: `[${e.context}] ${e.phase} size=${e.chunkSize} retries=${e.retryCount}` +
        (e.uriLength ? ` uri=${e.uriLength}B` : "") + (e.message ? ` msg=${e.message}` : ""),
      new_data: {
        context: e.context,
        phase: e.phase,
        chunk_size: e.chunkSize,
        retry_count: e.retryCount,
        uri_length: e.uriLength ?? null,
      },
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    } as any);
  } catch {
    /* audit-log failure must never break the report */
  }
}
