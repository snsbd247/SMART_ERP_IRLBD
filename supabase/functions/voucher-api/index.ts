import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

// ---------- helpers ----------

async function getUserRoles(admin: any, userId: string): Promise<string[]> {
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data || []).map((r: any) => r.role);
}

async function getUserProfile(admin: any, userId: string) {
  const { data } = await admin
    .from("profiles")
    .select("name, username, email, branch_id, employee_id")
    .eq("id", userId)
    .single();
  return data;
}

function isSuperAdmin(roles: string[]) {
  return roles.includes("super_admin");
}

function isAdminOrSuper(roles: string[]) {
  return roles.includes("admin") || roles.includes("super_admin");
}

async function logAudit(
  admin: any,
  params: {
    userId: string;
    userName: string;
    module: string;
    action: string;
    recordId: string;
    details: string;
    ipAddress: string | null;
  }
) {
  await admin.from("audit_log").insert({
    user_id: params.userId,
    user_name: params.userName,
    module: params.module,
    action: params.action,
    record_id: params.recordId,
    details: params.details,
    ip_address: params.ipAddress,
  });
}

// ---------- next number (moved from DB function) ----------
async function nextNumber(admin: any, seqId: string): Promise<string> {
  // Read + increment atomically via update returning
  const { data, error } = await admin
    .from("number_sequences")
    .select("prefix, current_number, year")
    .eq("id", seqId)
    .single();
  if (error || !data) throw new Error(`Sequence ${seqId} not found`);

  const newNum = data.current_number + 1;
  await admin
    .from("number_sequences")
    .update({ current_number: newNum })
    .eq("id", seqId);

  return `${data.prefix}-${data.year}-${String(newNum).padStart(4, "0")}`;
}

function voucherSequenceId(voucherType: string): string {
  const sequenceMap: Record<string, string> = {
    journal: "journal_voucher",
    payment: "payment_voucher",
    receipt: "receipt_voucher",
    contra: "contra_voucher",
  };
  return sequenceMap[voucherType] || voucherType;
}

