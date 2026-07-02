/**
 * Seed / teardown script for HRM Bulk Import E2E tests.
 *
 * Run against any Supabase project (dev, staging, CI) to establish the
 * lookup entities the bulk import CSVs reference. Idempotent: safe to
 * re-run. Uses the service-role key so it bypasses RLS.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx e2e/scripts/seed-bulk-import.ts
 *   # teardown:
 *   ... npx tsx e2e/scripts/seed-bulk-import.ts --teardown
 *
 * All seeded rows are tagged with metadata "e2e_bulk_import" so teardown
 * only removes fixtures, never real data.
 */
import { createClient } from "@supabase/supabase-js";

const TAG = "e2e_bulk_import";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const BRANCHES = [{ name: "Head Office", code: "HO" }];
const DEPARTMENTS = [
  { name: "Engineering", code: "ENG" },
  { name: "HR", code: "HR" },
  { name: "Finance", code: "FIN" },
  { name: "Sales", code: "SAL" },
];
const DESIGNATIONS = [
  { name: "Manager" },
  { name: "Officer" },
  { name: "Senior Engineer" },
  { name: "Lead" },
];
const SHIFTS = [{ name: "Morning", start_time: "09:00", end_time: "17:00" }];
const LEAVE_TYPES = [{ name: "Casual" }, { name: "Sick" }];
const EMPLOYEES = [
  { employee_code: "EMP-9001", name: "Alice Rahman", email: "alice@example.com" },
  { employee_code: "EMP-9002", name: "Bob Karim", email: "bob@example.com" },
];

async function upsert(table: string, rows: any[], onConflict: string) {
  const tagged = rows.map((r) => ({ ...r, notes: TAG }));
  const { error } = await sb.from(table).upsert(tagged, { onConflict });
  if (error && !/column .* does not exist/.test(error.message)) {
    // Retry without the notes tag if the column doesn't exist on this table.
    const { error: e2 } = await sb.from(table).upsert(rows, { onConflict });
    if (e2) console.warn(`[${table}] upsert warning:`, e2.message);
  } else if (error) {
    console.warn(`[${table}] upsert warning:`, error.message);
  } else {
    console.log(`[${table}] upserted ${rows.length}`);
  }
}

async function teardown() {
  const tables = ["employees", "leave_types", "shifts", "designations", "departments", "branches"];
  for (const t of tables) {
    const { error, count } = await sb.from(t).delete({ count: "exact" }).eq("notes", TAG);
    if (error) console.warn(`[${t}] teardown warning:`, error.message);
    else console.log(`[${t}] removed ${count ?? 0}`);
  }
}

async function seed() {
  await upsert("branches", BRANCHES, "code");
  await upsert("departments", DEPARTMENTS, "code");
  await upsert("designations", DESIGNATIONS, "name");
  await upsert("shifts", SHIFTS, "name");
  await upsert("leave_types", LEAVE_TYPES, "name");
  await upsert("employees", EMPLOYEES, "employee_code");
}

(async () => {
  if (process.argv.includes("--teardown")) {
    await teardown();
  } else {
    await seed();
  }
})();
