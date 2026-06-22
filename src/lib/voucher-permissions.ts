/**
 * Voucher permission spec — mirror of `App\Support\VoucherPermissions` (Laravel).
 *
 * A user is granted <action> on a <voucher_type> if ANY of these match:
 *   - Super Admin
 *   - `<voucher_type>.<action>`   e.g. journal.edit
 *   - `vouchers.<action>`         umbrella module
 *   - `accounts.<action>`         module-wide
 *
 * Keep this file in sync with the PHP file; they MUST evaluate identically,
 * otherwise the UI will show a button the server then 403s.
 */

export const VOUCHER_TYPES = ["journal", "payment", "receipt", "contra"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

export const UMBRELLA_MODULES = ["vouchers", "accounts"] as const;

export type VoucherAction = "view" | "create" | "edit" | "delete";

// Map our "action verbs" to the can_* columns AuthContext.hasPermission reads.
const ACTION_TO_COLUMN: Record<VoucherAction, "can_view" | "can_add" | "can_edit" | "can_delete"> = {
  view: "can_view",
  create: "can_add",
  edit: "can_edit",
  delete: "can_delete",
};

export interface PermissionContext {
  isSuperAdmin: boolean;
  /** Same signature as AuthContext: hasPermission(module, can_*). */
  hasPermission: (module: string, column: "can_view" | "can_add" | "can_edit" | "can_delete") => boolean;
}

export interface PermissionEvaluation {
  allowed: boolean;
  /** Human-readable reason (English) suitable for tooltips/toasts. */
  reason: string;
  /** Ordered list of permission strings the backend will also accept. */
  candidates: string[];
  /** Client-side correlation id so the user can quote it to support; server emits its own on 403. */
  correlationId: string;
}

export function candidatesFor(type: VoucherType, action: VoucherAction): string[] {
  return [`${type}.${action}`, ...UMBRELLA_MODULES.map((m) => `${m}.${action}`)];
}

function cid(): string {
  // RFC4122-ish, no extra deps. Fine for log correlation.
  return "ui-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

export function evaluateVoucherPermission(
  ctx: PermissionContext,
  type: VoucherType,
  action: VoucherAction,
): PermissionEvaluation {
  const correlationId = cid();
  const candidates = candidatesFor(type, action);

  if (ctx.isSuperAdmin) {
    return { allowed: true, reason: "Super Admin", candidates, correlationId };
  }

  const col = ACTION_TO_COLUMN[action];
  const allModules = [type, ...UMBRELLA_MODULES] as string[];
  for (const m of allModules) {
    if (ctx.hasPermission(m, col)) {
      return { allowed: true, reason: `Granted by ${m}.${action}`, candidates, correlationId };
    }
  }

  return {
    allowed: false,
    reason: `Missing permission. You need ANY of: ${candidates.join(", ")}`,
    candidates,
    correlationId,
  };
}

/**
 * Log a denied attempt to the console with the same shape the backend audit_log uses.
 * Call this from onClick handlers / disabled-button tooltips so the user's browser
 * trail matches the server-side row.
 */
export function logVoucherPermissionDenial(params: {
  userId?: string | null;
  voucherType: VoucherType;
  voucherId?: string | null;
  action: VoucherAction;
  evaluation: PermissionEvaluation;
}): void {
  // eslint-disable-next-line no-console
  console.warn("[voucher-permission-denied]", {
    user_id: params.userId ?? null,
    voucher_type: params.voucherType,
    voucher_id: params.voucherId ?? null,
    action: params.action,
    correlation_id: params.evaluation.correlationId,
    required_any_of: params.evaluation.candidates,
    reason: params.evaluation.reason,
    at: new Date().toISOString(),
  });
}