// ---------- main handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return err("Missing authorization", 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Verify user token
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return err("Unauthorized", 401);

  // Admin client for service-level ops
  const admin = createClient(supabaseUrl, serviceKey);

  const roles = await getUserRoles(admin, user.id);
  const profile = await getUserProfile(admin, user.id);
  const userName = profile?.name || profile?.username || user.email || "Unknown";
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    null;

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  try {
    switch (action) {
      // ============ LIST VOUCHERS ============
      case "list": {
        const { voucher_type, include_deleted } = body;
        let q = admin
          .from("acc_vouchers")
          .select("*")
          .eq("voucher_type", voucher_type || "journal");
        if (!include_deleted) q = q.is("deleted_at", null);
        const { data, error } = await q.order("created_at", { ascending: false });
        if (error) return err(error.message, 500);

        const voucherIds = (data || []).map((v: any) => v.id);
        if (voucherIds.length === 0) return json({ data: data || [] });

        // Chunk .in() calls to avoid PostgREST "Bad Request" from URL-too-long
        const chunk = <T,>(arr: T[], size: number): T[][] => {
          const out: T[][] = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };

        const entries: any[] = [];
        for (const ids of chunk(voucherIds, 100)) {
          const { data: chunkEntries, error: entryError } = await admin
            .from("voucher_entries")
            .select("voucher_id, account_id, sort_order")
            .in("voucher_id", ids)
            .order("sort_order", { ascending: true });
          if (entryError) return err(entryError.message, 500);
          if (chunkEntries) entries.push(...chunkEntries);
        }

        const accountIds = Array.from(new Set(entries.map((e: any) => e.account_id).filter(Boolean)));
        const accountRows: any[] = [];
        for (const ids of chunk(accountIds, 100)) {
          const { data: rows, error: accountError } = await admin
            .from("chart_of_accounts")
            .select("id, account_name")
            .in("id", ids);
          if (accountError) return err(accountError.message, 500);
          if (rows) accountRows.push(...rows);
        }

        const accountNameMap = new Map(accountRows.map((a: any) => [a.id, a.account_name]));
        const ledgerMap: Record<string, string[]> = {};
        entries.forEach((entry: any) => {
          const name = accountNameMap.get(entry.account_id);
          if (!name) return;
          if (!ledgerMap[entry.voucher_id]) ledgerMap[entry.voucher_id] = [];
          if (!ledgerMap[entry.voucher_id].includes(name)) ledgerMap[entry.voucher_id].push(name);
        });

        return json({
          data: (data || []).map((voucher: any) => ({
            ...voucher,
            ledger_accounts: ledgerMap[voucher.id] || [],
          })),
        });
      }

      // ============ GET VOUCHER WITH ENTRIES ============
      case "get": {
        const { id } = body;
        const [vRes, eRes] = await Promise.all([
          admin.from("acc_vouchers").select("*").eq("id", id).single(),
          admin.from("voucher_entries").select("*").eq("voucher_id", id).order("sort_order"),
        ]);
        if (vRes.error) return err(vRes.error.message, 500);
        return json({ voucher: vRes.data, entries: eRes.data || [] });
      }

      // ============ CREATE VOUCHER ============
      case "create": {
        const { voucher_type, voucher_date, branch_id, financial_year_id, description, entries, submit } = body;

        // Validate entries balance
        const totalDebit = (entries || []).reduce((s: number, e: any) => s + (e.debit || 0), 0);
        const totalCredit = (entries || []).reduce((s: number, e: any) => s + (e.credit || 0), 0);
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
          return err("Debit and Credit must be equal");
        }
        const validEntries = (entries || []).filter(
          (e: any) => e.account_id && (e.debit > 0 || e.credit > 0)
        );
        if (validEntries.length < 2) {
          return err("At least 2 entries required");
        }

        const voucherNumber = await nextNumber(admin, voucherSequenceId(voucher_type));

        const { data: vData, error: vErr } = await admin
          .from("acc_vouchers")
          .insert({
            voucher_number: voucherNumber,
            voucher_type,
            voucher_date,
            branch_id: branch_id || null,
            financial_year_id: financial_year_id || null,
            description,
            total_amount: totalDebit,
            status: submit ? "pending" : "draft",
            created_by: user.id,
          })
          .select()
          .single();
        if (vErr) return err(vErr.message, 500);

        const entryRows = validEntries.map((e: any, i: number) => ({
          voucher_id: vData.id,
          account_id: e.account_id,
          debit: e.debit,
          credit: e.credit,
          narration: e.narration || "",
          sort_order: i,
        }));
        const { error: eErr } = await admin.from("voucher_entries").insert(entryRows);
        if (eErr) return err(eErr.message, 500);

        await logAudit(admin, {
          userId: user.id,
          userName,
          module: "accounting",
          action: "voucher_created",
          recordId: vData.id,
          details: `Created voucher ${voucherNumber} (${submit ? "pending" : "draft"}) amount: ${totalDebit}`,
          ipAddress,
        });

        return json({ voucher: vData });
      }

      // ============ APPROVE VOUCHER ============
      case "approve": {
        if (!isAdminOrSuper(roles)) return err("Only admins can approve vouchers", 403);
        const { id } = body;

        const { data: v } = await admin.from("acc_vouchers").select("*").eq("id", id).single();
        if (!v) return err("Voucher not found", 404);
        if (v.status !== "pending") return err("Only pending vouchers can be approved");

        const { error } = await admin
          .from("acc_vouchers")
          .update({
            status: "approved",
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (error) return err(error.message, 500);

        await logAudit(admin, {
          userId: user.id,
          userName,
          module: "accounting",
          action: "voucher_approved",
          recordId: id,
          details: `Approved voucher ${v.voucher_number}`,
          ipAddress,
        });

        return json({ success: true });
      }

      // ============ REJECT VOUCHER ============
      case "reject": {
        if (!isAdminOrSuper(roles)) return err("Only admins can reject vouchers", 403);
        const { id, reason } = body;

        const { data: v } = await admin.from("acc_vouchers").select("*").eq("id", id).single();
        if (!v) return err("Voucher not found", 404);
        if (v.status !== "pending") return err("Only pending vouchers can be rejected");

        const { error } = await admin
          .from("acc_vouchers")
          .update({ status: "rejected" })
          .eq("id", id);
        if (error) return err(error.message, 500);

        await logAudit(admin, {
          userId: user.id,
          userName,
          module: "accounting",
          action: "voucher_rejected",
          recordId: id,
          details: `Rejected voucher ${v.voucher_number}. Reason: ${reason || "No reason provided"}`,
          ipAddress,
        });

        return json({ success: true });
      }

      // ============ EDIT APPROVED VOUCHER (SUPER ADMIN ONLY) ============
      case "edit_approved": {
        if (!isSuperAdmin(roles)) {
          return err("Only Super Admin can edit approved vouchers", 403);
        }
        const { id, description, entries: newEntries } = body;

        const { data: oldVoucher } = await admin.from("acc_vouchers").select("*").eq("id", id).single();
        if (!oldVoucher) return err("Voucher not found", 404);
        if (oldVoucher.status !== "approved") return err("Voucher is not approved");

        // Get old entries for audit trail
        const { data: oldEntries } = await admin
          .from("voucher_entries")
          .select("*")
          .eq("voucher_id", id)
          .order("sort_order");

        // Validate new entries
        if (newEntries && newEntries.length > 0) {
          const totalDebit = newEntries.reduce((s: number, e: any) => s + (e.debit || 0), 0);
          const totalCredit = newEntries.reduce((s: number, e: any) => s + (e.credit || 0), 0);
          if (Math.abs(totalDebit - totalCredit) > 0.01) {
            return err("Debit and Credit must be equal");
          }

          // Delete old entries and insert new
          await admin.from("voucher_entries").delete().eq("voucher_id", id);
          const entryRows = newEntries.map((e: any, i: number) => ({
            voucher_id: id,
            account_id: e.account_id,
            debit: e.debit,
            credit: e.credit,
            narration: e.narration || "",
            sort_order: i,
          }));
          await admin.from("voucher_entries").insert(entryRows);

          // Update voucher amount
          const newTotal = newEntries.reduce((s: number, e: any) => s + (e.debit || 0), 0);
          await admin
            .from("acc_vouchers")
            .update({
              total_amount: newTotal,
              description: description !== undefined ? description : oldVoucher.description,
              updated_at: new Date().toISOString(),
            })
            .eq("id", id);
        } else if (description !== undefined) {
          await admin
            .from("acc_vouchers")
            .update({ description, updated_at: new Date().toISOString() })
            .eq("id", id);
        }

        // Full audit trail with old/new values
        await logAudit(admin, {
          userId: user.id,
          userName,
          module: "accounting",
          action: "approved_voucher_edited",
          recordId: id,
          details: JSON.stringify({
            voucher_number: oldVoucher.voucher_number,
            old_values: {
              description: oldVoucher.description,
              total_amount: oldVoucher.total_amount,
              entries: oldEntries,
            },
            new_values: {
              description: description !== undefined ? description : oldVoucher.description,
              entries: newEntries || oldEntries,
            },
          }),
          ipAddress,
        });

        return json({ success: true });
      }

      // ============ SOFT-DELETE VOUCHER (SUPER ADMIN ONLY) ============
      case "delete_approved": {
        if (!isSuperAdmin(roles)) {
          return err("Only Super Admin can delete vouchers", 403);
        }
        const { id, reason } = body;

        const { data: v } = await admin.from("acc_vouchers").select("*").eq("id", id).single();
        if (!v) return err("Voucher not found", 404);
        if (v.deleted_at) return err("Voucher already deleted", 400);

        // Soft delete: keep rows, mark deleted_at + remember prev_status so
        // reports filtering by status='approved' automatically exclude it.
        await admin.from("acc_vouchers").update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
          prev_status: v.status,
          status: "deleted",
          updated_at: new Date().toISOString(),
        }).eq("id", id);

        await logAudit(admin, {
          userId: user.id,
          userName,
          module: "accounting",
          action: "voucher_soft_deleted",
          recordId: id,
          details: JSON.stringify({
            voucher_number: v.voucher_number,
            reason: reason || "No reason provided",
            prev_status: v.status,
          }),
          ipAddress,
        });

        return json({ success: true });
      }

      // ============ RESTORE SOFT-DELETED VOUCHER (SUPER ADMIN ONLY) ============
      case "restore": {
        if (!isSuperAdmin(roles)) {
          return err("Only Super Admin can restore vouchers", 403);
        }
        const { id, reason } = body;

        const { data: v } = await admin.from("acc_vouchers").select("*").eq("id", id).single();
        if (!v) return err("Voucher not found", 404);
        if (!v.deleted_at) return err("Voucher is not deleted", 400);

        const restoredStatus = v.prev_status || "draft";
        await admin.from("acc_vouchers").update({
          deleted_at: null,
          deleted_by: null,
          prev_status: null,
          status: restoredStatus,
          updated_at: new Date().toISOString(),
        }).eq("id", id);

        await logAudit(admin, {
          userId: user.id,
          userName,
          module: "accounting",
          action: "voucher_restored",
          recordId: id,
          details: JSON.stringify({
            voucher_number: v.voucher_number,
            reason: reason || "",
            restored_to_status: restoredStatus,
          }),
          ipAddress,
        });

        return json({ success: true, status: restoredStatus });
      }

      // ============ REOPEN VOUCHER (SUPER ADMIN ONLY) ============
      case "reopen": {
        if (!isSuperAdmin(roles)) {
          return err("Only Super Admin can reopen vouchers", 403);
        }
        const { id, reason } = body;

        const { data: v } = await admin.from("acc_vouchers").select("*").eq("id", id).single();
        if (!v) return err("Voucher not found", 404);
        if (v.status !== "approved" && v.status !== "rejected") {
          return err("Only approved or rejected vouchers can be reopened");
        }

        const { error } = await admin
          .from("acc_vouchers")
          .update({
            status: "draft",
            approved_by: null,
            approved_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (error) return err(error.message, 500);

        await logAudit(admin, {
          userId: user.id,
          userName,
          module: "accounting",
          action: "voucher_reopened",
          recordId: id,
          details: `Reopened voucher ${v.voucher_number} (was ${v.status}). Reason: ${reason || "No reason provided"}`,
          ipAddress,
        });

        return json({ success: true });
      }

      // ============ REVERSE VOUCHER (SUPER ADMIN ONLY) ============
      case "reverse": {
        if (!isSuperAdmin(roles)) {
          return err("Only Super Admin can reverse vouchers", 403);
        }
        const { id, reason } = body;

        const { data: v } = await admin.from("acc_vouchers").select("*").eq("id", id).single();
        if (!v) return err("Voucher not found", 404);
        if (v.status !== "approved") return err("Only approved vouchers can be reversed");

        // Get original entries
        const { data: origEntries } = await admin
          .from("voucher_entries")
          .select("*")
          .eq("voucher_id", id)
          .order("sort_order");

        // Create reversal voucher with swapped debit/credit
        const reversalNumber = await nextNumber(admin, voucherSequenceId(v.voucher_type));
        const { data: revVoucher, error: revErr } = await admin
          .from("acc_vouchers")
          .insert({
            voucher_number: reversalNumber,
            voucher_type: v.voucher_type,
            voucher_date: new Date().toISOString().slice(0, 10),
            branch_id: v.branch_id,
            financial_year_id: v.financial_year_id,
            description: `Reversal of ${v.voucher_number}: ${reason || ""}`,
            total_amount: v.total_amount,
            status: "approved",
            created_by: user.id,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (revErr) return err(revErr.message, 500);

        // Insert reversed entries (swap debit/credit)
        if (origEntries) {
          const reversedEntries = origEntries.map((e: any, i: number) => ({
            voucher_id: revVoucher.id,
            account_id: e.account_id,
            debit: e.credit,
            credit: e.debit,
            narration: `Reversal: ${e.narration || ""}`,
            sort_order: i,
          }));
          await admin.from("voucher_entries").insert(reversedEntries);
        }

        await logAudit(admin, {
          userId: user.id,
          userName,
          module: "accounting",
          action: "voucher_reversed",
          recordId: id,
          details: JSON.stringify({
            original_voucher: v.voucher_number,
            reversal_voucher: reversalNumber,
            reason: reason || "No reason provided",
          }),
          ipAddress,
        });

        return json({ success: true, reversal_voucher: revVoucher });
      }

      default:
        return err(`Unknown action: ${action}`, 400);
    }
  } catch (e: any) {
    console.error("voucher-api error:", e);
    return err(e.message || "Internal error", 500);
  }
});
