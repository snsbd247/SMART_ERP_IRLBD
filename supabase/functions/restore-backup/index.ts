import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TABLES_ORDER = [
  "branches",
  "financial_years",
  "chart_of_accounts",
  "company_settings",
  "departments",
  "designations",
  "shifts",
  "units",
  "item_categories",
  "item_master",
  "warehouses",
  "product_categories",
  "products",
  "raw_materials",
  
  "customers",
  "suppliers",
  "custom_roles",
  "role_permissions",
  "user_roles",
  "user_custom_roles",
  "user_favorite_pages",
  "profiles",
  "employees",
  "employee_bank_info",
  "employee_documents",
  "employee_education",
  "employee_emergency_contacts",
  "employee_experience",
  "employee_fund_settings",
  "fund_transactions",
  "salary_structures",
  "acc_vouchers",
  "voucher_entries",
  "ifrs_account_mapping",
  // Purchase v2
  "purchase_types",
  "purchase_settings",
  "purchase_approval_matrix",
  "purchase_coa_mapping",
  "purchase_requisitions",
  "purchase_requisition_items",
  "purchase_orders_v2",
  "purchase_order_items_v2",
  "po_amendments_v2",
  "po_pr_links",
  "grns_v2",
  "grn_items_v2",
  "supplier_bills_v2",
  "supplier_bill_items_v2",
  "supplier_payments_v2",
  "supplier_payment_allocations",
  "purchase_returns_v2",
  "purchase_return_items_v2",
  "lc_documents",
  "lc_charges",
  "purchase_approval_history",
  "purchase_audit_log",
  // Sales
  "sales_invoices",
  "sales_invoice_items",
  "sales_invoices_v2",
  "sales_invoice_items_v2",
  "delivery_challans",
  "vat_challans",
  "vat_challan_items",
  "invoice_payments",
  "invoice_challans",
  "invoice_status_logs",
  "tds_entries",
  "sales_returns",
  "sales_return_items",
  "customer_receives",
  "party_payments",
  "payment_allocations",
  "party_notes",
  "ho_receives",
  // Stock
  "stock_groups",
  "stock_voucher_types",
  "stock_batches",
  "warehouse_stock",
  "stock_movements",
  "stock_ledger",
  "stock_transfers",
  "stock_adjustments",
  "stock_damage_entries",
  "stock_damage_items",
  "physical_stock_entries",
  "physical_stock_items",
  "consumption_entries",
  "consumption_items",
  "finished_goods_entries",
  // Manufacturing
  "mfg_processes",
  "sections",
  "bill_of_materials",
  "bom_items",
  "bom_expenses",
  "production_entries",
  "production_materials",
  // HRM
  "attendance",
  "leave_types",
  "leave_requests",
  "overtime_records",
  "payroll",
  "biometric_devices",
  "biometric_logs",
  "face_data",
  // System
  "number_sequences",
  "backup_settings",
  "module_settings",
  "system_settings",
  "page_shortcuts",
  "audit_log",
  "login_logs",
  "sms_logs",
  "user_activities",
];

/**
 * Parse MySQL INSERT statements from SQL content.
 * Extracts table name, columns, and values from:
 * INSERT INTO table_name (col1, col2) VALUES ('v1', 'v2') ON DUPLICATE KEY UPDATE ...;
 */
