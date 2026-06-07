// Import demo configuration data (COA, IFRS, Roles, Numbering, Shortcuts).
// Super-admin only. Idempotent — uses upsert/insertOrIgnore semantics so it
// can be re-run without breaking existing data or other modules.
// Returns per-section results and writes an audit_log entry.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import seed from "./seed.json" with { type: "json" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CoaRow { account_code: string; account_name: string; account_type: string; opening_balance_type: string; parent_code: string | null; }
interface IfrsRow { account_code: string; ifrs_line: string; notes: string | null; }
interface SeqRow { id: string; prefix: string; current_number: number; year: number; description: string; }
interface ShortcutRow { shortcut_code: string; page_name: string; page_url: string; module_name: string; is_active: boolean; }
interface PermRow { module: string; can_view: boolean; can_add: boolean; can_edit: boolean; can_delete: boolean; }
interface RoleRow { name: string; description: string; permissions: PermRow[]; }
interface Seed { coa: CoaRow[]; ifrs: IfrsRow[]; sequences: SeqRow[]; shortcuts: ShortcutRow[]; roles: RoleRow[]; }

interface SectionResult {
  section: string;
  label: string;
  attempted: number;
  inserted: number;
  skipped: number;
  status: "ok" | "partial" | "failed";
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const startedAt = new Date().toISOString();
  let userId: string | null = null;
  let userName: string | null = null;

