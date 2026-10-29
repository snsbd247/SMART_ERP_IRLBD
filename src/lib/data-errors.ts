import { toast } from "sonner";

/**
 * Detects RLS/permission errors from the data API and returns a friendly message.
 * Returns null if the error is not permission-related.
 */
export function friendlyRlsMessage(error: any): string | null {
  if (!error) return null;
  const msg = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "");
  if (
    code === "42501" ||
    code === "PGRST301" ||
    msg.includes("permission denied") ||
    msg.includes("rls") ||
    msg.includes("row-level security") ||
    msg.includes("403")
  ) {
    return "Permission denied. Your role may not have access to this data. Visit System Diagnostics (/admin/diagnostics) to verify your access.";
  }
  return null;
}

/** Show a toast for a data API error, with RLS-aware friendly messaging. */
export function handleDataError(error: any, fallbackTitle = "Operation failed") {
  if (!error) return;
  const rls = friendlyRlsMessage(error);
  if (rls) {
    toast.error("Access denied", { description: rls });
  } else {
    toast.error(fallbackTitle, { description: error?.message || String(error) });
  }
}