function parseSQLInserts(sql: string): Record<string, Record<string, unknown>[]> {
  const result: Record<string, Record<string, unknown>[]> = {};
  const statements = splitSqlStatements(sql.replace(/^\s*--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));

  for (const stmt of statements) {
    const match = stmt.match(/^\s*(?:INSERT|REPLACE)\s+INTO\s+`?([A-Za-z0-9_]+)`?\s*\((.*?)\)\s*VALUES\s*([\s\S]*?)(?:\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\s+[\s\S]*)?\s*$/i);
    if (!match) continue;

    const table = match[1];
    const columns = match[2].split(",").map(c => c.trim().replace(/^[`"']|[`"']$/g, ""));
    const rows = parseValueRows(match[3]);

    for (const values of rows) {
      if (columns.length !== values.length) continue;
      if (!result[table]) result[table] = [];
      const row: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        row[col] = values[i];
      });
      result[table].push(row);
    }
  }

  return result;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    current += ch;
    if (escaped) { escaped = false; continue; }
    if (quote && ch === "\\") { escaped = true; continue; }
    if (ch === "'" || ch === '"' || ch === "`") {
      if (!quote) quote = ch;
      else if (quote === ch) quote = null;
      continue;
    }
    if (ch === ";" && !quote) {
      statements.push(current.slice(0, -1).trim());
      current = "";
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function parseValueRows(valuesPart: string): unknown[][] {
  const rows: unknown[][] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < valuesPart.length; i++) {
    const ch = valuesPart[i];
    if (escaped) { current += ch; escaped = false; continue; }
    if (quote && ch === "\\") { current += ch; escaped = true; continue; }
    if (ch === "'" || ch === '"') {
      current += ch;
      if (!quote) quote = ch;
      else if (quote === ch) quote = null;
      continue;
    }
    if (!quote && ch === "(") { if (depth++ > 0) current += ch; continue; }
    if (!quote && ch === ")") {
      if (--depth === 0) { rows.push(parseValues(current)); current = ""; continue; }
    }
    if (depth > 0) current += ch;
  }
  return rows;
}

function parseValues(valuesStr: string): unknown[] {
  const values: unknown[] = [];
  let current = "";
  let inString = false;
  let escaped = false;
  
  for (let i = 0; i < valuesStr.length; i++) {
    const ch = valuesStr[i];
    
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    
    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }
    
    if (ch === "'" && !inString) {
      inString = true;
      continue;
    }
    
    if (ch === "'" && inString) {
      // Check for escaped quote ''
      if (i + 1 < valuesStr.length && valuesStr[i + 1] === "'") {
        current += "'";
        i++;
        continue;
      }
      inString = false;
      continue;
    }
    
    if (ch === "," && !inString) {
      values.push(convertValue(current.trim()));
      current = "";
      continue;
    }
    
    current += ch;
  }
  
  if (current.trim()) {
    values.push(convertValue(current.trim()));
  }
  
  return values;
}

function convertValue(val: string): unknown {
  if (val === "NULL") return null;
  if (val === "1" || val === "0") {
    // Could be boolean or number, keep as-is
    return Number(val);
  }
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  // Remove surrounding backslash escapes
  return val.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Super admin check
    const { data: profile } = await adminClient
      .from("profiles")
      .select("employee_id")
      .eq("id", user.id)
      .single();

    if (profile?.employee_id) throw new Error("Super Admin access required for restore");

    const body = await req.json();
    const content = body.content || body.sql_content;
    const file_name = body.file_name;

    if (!content) throw new Error("No backup content provided");

    // Parse SQL INSERT statements into table data
    const restoreData = parseSQLInserts(content);

    let totalRestored = 0;
    const errors: string[] = [];

    // Restore in dependency order
    for (const table of TABLES_ORDER) {
      if (!restoreData[table] || restoreData[table].length === 0) continue;

      try {
        const { error } = await adminClient
          .from(table)
          .upsert(restoreData[table] as any[], { onConflict: "id" } as any);

        if (error) {
          errors.push(`${table}: ${error.message}`);
        } else {
          totalRestored += restoreData[table].length;
        }
      } catch (e) {
        errors.push(`${table}: ${(e as Error).message}`);
      }
    }

    // ===== Post-restore verification =====
    // Row counts on key v2/LC tables + lightweight orphan-FK check
    const verifyTables = [
      "suppliers", "purchase_requisitions", "purchase_orders_v2", "grns_v2",
      "supplier_bills_v2", "supplier_payments_v2", "purchase_returns_v2",
      "lc_documents", "lc_charges",
    ];
    const tableCounts: Record<string, number> = {};
    for (const t of verifyTables) {
      const { count } = await adminClient.from(t).select("*", { count: "exact", head: true });
      tableCounts[t] = count ?? 0;
    }

    // FK orphan checks (child → parent). Sample up to 1000 child rows each.
    const fkChecks: Array<[string, string, string, string]> = [
      ["purchase_order_items_v2", "po_id", "purchase_orders_v2", "id"],
      ["purchase_requisition_items", "requisition_id", "purchase_requisitions", "id"],
      ["grn_items_v2", "grn_id", "grns_v2", "id"],
      ["supplier_bill_items_v2", "bill_id", "supplier_bills_v2", "id"],
      ["supplier_payment_allocations", "payment_id", "supplier_payments_v2", "id"],
      ["purchase_return_items_v2", "return_id", "purchase_returns_v2", "id"],
      ["lc_charges", "lc_id", "lc_documents", "id"],
    ];
    const fkResults: Array<{ child: string; fk: string; parent: string; sampled: number; orphans: number }> = [];
    for (const [child, fk, parent, pk] of fkChecks) {
      const { data: childRows } = await adminClient.from(child).select(`id, ${fk}`).limit(1000);
      const ids = (childRows ?? []).map((r: any) => r[fk]).filter(Boolean);
      let orphans = 0;
      if (ids.length) {
        const { data: parents } = await adminClient.from(parent).select(pk).in(pk, ids);
        const ok = new Set((parents ?? []).map((r: any) => r[pk]));
        orphans = ids.filter((x) => !ok.has(x)).length;
      }
      fkResults.push({ child, fk, parent, sampled: ids.length, orphans });
    }
    const totalOrphans = fkResults.reduce((s, r) => s + r.orphans, 0);
    const verification = {
      table_counts: tableCounts,
      fk_checks: fkResults,
      total_orphans: totalOrphans,
      passed: totalOrphans === 0 && errors.length === 0,
    };

    // Record in backup_history
    await adminClient.from("backup_history").insert({
      file_name: file_name || "restore-upload.sql",
      file_size: new Blob([content]).size,
      backup_type: "restore",
      format: "sql",
      status: errors.length || totalOrphans ? "completed_with_errors" : "completed",
      tables_count: TABLES_ORDER.filter(t => restoreData[t]?.length).length,
      records_count: totalRestored,
      created_by: user.id,
      error_message: errors.length || totalOrphans
        ? [...errors, totalOrphans ? `${totalOrphans} FK orphans` : ""].filter(Boolean).join("; ")
        : null,
    });

    // Audit log
    await adminClient.from("audit_log").insert({
      user_id: user.id,
      user_name: user.email,
      action: "backup_restored",
      module: "backup",
      details: `Restored ${file_name || "upload.sql"}: ${totalRestored} records, ${errors.length} errors, ${totalOrphans} FK orphans`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        records_restored: totalRestored,
        errors: errors.length ? errors : undefined,
        verification,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
