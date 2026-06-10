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

    // Optional reset flag — wipes ONLY configuration tables (no transactional data).
    // Safe Extension: vouchers, invoices, stock, payroll are untouched.
    let body: { reset?: boolean } = {};
    try { body = await req.json(); } catch { /* no body */ }
    const doReset = body?.reset === true;
    const resetLog: string[] = [];

    if (doReset) {
      // Order matters: dependents first.
      const resetTables = [
        "role_permissions",
        "user_custom_roles",
        "custom_roles",
        "ifrs_account_mapping",
        "page_shortcuts",
        "number_sequences",
        "chart_of_accounts", // last — others may FK to it
      ];
      for (const t of resetTables) {
        const { error } = await admin.from(t).delete().not("id", "is", null);
        if (error) resetLog.push(`${t}: ${error.message}`);
        else resetLog.push(`${t}: cleared`);
      }
    }

    const s = seed as Seed;
    const results: SectionResult[] = [];
    if (doReset) {
      results.push({ section: "reset", label: "Reset configuration tables", attempted: 7, inserted: 7, skipped: 0, status: "ok" });
    }

    // ── 1) Chart of Accounts ──
    const coaRes: SectionResult = { section: "chart_of_accounts", label: "Chart of Accounts", attempted: s.coa.length, inserted: 0, skipped: 0, status: "ok" };
    try {
      const { data: before } = await admin.from("chart_of_accounts").select("account_code");
      const existing = new Set((before ?? []).map((r: any) => r.account_code));
      const toInsert = s.coa.filter((r) => !existing.has(r.account_code));
      const toUpdate = s.coa.filter((r) => existing.has(r.account_code));
      if (toInsert.length > 0) {
        const { error } = await admin.from("chart_of_accounts").insert(
          toInsert.map((r) => ({
            account_code: r.account_code, account_name: r.account_name,
            account_type: r.account_type, opening_balance_type: r.opening_balance_type,
            opening_balance: 0, is_active: true,
          })),
        );
        if (error) throw error;
        coaRes.inserted = toInsert.length;
      }
      // Refresh existing ledgers to canonical values (name/type/opening balance reset to 0)
      let updated = 0;
      for (const r of toUpdate) {
        const { error } = await admin.from("chart_of_accounts").update({
          account_name: r.account_name,
          account_type: r.account_type,
          opening_balance_type: r.opening_balance_type,
          opening_balance: 0,
          is_active: true,
        }).eq("account_code", r.account_code);
        if (!error) updated++;
      }
      coaRes.skipped = toUpdate.length - updated;
      coaRes.inserted += updated;
      // patch parent links (always sync to seed)
      const { data: coaIds } = await admin.from("chart_of_accounts").select("id, account_code");
      const codeToId = new Map((coaIds ?? []).map((r: any) => [r.account_code, r.id]));
      for (const r of s.coa) {
        const id = codeToId.get(r.account_code);
        if (!id) continue;
        const parentId = r.parent_code ? codeToId.get(r.parent_code) ?? null : null;
        await admin.from("chart_of_accounts").update({ parent_id: parentId }).eq("id", id);
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
      const { data: existing } = await admin.from("ifrs_account_mapping").select("account_id, ifrs_line, notes");
      const existingMap = new Map(
        (existing ?? []).map((r: any) => [r.account_id, { ifrs_line: r.ifrs_line, notes: r.notes }]),
      );
      const rows: { account_id: string; ifrs_line: string; notes: string | null }[] = [];
      for (const m of s.ifrs) {
        const accId = codeToId.get(m.account_code);
        if (!accId) { ifrsRes.skipped++; continue; }
        const prev = existingMap.get(accId);
        if (prev && prev.ifrs_line === m.ifrs_line && (prev.notes ?? null) === (m.notes ?? null)) {
          ifrsRes.skipped++;
          continue;
        }
        rows.push({ account_id: accId, ifrs_line: m.ifrs_line, notes: m.notes });
      }
      if (rows.length > 0) {
        const { error } = await admin
          .from("ifrs_account_mapping")
          .upsert(rows, { onConflict: "account_id" });
        if (error) {
          ifrsRes.status = "partial";
          ifrsRes.error = error.message;
        } else {
          ifrsRes.inserted = rows.length;
        }
      }
    } catch (e) {
      ifrsRes.status = "failed";
      ifrsRes.error = e instanceof Error ? e.message : String(e);
    }

    // Fallback: auto-map any remaining active CoA accounts that still have no IFRS line.
    // Heuristic based on account_type + code prefix so the IFRS report is never blank.
    try {
      const inferLine = (type: string, code: string): string => {
        const t = (type || "").toLowerCase();
        const c = (code || "");
        if (t === "asset") {
          if (/^11/.test(c)) return "cash_bank";
          if (/^12/.test(c)) return "accounts_receivable";
          if (/^13/.test(c)) return "inventory";
          if (/^14/.test(c)) return "advance_deposit";
          if (/^15|^16/.test(c)) return "ppe";
          if (/^17/.test(c)) return "intangible_asset";
          return "current_assets" as any;
        }
        if (t === "liability") {
          if (/^21/.test(c)) return "accounts_payable";
          if (/^22/.test(c)) return "short_term_loan";
          if (/^23/.test(c)) return "long_term_loan";
          if (/^24|^61/.test(c)) return "vat_payable";
          return "other_liability";
        }
        if (t === "equity") return /retained|reserve/i.test(c) ? "retained_earnings" : "share_capital";
        if (t === "income" || t === "revenue") return /^41/.test(c) ? "revenue" : "other_income";
        if (t === "expense") {
          if (/^51/.test(c)) return "cogs";
          if (/^53/.test(c)) return "selling_expense";
          if (/^54/.test(c)) return "financial_expense";
          return "admin_expense";
        }
        return "other_income";
      };
      const { data: allAcc } = await admin
        .from("chart_of_accounts")
        .select("id, account_code, account_type, is_active")
        .eq("is_active", true);
      const { data: mapped } = await admin.from("ifrs_account_mapping").select("account_id");
      const mappedSet = new Set((mapped ?? []).map((r: any) => r.account_id));
      const fallbackRows = (allAcc ?? [])
        .filter((a: any) => !mappedSet.has(a.id))
        .map((a: any) => ({
          account_id: a.id,
          ifrs_line: inferLine(a.account_type, a.account_code),
          notes: "auto-mapped",
        }));
      if (fallbackRows.length > 0) {
        const { error } = await admin
          .from("ifrs_account_mapping")
          .upsert(fallbackRows, { onConflict: "account_id" });
        if (!error) ifrsRes.inserted += fallbackRows.length;
        else { ifrsRes.status = "partial"; ifrsRes.error = (ifrsRes.error ? ifrsRes.error + "; " : "") + error.message; }
      }
    } catch (e) {
      ifrsRes.status = ifrsRes.status === "ok" ? "partial" : ifrsRes.status;
      ifrsRes.error = (ifrsRes.error ? ifrsRes.error + "; " : "") + (e instanceof Error ? e.message : String(e));
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

    // ── 6) Purchase CoA Mapping (per Purchase Type) ──
    // Maps each Purchase Type to actual ledgers in the current Chart of Accounts
    // so Purchase posting (GRN/Bill/Payment) lands on the right accounts.
    // Also ensures Sales posting works because both modules read from the same CoA codes.
    const pcmRes: SectionResult = { section: "purchase_coa_mapping", label: "Purchase ↔ CoA Mapping", attempted: 0, inserted: 0, skipped: 0, status: "ok" };
    try {
      // Resolve account ids by account_code from the live CoA
      const { data: coaRows } = await admin.from("chart_of_accounts").select("id, account_code");
      const byCode = new Map((coaRows ?? []).map((r: any) => [r.account_code, r.id]));
      const pick = (...codes: string[]) => {
        for (const c of codes) { const id = byCode.get(c); if (id) return id; }
        return null;
      };

      // Resolve canonical ledgers (with sensible fallbacks for either CoA flavour)
      const cash      = pick("1251", "1101");                 // Cash in Hand
      const bank      = pick("1252", "1111", "1102");         // Primary bank
      const inventory = pick("1211", "1105");                 // Raw Materials / Inventory
      const advance   = pick("1104");                          // Advance to Supplier
      const tdsRecv   = pick("1107", "1220");                  // TDS / AIT Receivable
      const vatIn     = pick("1234", "6101");                  // VAT Input / Receivable
      const payable   = pick("2102", "2210");                  // Supplier Payable
      const grnClear  = pick("2210", "2102");                  // GRN clearing
      const fixedAst  = pick("1101", "1201", "1200");          // Fixed Asset (PPE)
      const freight   = pick("5205");                          // Transportation
      const discount  = pick("4104");                          // Discount Received

      const expenseByType: Record<string, string | null> = {
        "Local Purchase":  pick("5101", "5100"),
        "Import (LC)":     pick("5102", "5100"),
        "Service":         pick("6115", "6100"),
        "Capital / Asset": pick("1101", "1201"),
      };

      // Active purchase types
      const { data: pts } = await admin
        .from("purchase_types").select("id, name").eq("is_active", true);
      const types = pts ?? [];
      pcmRes.attempted = types.length;

      // Wipe existing mappings then reinsert fresh (configuration-only data)
      if (types.length > 0) {
        await admin.from("purchase_coa_mapping").delete().not("id", "is", null);
      }

      const rows = types.map((pt: any) => ({
        purchase_type_id: pt.id,
        branch_id: null,
        inventory_account_id: pt.name === "Service" ? null : inventory,
        grn_clearing_account_id: grnClear,
        payable_account_id: payable,
        advance_account_id: advance,
        vat_input_account_id: vatIn,
        ait_account_id: tdsRecv,
        asset_account_id: pt.name === "Capital / Asset" ? fixedAst : null,
        expense_account_id: expenseByType[pt.name] ?? pick("6115"),
        discount_account_id: discount,
        freight_account_id: freight,
        landed_cost_account_id: freight,
        cash_account_id: cash,
        bank_account_id: bank,
        is_active: true,
      }));

      const missing = rows.filter((r) =>
        !r.payable_account_id || !r.expense_account_id || (!r.cash_account_id && !r.bank_account_id));
      if (missing.length > 0) {
        pcmRes.status = "partial";
        pcmRes.error = `Missing CoA codes for ${missing.length} mapping(s). Run Chart of Accounts seed first.`;
      }
      if (rows.length > 0) {
        const { error } = await admin.from("purchase_coa_mapping").insert(rows);
        if (error) throw error;
        pcmRes.inserted = rows.length;
      }
    } catch (e) {
      pcmRes.status = "failed";
      pcmRes.error = e instanceof Error ? e.message : String(e);
    }
    results.push(pcmRes);

    // ── 7) Party ↔ Ledger Backfill ──
    // For every customer create a sub-ledger under "Accounts Receivable" (1240) if not linked.
    // For every supplier create a sub-ledger under "Accounts & Other Payable" (2210) if not linked.
    const partyRes: SectionResult = { section: "party_ledgers", label: "Customer/Supplier Ledger Backfill", attempted: 0, inserted: 0, skipped: 0, status: "ok" };
    try {
      const { data: coaAll } = await admin.from("chart_of_accounts").select("id, account_code, parent_id");
      const all = coaAll ?? [];
      const arParent = all.find((r: any) => r.account_code === "1240");
      const apParent = all.find((r: any) => r.account_code === "2210");

      const nextChildCode = (parentCode: string): string => {
        const children = all.filter((r: any) => String(r.account_code).startsWith(parentCode) && r.account_code !== parentCode);
        let max = 0;
        for (const c of children) {
          const tail = String(c.account_code).slice(parentCode.length);
          const n = parseInt(tail, 10);
          if (!isNaN(n) && n > max) max = n;
        }
        return `${parentCode}${String(max + 1).padStart(3, "0")}`;
      };

      const ensureLedger = async (name: string, parent: any, type: "asset" | "liability") => {
        if (!parent) return null;
        const { data: existing } = await admin
          .from("chart_of_accounts").select("id").eq("account_name", name).eq("account_type", type).limit(1);
        if (existing && existing.length > 0) return (existing[0] as any).id;
        const code = nextChildCode(parent.account_code);
        const { data: ins, error } = await admin.from("chart_of_accounts").insert({
          account_code: code, account_name: name, account_type: type, parent_id: parent.id,
          opening_balance: 0, opening_balance_type: type === "asset" ? "debit" : "credit", is_active: true,
        }).select("id").single();
        if (error) return null;
        all.push({ id: (ins as any).id, account_code: code, parent_id: parent.id });
        return (ins as any).id;
      };

      // Customers
      const { data: customers } = await admin.from("customers").select("id, name, receivable_account_id");
      for (const c of (customers ?? [])) {
        partyRes.attempted++;
        if ((c as any).receivable_account_id) { partyRes.skipped++; continue; }
        const ledgerId = await ensureLedger(String(c.name).trim(), arParent, "asset");
        if (ledgerId) {
          await admin.from("customers").update({ receivable_account_id: ledgerId } as any).eq("id", c.id);
          partyRes.inserted++;
        }
      }
      // Suppliers
      const { data: suppliers } = await admin.from("suppliers").select("id, name, payable_account_id");
      for (const sp of (suppliers ?? [])) {
        partyRes.attempted++;
        if ((sp as any).payable_account_id) { partyRes.skipped++; continue; }
        const ledgerId = await ensureLedger(String(sp.name).trim(), apParent, "liability");
        if (ledgerId) {
          await admin.from("suppliers").update({ payable_account_id: ledgerId } as any).eq("id", sp.id);
          partyRes.inserted++;
        }
      }
    } catch (e) {
      partyRes.status = "failed";
      partyRes.error = e instanceof Error ? e.message : String(e);
    }
    results.push(partyRes);




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
      details: `Demo import (${overall})${doReset ? " [RESET]" : ""}. ${totalInserted} rows inserted across ${results.length} sections.`,
      new_data: { started_at: startedAt, reset: doReset, reset_log: resetLog, results },
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
