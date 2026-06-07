// Import demo configuration data (COA, IFRS, Roles, Numbering, Shortcuts).
// Super-admin only. Idempotent — uses upsert/insertOrIgnore semantics so it
// can be re-run without breaking existing data or other modules.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import seed from "./seed.json" with { type: "json" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CoaRow {
  account_code: string;
  account_name: string;
  account_type: string;
  opening_balance_type: string;
  parent_code: string | null;
}
interface IfrsRow { account_code: string; ifrs_line: string; notes: string | null; }
interface SeqRow { id: string; prefix: string; current_number: number; year: number; description: string; }
interface ShortcutRow { shortcut_code: string; page_name: string; page_url: string; module_name: string; is_active: boolean; }
interface PermRow { module: string; can_view: boolean; can_add: boolean; can_edit: boolean; can_delete: boolean; }
interface RoleRow { name: string; description: string; permissions: PermRow[]; }
interface Seed { coa: CoaRow[]; ifrs: IfrsRow[]; sequences: SeqRow[]; shortcuts: ShortcutRow[]; roles: RoleRow[]; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate caller is super_admin using their JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isSA } = await admin.rpc("is_super_admin", { _uid: userData.user.id });
    if (!isSA) return json({ success: false, error: "Super Admin only" }, 403);

    const s = seed as Seed;
    const stats: Record<string, number> = {};

    // 1) Chart of accounts — two-pass: insert without parent first, then update parent links.
    const coaRows = s.coa.map((r) => ({
      account_code: r.account_code,
      account_name: r.account_name,
      account_type: r.account_type,
      opening_balance_type: r.opening_balance_type,
    }));
    const { error: coaErr } = await admin
      .from("chart_of_accounts")
      .upsert(coaRows, { onConflict: "account_code", ignoreDuplicates: true });
    if (coaErr) throw new Error("COA insert: " + coaErr.message);

    // Resolve codes -> ids and patch parent links.
    const { data: coaIds } = await admin
      .from("chart_of_accounts")
      .select("id, account_code");
    const codeToId = new Map((coaIds ?? []).map((r: any) => [r.account_code, r.id]));
    for (const r of s.coa) {
      if (!r.parent_code) continue;
      const id = codeToId.get(r.account_code);
      const parentId = codeToId.get(r.parent_code);
      if (!id || !parentId) continue;
      await admin.from("chart_of_accounts").update({ parent_id: parentId }).eq("id", id).is("parent_id", null);
    }
    stats.chart_of_accounts = s.coa.length;

    // 2) IFRS Account Mapping
    let ifrsCount = 0;
    for (const m of s.ifrs) {
      const accId = codeToId.get(m.account_code);
      if (!accId) continue;
      const { error } = await admin
        .from("ifrs_account_mapping")
        .upsert({ account_id: accId, ifrs_line: m.ifrs_line, notes: m.notes }, { onConflict: "account_id" });
      if (!error) ifrsCount++;
    }
    stats.ifrs_account_mapping = ifrsCount;

    // 3) Roles & Permissions
    let rolesCount = 0, permsCount = 0;
    for (const role of s.roles) {
      const { data: existing } = await admin
        .from("custom_roles").select("id").eq("name", role.name).maybeSingle();
      let roleId = existing?.id;
      if (!roleId) {
        const { data: inserted, error } = await admin
          .from("custom_roles")
          .insert({ name: role.name, description: role.description })
          .select("id").single();
        if (error) continue;
        roleId = inserted.id;
      }
      rolesCount++;
      const permRows = role.permissions.map((p) => ({ custom_role_id: roleId, ...p }));
      const { error: pErr } = await admin
        .from("role_permissions")
        .upsert(permRows, { onConflict: "custom_role_id,module" });
      if (!pErr) permsCount += permRows.length;
    }
    stats.custom_roles = rolesCount;
    stats.role_permissions = permsCount;

    // 4) Document Numbering — PK is id, safe to upsert without overwriting current_number.
    let seqCount = 0;
    for (const seq of s.sequences) {
      const { data: existing } = await admin
        .from("number_sequences").select("id").eq("id", seq.id).maybeSingle();
      if (existing) continue; // never reset an existing counter
      const { error } = await admin.from("number_sequences").insert(seq);
      if (!error) seqCount++;
    }
    stats.number_sequences = seqCount;

    // 5) Page Shortcuts
    const { error: scErr } = await admin
      .from("page_shortcuts")
      .upsert(s.shortcuts, { onConflict: "shortcut_code", ignoreDuplicates: true });
    if (scErr) throw new Error("Shortcuts insert: " + scErr.message);
    stats.page_shortcuts = s.shortcuts.length;

    return json({ success: true, message: "Demo configuration imported", stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ success: false, error: msg }, 500);
  }
});
