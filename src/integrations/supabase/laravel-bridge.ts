/**
 * Laravel-mode Supabase bridge.
 *
 * Implements the subset of the supabase-js v2 API actually used in this
 * codebase (search the repo for `supabase.from`, `supabase.storage`,
 * `supabase.functions.invoke`). All calls are translated into REST calls
 * against the Laravel backend's generic CRUD + storage endpoints
 * (see `GenericTableController` / `GenericStorageController`).
 *
 * Goal: on a VPS deployment (LARAVEL_ONLY_MODE) every page that uses
 * `supabase.from(...)` keeps working without rewriting it, and Supabase
 * is never contacted.
 */

import { getApiBaseUrl, getLaravelAuthHeaders, getLaravelToken } from "@/lib/laravel-auth";

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

interface FilterEntry { col: string; op: string; val: any }

/**
 * Strip PostgREST relation embedding from a select string and return a clean
 * comma-list of plain columns.
 *
 *  "id, name, rel!inner(a, b), c"  →  "id,name,c"
 *  "*, rel(a, b)"                  →  "*"
 *  "rel!inner(a, b)"               →  "" (caller treats as select-all)
 */
function stripRelationCols(cols: string): string {
  // 1. Remove balanced "(...)" segments entirely (handles nested commas).
  let stripped = "";
  let depth = 0;
  for (const ch of cols) {
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) stripped += ch;
  }
  // 2. Split, trim, drop relation tokens (anything with ':' or '!' or empty).
  return stripped
    .split(",")
    .map((s) => s.trim())
    .filter((c) => c && !c.includes(":") && !c.includes("!"))
    .join(",");
}

type RelationEmbed = { alias: string; table: string; columns: string[] };

function parseRelationEmbeds(select?: string): RelationEmbed[] {
  if (!select) return [];
  const embeds: RelationEmbed[] = [];
  for (let i = 0; i < select.length; i++) {
    if (select[i] !== "(") continue;
    let start = i;
    let depth = 1;
    while (++i < select.length && depth > 0) {
      if (select[i] === "(") depth++;
      else if (select[i] === ")") depth--;
    }
    if (depth !== 0) break;
    let tokenStart = start - 1;
    while (tokenStart >= 0 && select[tokenStart] !== ",") tokenStart--;
    const token = select.slice(tokenStart + 1, start).trim();
    const rawCols = select.slice(start + 1, i).trim();
    if (!token || token.includes(".")) continue;
    const [aliasPart, relationPart = aliasPart] = token.includes(":") ? token.split(":", 2) : [token, token];
    const table = relationPart.split("!")[0]?.trim();
    const alias = aliasPart.trim();
    if (!alias || !table || !/^[a-z_][a-z0-9_]*$/i.test(table)) continue;
    const columns = rawCols === "*"
      ? ["*"]
      : rawCols.split(",").map((c) => c.trim()).filter((c) => /^[a-z_][a-z0-9_]*$/i.test(c));
    embeds.push({ alias, table, columns: columns.length ? columns : ["*"] });
  }
  return embeds;
}

/**
 * Conventional foreign-key column on the child table for a given parent table.
 * Used to translate PostgREST relation filters (e.g. `acc_vouchers.status`) into
 * a local `<fk> IN (...)` filter, since the Laravel endpoint has no join support.
 */
function relationForeignKey(parent: string): string | null {
  const map: Record<string, string> = {
    acc_vouchers: "voucher_id",
    sales_invoices: "invoice_id",
    
    party_payments: "payment_id",
    employees: "employee_id",
    chart_of_accounts: "account_id",
    item_master: "item_id",
    warehouses: "warehouse_id",
    branches: "branch_id",
  };
  if (map[parent]) return map[parent];
  // Fallback: strip trailing "s" → "<singular>_id"
  if (parent.endsWith("s")) return `${parent.slice(0, -1)}_id`;
  return `${parent}_id`;
}

