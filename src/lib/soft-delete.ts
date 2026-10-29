import { dataClient } from "@/integrations/data/client";

type SoftDeletableTable = "sales_invoices_v2" | "party_payments";

interface Ctx {
  userId: string;
  userName: string;
}

async function audit(module: string, action: string, recordId: string, details: string, ctx: Ctx) {
  await dataClient.from("audit_log").insert({
    user_id: ctx.userId,
    user_name: ctx.userName,
    module,
    action,
    record_id: recordId,
    details,
  });
}

/** Soft-delete a record by setting deleted_at/deleted_by (+ prev_status when present). */
export async function softDelete(
  table: SoftDeletableTable,
  id: string,
  ctx: Ctx,
  opts: { prevStatus?: string | null; module?: string; reason?: string } = {}
) {
  const patch: Record<string, any> = {
    deleted_at: new Date().toISOString(),
    deleted_by: ctx.userId,
  };
  if (table !== "party_payments") {
    patch.prev_status = opts.prevStatus ?? null;
    patch.status = "deleted";
  }
  const { error } = await dataClient.from(table).update(patch as any).eq("id", id);
  if (error) throw error;
  await audit(
    opts.module || table,
    `${table}_soft_deleted`,
    id,
    opts.reason ? `Soft-deleted. Reason: ${opts.reason}` : "Soft-deleted",
    ctx
  );
}

/** Restore a soft-deleted record. */
export async function softRestore(table: SoftDeletableTable, id: string, ctx: Ctx, opts: { module?: string } = {}) {
  // Read prev_status when applicable
  let restoreStatus: string | null = null;
  if (table !== "party_payments") {
    const { data } = await dataClient.from(table).select("prev_status").eq("id", id).single();
    restoreStatus = (data as any)?.prev_status || "draft";
  }
  const patch: Record<string, any> = {
    deleted_at: null,
    deleted_by: null,
  };
  if (table !== "party_payments") {
    patch.status = restoreStatus;
    patch.prev_status = null;
  }
  const { error } = await dataClient.from(table).update(patch as any).eq("id", id);
  if (error) throw error;
  await audit(opts.module || table, `${table}_restored`, id, "Restored", ctx);
}
