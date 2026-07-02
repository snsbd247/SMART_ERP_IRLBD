import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { subscribeChunkRetry, type ChunkRetryEvent } from "@/lib/chunk-status";

/**
 * Fixed-position pill that appears when a report request is retried due to a
 * 414 "URL too large" fallback. Auto-hides on the final success/failure event.
 */
export function ChunkRetryIndicator() {
  const [evt, setEvt] = useState<ChunkRetryEvent | null>(null);

  useEffect(() => {
    return subscribeChunkRetry((e) => {
      setEvt(e);
      if (e.phase !== "retrying") {
        const id = setTimeout(() => setEvt((cur) => (cur?.timestamp === e.timestamp ? null : cur)), 4000);
        return () => clearTimeout(id);
      }
    });
  }, []);

  if (!evt) return null;

  const color =
    evt.phase === "retrying"
      ? "bg-amber-500/95 text-white"
      : evt.phase === "success"
        ? "bg-emerald-600/95 text-white"
        : "bg-destructive/95 text-destructive-foreground";
  const Icon =
    evt.phase === "retrying" ? Loader2 : evt.phase === "success" ? CheckCircle2 : AlertTriangle;

  const label =
    evt.phase === "retrying"
      ? `Server URL limit hit — retrying with smaller batches (size ${evt.chunkSize}, attempt ${evt.retryCount})…`
      : evt.phase === "success"
        ? `Report loaded via fallback batches (size ${evt.chunkSize}).`
        : `Report failed after ${evt.retryCount} retries. ${evt.message ?? ""}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full px-4 py-2 text-xs shadow-lg ${color}`}
    >
      <Icon className={`h-4 w-4 ${evt.phase === "retrying" ? "animate-spin" : ""}`} />
      <span className="max-w-[400px] truncate">{label}</span>
    </div>
  );
}