  try {
    // --- Authorization: must be Super Admin ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: "Unauthorized" }, 401);
    userId = userData.user.id;
    userName = userData.user.email ?? null;

    const { data: isSA } = await admin.rpc("is_super_admin", { _uid: userId });
    if (!isSA) return json({ success: false, error: "Super Admin only" }, 403);

    const s = seed as Seed;
    const results: SectionResult[] = [];

    // ── 1) Chart of Accounts ──
    const coaRes: SectionResult = { section: "chart_of_accounts", label: "Chart of Accounts", attempted: s.coa.length, inserted: 0, skipped: 0, status: "ok" };
    try {
      const { data: before } = await admin.from("chart_of_accounts").select("account_code");
      const existing = new Set((before ?? []).map((r: any) => r.account_code));
      const toInsert = s.coa.filter((r) => !existing.has(r.account_code));
      coaRes.skipped = s.coa.length - toInsert.length;
      if (toInsert.length > 0) {
        const { error } = await admin.from("chart_of_accounts").insert(
          toInsert.map((r) => ({
            account_code: r.account_code, account_name: r.account_name,
            account_type: r.account_type, opening_balance_type: r.opening_balance_type,
          })),
        );
        if (error) throw error;
        coaRes.inserted = toInsert.length;
      }
      // patch parent links
      const { data: coaIds } = await admin.from("chart_of_accounts").select("id, account_code");
      const codeToId = new Map((coaIds ?? []).map((r: any) => [r.account_code, r.id]));
      for (const r of s.coa) {
        if (!r.parent_code) continue;
        const id = codeToId.get(r.account_code);
        const parentId = codeToId.get(r.parent_code);
        if (!id || !parentId) continue;
        await admin.from("chart_of_accounts").update({ parent_id: parentId }).eq("id", id).is("parent_id", null);
      }
    } catch (e) {
      coaRes.status = "failed";
      coaRes.error = e instanceof Error ? e.message : String(e);
    }
    results.push(coaRes);

    // Resolve code->id map for IFRS step
    const { data: coaAfter } = await admin.from("chart_of_accounts").select("id, account_code");
    const codeToId = new Map((coaAfter ?? []).map((r: any) => [r.account_code, r.id]));

    // ── 2) IFRS Account Mapping ──
    const ifrsRes: SectionResult = { section: "ifrs_account_mapping", label: "IFRS Account Mapping", attempted: s.ifrs.length, inserted: 0, skipped: 0, status: "ok" };
    try {
      const { data: existing } = await admin.from("ifrs_account_mapping").select("account_id");
      const have = new Set((existing ?? []).map((r: any) => r.account_id));
      for (const m of s.ifrs) {
        const accId = codeToId.get(m.account_code);
        if (!accId) { ifrsRes.skipped++; continue; }
        if (have.has(accId)) { ifrsRes.skipped++; continue; }
        const { error } = await admin.from("ifrs_account_mapping").insert({
          account_id: accId, ifrs_line: m.ifrs_line, notes: m.notes,
        });
        if (error) { ifrsRes.status = "partial"; ifrsRes.error = error.message; continue; }
        ifrsRes.inserted++;
      }
    } catch (e) {
      ifrsRes.status = "failed";
      ifrsRes.error = e instanceof Error ? e.message : String(e);
    }
    results.push(ifrsRes);

    // ── 3) Roles & Permissions ──
    const rolesRes: SectionResult = { section: "roles_permissions", label: "Roles & Permissions", attempted: s.roles.length, inserted: 0, skipped: 0, status: "ok" };
    let permsInserted = 0;
    try {
      for (const role of s.roles) {
        const { data: existing } = await admin.from("custom_roles").select("id").eq("name", role.name).maybeSingle();
        let roleId = existing?.id;
        if (!roleId) {
          const { data: inserted, error } = await admin.from("custom_roles")
            .insert({ name: role.name, description: role.description }).select("id").single();
          if (error) { rolesRes.status = "partial"; rolesRes.error = error.message; continue; }
          roleId = inserted.id;
          rolesRes.inserted++;
        } else {
          rolesRes.skipped++;
        }
        const permRows = role.permissions.map((p) => ({ custom_role_id: roleId, ...p }));
        const { error: pErr, data: pData } = await admin.from("role_permissions")
          .upsert(permRows, { onConflict: "custom_role_id,module", ignoreDuplicates: true }).select("id");
        if (!pErr) permsInserted += (pData?.length ?? 0);
      }
    } catch (e) {
      rolesRes.status = "failed";
      rolesRes.error = e instanceof Error ? e.message : String(e);
    }
    results.push(rolesRes);
    results.push({ section: "role_permissions", label: "Role Permissions", attempted: s.roles.reduce((n, r) => n + r.permissions.length, 0), inserted: permsInserted, skipped: 0, status: "ok" });

    // ── 4) Document Numbering ──
    const seqRes: SectionResult = { section: "number_sequences", label: "Document Numbering", attempted: s.sequences.length, inserted: 0, skipped: 0, status: "ok" };
    try {
      const { data: existing } = await admin.from("number_sequences").select("id");
      const have = new Set((existing ?? []).map((r: any) => r.id));
      for (const seq of s.sequences) {
        if (have.has(seq.id)) { seqRes.skipped++; continue; }
        const { error } = await admin.from("number_sequences").insert(seq);
        if (error) { seqRes.status = "partial"; seqRes.error = error.message; continue; }
        seqRes.inserted++;
      }
    } catch (e) {
      seqRes.status = "failed";
      seqRes.error = e instanceof Error ? e.message : String(e);
    }
    results.push(seqRes);

    // ── 5) Page Shortcuts ──
    const scRes: SectionResult = { section: "page_shortcuts", label: "Page Shortcuts", attempted: s.shortcuts.length, inserted: 0, skipped: 0, status: "ok" };
    try {
      const { data: existing } = await admin.from("page_shortcuts").select("shortcut_code");
      const have = new Set((existing ?? []).map((r: any) => r.shortcut_code));
      const toInsert = s.shortcuts.filter((r) => !have.has(r.shortcut_code));
      scRes.skipped = s.shortcuts.length - toInsert.length;
      if (toInsert.length > 0) {
        const { error } = await admin.from("page_shortcuts").insert(toInsert);
        if (error) throw error;
        scRes.inserted = toInsert.length;
      }
    } catch (e) {
      scRes.status = "failed";
      scRes.error = e instanceof Error ? e.message : String(e);
    }
    results.push(scRes);

    const totalInserted = results.reduce((n, r) => n + r.inserted, 0);
    const anyFailed = results.some((r) => r.status === "failed");
    const overall = anyFailed ? "partial" : "success";

    // ── Audit log ──
    await admin.from("audit_log").insert({
      user_id: userId,
      user_name: userName,
      module: "backup",
      action: "demo_config_import",
      record_id: null,
      details: `Demo import (${overall}). ${totalInserted} rows inserted across ${results.length} sections.`,
      new_data: { started_at: startedAt, results },
    });

    return new Response(JSON.stringify({
      success: !anyFailed,
      overall,
      total_inserted: totalInserted,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await admin.from("audit_log").insert({
        user_id: userId, user_name: userName, module: "backup",
        action: "demo_config_import", details: "Import failed: " + msg,
      });
    } catch (_) { /* ignore */ }
    return json({ success: false, error: msg }, 500);
  }
});