function buildQS(params: {
  select?: string;
  filters: FilterEntry[];
  orders: { col: string; asc: boolean }[];
  limit?: number;
  offset?: number;
  single?: boolean;
  onConflict?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.select) sp.set("select", params.select);
  for (const f of params.filters) {
    // Dotted columns (e.g. "acc_vouchers.status") are PostgREST relation
    // filters — the generic Laravel endpoint cannot honor them, so drop
    // silently to avoid 500s. Callers must filter via the parent table.
    if (f.col.includes(".")) continue;
    const key = `f[${f.col}][${f.op}]`;
    if (f.op === "in" && Array.isArray(f.val)) {
      sp.append(key, f.val.map((v) => (typeof v === "boolean" ? (v ? "1" : "0") : v)).join(","));
    } else if (typeof f.val === "boolean") {
      // MySQL tinyint(1) stores 1/0; "true"/"false" strings won't match.
      sp.append(key, f.val ? "1" : "0");
    } else {
      sp.append(key, f.val === null ? "null" : String(f.val));
    }
  }
  for (const o of params.orders) sp.append(`order[${o.col}]`, o.asc ? "asc" : "desc");
  if (params.limit != null) sp.set("limit", String(params.limit));
  if (params.offset != null) sp.set("offset", String(params.offset));
  if (params.single) sp.set("single", "1");
  if (params.onConflict) sp.set("on_conflict", params.onConflict);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function unwrapLaravelRows(json: any): any[] {
  const payload = unwrapSuccessPayload(json);
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

// Convert ISO 8601 'Z' timestamps to MySQL-compatible 'YYYY-MM-DD HH:MM:SS'
// so Laravel/MySQL doesn't reject values like "2026-06-10T08:09:08.432Z".
const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
function sanitizeMysqlDates(value: any): any {
  if (value == null) return value;
  if (typeof value === "string") {
    return ISO_Z_RE.test(value) ? value.slice(0, 19).replace("T", " ") : value;
  }
  if (Array.isArray(value)) return value.map(sanitizeMysqlDates);
  if (typeof value === "object") {
    const out: any = {};
    for (const k in value) out[k] = sanitizeMysqlDates(value[k]);
    return out;
  }
  return value;
}

async function call<T>(method: string, url: string, body?: any): Promise<Result<T>> {
  try {
    const base = getApiBaseUrl();
    if (!base) return { data: null, error: { message: "Laravel API base URL not configured" } };
    const init: RequestInit = {
      method,
      headers: { ...getLaravelAuthHeaders(true) },
    };
    if (body !== undefined) init.body = JSON.stringify(sanitizeMysqlDates(body));
    const res = await fetch(`${base}${url}`, init);
    const ct = res.headers.get("content-type") || "";
    const json = ct.includes("application/json") ? await res.json().catch(() => null) : null;
    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || `HTTP ${res.status}`;
      return { data: null, error: { message: msg, code: String(res.status) } };
    }
    return { data: json as T, error: null };
  } catch (e: any) {
    return { data: null, error: { message: e?.message || "Network error" } };
  }
}

function unwrapSuccessPayload(json: any): any {
  return json && typeof json === "object" && "success" in json && "data" in json ? json.data : json;
}

function projectRow(row: any, select?: string): any {
  if (!row || !select) return row;
  const out: Record<string, any> = {};
  select.split(",").map((c) => c.trim()).filter(Boolean).forEach((col) => { out[col] = row[col]; });
  return out;
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Query builder — chainable, then-able (so `await` works directly).        */
/* ──────────────────────────────────────────────────────────────────────── */

class QueryBuilder<T = any> implements PromiseLike<Result<T>> {
  private _select?: string;
  private _relationEmbeds: RelationEmbed[] = [];
  private _filters: FilterEntry[] = [];
  private _orders: { col: string; asc: boolean }[] = [];
  private _limit?: number;
  private _offset?: number;
  private _single = false;
  private _maybeSingle = false;
  private _mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private _body?: any;
  private _onConflict?: string;
  private _returning = true; // .select() after insert/update toggles this

  constructor(private table: string) {}

  // -- selection / projection
  select(cols = "*"): this {
    if (this._mode === "insert" || this._mode === "update" || this._mode === "upsert") {
      this._returning = true;
    } else {
      this._mode = "select";
    }
    this._relationEmbeds = parseRelationEmbeds(cols);
    this._select = cols === "*" ? undefined : stripRelationCols(cols) || undefined;
    return this;
  }

  // -- filters
  eq(col: string, val: any): this  { this._filters.push({ col, op: "eq",  val }); return this; }
  neq(col: string, val: any): this { this._filters.push({ col, op: "neq", val }); return this; }
  gt(col: string, val: any): this  { this._filters.push({ col, op: "gt",  val }); return this; }
  gte(col: string, val: any): this { this._filters.push({ col, op: "gte", val }); return this; }
  lt(col: string, val: any): this  { this._filters.push({ col, op: "lt",  val }); return this; }
  lte(col: string, val: any): this { this._filters.push({ col, op: "lte", val }); return this; }
  like(col: string, val: any): this  { this._filters.push({ col, op: "like",  val }); return this; }
  ilike(col: string, val: any): this { this._filters.push({ col, op: "ilike", val }); return this; }
  is(col: string, val: any): this    { this._filters.push({ col, op: "is", val: val === null ? "null" : val }); return this; }
  in(col: string, vals: any[]): this { this._filters.push({ col, op: "in", val: vals }); return this; }
  not(col: string, op: string, val: any): this { this._filters.push({ col, op: "neq", val }); return this; }
  filter(col: string, op: string, val: any): this {
    const map: Record<string, string> = { eq: "eq", neq: "neq", gt: "gt", gte: "gte", lt: "lt", lte: "lte", like: "like", ilike: "ilike", in: "in", is: "is" };
    const o = map[op] || "eq";
    this._filters.push({ col, op: o, val });
    return this;
  }
  match(criteria: Record<string, any>): this {
    Object.entries(criteria).forEach(([col, val]) => this.eq(col, val));
    return this;
  }

  // -- ordering / paging
  order(col: string, opts?: { ascending?: boolean }): this {
    this._orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number): this { this._limit = n; return this; }
  range(from: number, to: number): this { this._offset = from; this._limit = to - from + 1; return this; }

  // -- single-row
  single(): PromiseLike<Result<T>> { this._single = true; return this; }
  maybeSingle(): PromiseLike<Result<T>> { this._maybeSingle = true; this._single = true; return this; }

  // -- mutations
  insert(values: any | any[]): this {
    this._mode = "insert";
    this._body = values;
    this._returning = false; // becomes true if user chains .select()
    return this;
  }
  update(values: any): this {
    this._mode = "update";
    this._body = values;
    this._returning = false;
    return this;
  }
  upsert(values: any | any[], opts?: { onConflict?: string }): this {
    this._mode = "upsert";
    this._body = values;
    this._onConflict = opts?.onConflict;
    this._returning = false;
    return this;
  }
  delete(): this {
    this._mode = "delete";
    this._returning = false;
    return this;
  }

  // -- execute
  private async run(): Promise<Result<T>> {
    // Company settings has a single Laravel controller-backed row whose UUID is
    // not literally "default". Keep existing Supabase-style callers working.
    if (this.table === "company_settings") {
      // Skip authenticated calls when there is no session (e.g. on /login)
      // to avoid noisy 401s before the user signs in.
      const hasToken = !!getLaravelToken();
      if (!hasToken) {
        return { data: (this._single ? null : []) as T, error: null };
      }
      if (this._mode === "select") {
        const res = await call<any>("GET", "/v1/settings/company");
        if (res.error) return res as Result<T>;
        const row = projectRow(unwrapSuccessPayload(res.data), this._select);
        return { data: (this._single ? row : (row ? [row] : [])) as T, error: null };
      }
      if (this._mode === "update" || this._mode === "upsert") {
        const res = await call<any>("PUT", "/v1/settings/company", this._body);
        if (res.error) return res as Result<T>;
        const row = unwrapSuccessPayload(res.data);
        return { data: (this._single ? row : [row]) as T, error: null };
      }
    }

    // Resolve PostgREST-style relation filters (e.g. "acc_vouchers.status")
    // into a concrete `<fk> IN (...)` filter on the main table. The Laravel
    // generic endpoint does not support joins, so we emulate inner-join +
    // relation eq/gte/lte filters with a 2-step query.
    if (this._mode === "select") {
      const relFilters = this._filters.filter((f) => f.col.includes("."));
      if (relFilters.length > 0) {
        const byParent: Record<string, FilterEntry[]> = {};
        for (const f of relFilters) {
          const [parent, col] = f.col.split(".", 2);
          (byParent[parent] ||= []).push({ col, op: f.op, val: f.val });
        }
        for (const [parent, pfilters] of Object.entries(byParent)) {
          const fk = relationForeignKey(parent);
          if (!fk) continue;
          // Fetch parent IDs that match the relation filters.
          const parentQs = buildQS({ select: "id", filters: pfilters, orders: [], limit: 10000 });
          const parentRes = await call<any[]>("GET", `/v1/db/${parent}${parentQs}`);
          const ids = Array.isArray(parentRes.data) ? parentRes.data.map((r: any) => r.id) : [];
          // Replace relation filters with a local IN-filter.
          this._filters = this._filters.filter((f) => !f.col.startsWith(`${parent}.`));
          if (ids.length === 0) {
            // No parent matches → main query returns empty.
            return { data: ([] as unknown) as T, error: null };
          }
          this._filters.push({ col: fk, op: "in", val: ids });
        }
      }
    }

    const qs = buildQS({
      select: this._select,
      filters: this._filters,
      orders: this._orders,
      limit: this._limit,
      offset: this._offset,
      single: this._mode === "select" && this._single,
      onConflict: this._onConflict,
    });
    const url = `/v1/db/${this.table}${qs}`;
    let res: Result<any>;
    switch (this._mode) {
      case "select": res = await call<any>("GET",    url); break;
      case "insert": res = await call<any>("POST",   url, this._body); break;
      case "update": res = await call<any>("PATCH",  url, this._body); break;
      case "upsert": res = await call<any>("PUT",    url, this._body); break;
      case "delete": res = await call<any>("DELETE", url); break;
    }
    if (res.error) return res as Result<T>;

    // Post-process: emulate Supabase return shapes.
    let data: any = res.data;
    if (this._mode === "select" && this._relationEmbeds.length > 0) {
      data = await this.attachRelationEmbeds(data);
    }
    if (this._mode !== "select" && Array.isArray(data) && this._single) data = data[0] ?? null;
    if (this._mode === "select" && this._single && Array.isArray(data)) data = data[0] ?? null;
    if (this._mode === "select" && this._single && !this._maybeSingle && data == null) {
      return { data: null, error: { message: "Row not found", code: "PGRST116" } };
    }
    return { data: data as T, error: null };
  }

  private async attachRelationEmbeds(data: any): Promise<any> {
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return data;

    for (const rel of this._relationEmbeds) {
      const fk = relationForeignKey(rel.table);
      if (!fk) continue;
      const ids = Array.from(new Set(rows.map((r: any) => r?.[fk]).filter(Boolean).map(String)));
      if (ids.length === 0) {
        rows.forEach((r: any) => { r[rel.alias] = null; });
        continue;
      }

      const relatedById = new Map<string, any>();
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const cols = rel.columns.includes("*") ? undefined : Array.from(new Set(["id", ...rel.columns])).join(",");
        const qs = buildQS({ select: cols, filters: [{ col: "id", op: "in", val: slice }], orders: [], limit: slice.length });
        const relRes = await call<any>("GET", `/v1/db/${rel.table}${qs}`);
        if (relRes.error) continue;
        for (const related of unwrapLaravelRows(relRes.data)) relatedById.set(String(related.id), related);
      }

      rows.forEach((r: any) => { r[rel.alias] = relatedById.get(String(r?.[fk])) ?? null; });
    }

    return Array.isArray(data) ? rows : rows[0] ?? null;
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled as any, onrejected as any);
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Storage bridge                                                          */
/* ──────────────────────────────────────────────────────────────────────── */

class StorageBucket {
  constructor(private bucket: string) {}

  async upload(path: string, file: File | Blob, _opts?: { upsert?: boolean }): Promise<Result<{ path: string }>> {
    try {
      const base = getApiBaseUrl();
      if (!base) return { data: null, error: { message: "Laravel API not configured" } };
      const fd = new FormData();
      fd.append("file", file as Blob, path.split("/").pop() || "file");
      const folder = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
      if (folder) fd.append("path", folder);
      const res = await fetch(`${base}/v1/storage/${this.bucket}`, {
        method: "POST",
        headers: { ...getLaravelAuthHeaders() },
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { data: null, error: { message: json?.message || `HTTP ${res.status}` } };
      const stored = String(json?.data?.path || path).replace(new RegExp(`^${this.bucket}/`), "");
      return { data: { path: stored }, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message || "Upload failed" } };
    }
  }

  getPublicUrl(path: string): { data: { publicUrl: string } } {
    const base = getApiBaseUrl() || "";
    // Public storage symlink: /storage/<bucket>/<path>
    const origin = base.replace(/\/api$/, "");
    const cleanPath = path.replace(new RegExp(`^${this.bucket}/`), "").replace(/^\/+/, "");
    return { data: { publicUrl: `${origin}/storage/${this.bucket}/${cleanPath}` } };
  }

  async remove(paths: string[]): Promise<Result<{ deleted: number }>> {
    let deleted = 0;
    for (const p of paths) {
      const base = getApiBaseUrl();
      if (!base) continue;
      const res = await fetch(`${base}/v1/storage/${this.bucket}/${encodeURI(p)}`, {
        method: "DELETE",
        headers: { ...getLaravelAuthHeaders() },
      });
      if (res.ok) deleted++;
    }
    return { data: { deleted }, error: null };
  }

  async createSignedUrl(path: string, _expiresIn: number): Promise<Result<{ signedUrl: string }>> {
    return { data: { signedUrl: this.getPublicUrl(path).data.publicUrl }, error: null };
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Functions / Auth stubs                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

const functionsBridge = {
  async invoke(_name: string, _opts?: any): Promise<Result<any>> {
    return {
      data: null,
      error: { message: `Edge function '${_name}' is not available in Laravel mode. Use the equivalent Laravel API endpoint.` },
    };
  },
};

const authBridge = {
  async getSession() { return { data: { session: null }, error: null }; },
  async getUser()    { return { data: { user: null }, error: null }; },
  onAuthStateChange(_cb: any) { return { data: { subscription: { unsubscribe() {} } } }; },
  async signOut() { return { error: null }; },
  async signInWithPassword(_args: any) {
    return { data: null, error: { message: "Use Laravel /auth/login in Laravel mode." } };
  },
};

/* ──────────────────────────────────────────────────────────────────────── */
/*  Exposed client                                                          */
/* ──────────────────────────────────────────────────────────────────────── */

export const laravelSupabaseBridge = {
  from<T = any>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table);
  },
  storage: {
    from(bucket: string) { return new StorageBucket(bucket); },
    async listBuckets(): Promise<Result<Array<{ id: string; name: string; public: boolean }>>> {
      return { data: [
        { id: "company-assets", name: "company-assets", public: true },
        { id: "branding", name: "branding", public: true },
        { id: "employee-photos", name: "employee-photos", public: true },
        { id: "backups", name: "backups", public: false },
      ], error: null };
    },
    async getBucket(id: string): Promise<Result<{ id: string; name: string; public: boolean }>> {
      return { data: { id, name: id, public: true }, error: null };
    },
    async createBucket(_id: string, _opts?: any): Promise<Result<{ name: string }>> {
      return { data: { name: _id }, error: null };
    },
  },
  functions: functionsBridge,
  auth: authBridge,
  // RPC: not generically translatable; surface a clear error.
  async rpc(_name: string, _args?: any): Promise<Result<any>> {
    return { data: null, error: { message: `RPC '${_name}' is not available in Laravel mode.` } };
  },
  // .channel/.removeChannel realtime stubs (no-op in Laravel mode)
  channel(_name: string) {
    const ch: any = { on: () => ch, subscribe: () => ch, unsubscribe: () => ch };
    return ch;
  },
  removeChannel(_ch: any) { /* no-op */ },
};

export type LaravelSupabaseBridge = typeof laravelSupabaseBridge;
