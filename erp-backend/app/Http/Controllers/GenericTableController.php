<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Generic PostgREST-compatible CRUD controller for whitelisted public-schema
 * tables. Used by the frontend Laravel-mode Supabase bridge
 * (`src/integrations/supabase/laravel-bridge.ts`) so all pages that call
 * `supabase.from(...)` work on VPS without touching Supabase.
 *
 * Query-string protocol (URL-friendly, decoded by bridge):
 *   ?select=col1,col2                — column projection
 *   ?f[col][eq]=value                — equality (also: neq,gt,gte,lt,lte,like,ilike,is)
 *   ?f[col][in]=a,b,c                — IN
 *   ?order[col]=asc|desc             — ORDER BY (multi allowed)
 *   ?limit=N&offset=N                — pagination
 *   ?single=1                        — return first row as object (not array)
 *
 * Bodies (POST/PATCH) accept the same row shape Supabase clients send.
 * Responses match Supabase: `{ data, error }` is shaped by the bridge; this
 * controller returns raw arrays/objects with proper HTTP status codes.
 */
class GenericTableController extends BaseController
{
    /**
     * Block these tables entirely — never expose over generic CRUD.
     * Auth/security tables and any with custom controllers that MUST stay in charge.
     */
    private const DENYLIST = [
        'users', 'password_reset_tokens', 'personal_access_tokens',
        'failed_jobs', 'jobs', 'job_batches', 'cache', 'cache_locks',
        'sessions', 'migrations',
    ];

    private const ALLOWED_OPS = [
        'eq' => '=', 'neq' => '!=', 'gt' => '>', 'gte' => '>=',
        'lt' => '<', 'lte' => '<=', 'like' => 'LIKE', 'ilike' => 'ILIKE',
    ];

    private function assertTable(string $table): void
    {
        if (!preg_match('/^[a-z_][a-z0-9_]*$/', $table)) {
            abort(400, "Invalid table name");
        }
        if (in_array($table, self::DENYLIST, true)) {
            abort(403, "Table '{$table}' is not accessible via generic API");
        }
        if (!Schema::hasTable($table)) {
            abort(404, "Table '{$table}' not found");
        }
    }

    public function index(Request $request, string $table)
    {
        $this->assertTable($table);

        $query = DB::table($table);

        // SELECT projection
        if ($sel = $request->query('select')) {
            $cols = array_filter(array_map('trim', explode(',', $sel)));
            // strip PostgREST relation syntax: "rel(*)" -> skip
            $cols = array_filter($cols, fn ($c) => !str_contains($c, '('));
            if ($cols) $query->select($cols);
        }

        // Filters: ?f[col][op]=value  (skip unknown columns to avoid 500s)
        $filters = (array) $request->query('f', []);
        $tableCols = Schema::getColumnListing($table);
        foreach ($filters as $col => $ops) {
            if (!is_array($ops) || !preg_match('/^[a-z_][a-z0-9_]*$/i', $col)) continue;
            if (!in_array($col, $tableCols, true)) continue; // ignore relation/foreign cols
            foreach ($ops as $op => $val) {
                if ($op === 'in') {
                    $vals = is_array($val) ? $val : explode(',', (string) $val);
                    $query->whereIn($col, $vals);
                } elseif ($op === 'is') {
                    if ($val === 'null' || $val === null) $query->whereNull($col);
                    elseif ($val === 'notnull') $query->whereNotNull($col);
                    else $query->where($col, '=', $val);
                } elseif (isset(self::ALLOWED_OPS[$op])) {
                    $sql = self::ALLOWED_OPS[$op];
                    if ($sql === 'ILIKE') {
                        $query->whereRaw("LOWER($col) LIKE ?", [strtolower((string) $val)]);
                    } else {
                        $query->where($col, $sql, $val);
                    }
                }
            }
        }

        // ORDER BY
        $orders = (array) $request->query('order', []);
        foreach ($orders as $col => $dir) {
            if (!preg_match('/^[a-z_][a-z0-9_]*$/i', (string) $col)) continue;
            $query->orderBy($col, strtolower((string) $dir) === 'desc' ? 'desc' : 'asc');
        }

        if ($limit = (int) $request->query('limit')) $query->limit($limit);
        if ($offset = (int) $request->query('offset')) $query->offset($offset);

        $rows = $query->get();

        if ($request->boolean('single')) {
            return response()->json($rows->first());
        }
        return response()->json($rows);
    }

    public function show(Request $request, string $table, $id)
    {
        $this->assertTable($table);
        $pk = $this->primaryKey($table);
        $row = DB::table($table)->where($pk, $id)->first();
        if (!$row) abort(404);
        return response()->json($row);
    }

    public function store(Request $request, string $table)
    {
        $this->assertTable($table);
        $payload = $request->json()->all();
        if (!is_array($payload)) abort(400, 'Body must be JSON object or array');

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $rows = array_map(fn ($r) => $this->stampTimestamps($table, $r, true), $rows);

        $inserted = [];
        $pk = $this->primaryKey($table);
        $cols = Schema::getColumnListing($table);

        DB::transaction(function () use ($table, $rows, $pk, $cols, &$inserted) {
            foreach ($rows as $r) {
                // drop unknown columns silently (forward-compat with Supabase types)
                $clean = array_intersect_key($r, array_flip($cols));
                $id = DB::table($table)->insertGetId($clean, $pk);
                $inserted[] = DB::table($table)->where($pk, $id)->first();
            }
        });

        return response()->json($inserted, 201);
    }

    public function update(Request $request, string $table)
    {
        $this->assertTable($table);
        $payload = $request->json()->all();
        $filters = (array) $request->query('f', []);
        if (empty($filters)) abort(400, 'UPDATE requires at least one filter (f[col][eq]=...)');

        $q = DB::table($table);
        foreach ($filters as $col => $ops) {
            foreach ($ops as $op => $val) {
                if ($op === 'eq') $q->where($col, $val);
                elseif ($op === 'in') $q->whereIn($col, is_array($val) ? $val : explode(',', (string) $val));
            }
        }
        $cols = Schema::getColumnListing($table);
        $clean = array_intersect_key($this->stampTimestamps($table, $payload, false), array_flip($cols));
        $q->update($clean);

        // return updated rows
        $q2 = DB::table($table);
        foreach ($filters as $col => $ops) {
            foreach ($ops as $op => $val) {
                if ($op === 'eq') $q2->where($col, $val);
                elseif ($op === 'in') $q2->whereIn($col, is_array($val) ? $val : explode(',', (string) $val));
            }
        }
        return response()->json($q2->get());
    }

    public function upsert(Request $request, string $table)
    {
        $this->assertTable($table);
        $payload = $request->json()->all();
        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $onConflict = $request->query('on_conflict');
        $conflictCols = $onConflict
            ? array_filter(array_map('trim', explode(',', $onConflict)))
            : [$this->primaryKey($table)];

        $cols = Schema::getColumnListing($table);
        $clean = array_map(
            fn ($r) => array_intersect_key($this->stampTimestamps($table, $r, true), array_flip($cols)),
            $rows
        );

        // updateOrInsert per row (DB-agnostic)
        $out = [];
        DB::transaction(function () use ($table, $clean, $conflictCols, &$out) {
            foreach ($clean as $r) {
                $where = [];
                foreach ($conflictCols as $c) {
                    if (array_key_exists($c, $r)) $where[$c] = $r[$c];
                }
                if ($where) {
                    DB::table($table)->updateOrInsert($where, $r);
                } else {
                    DB::table($table)->insert($r);
                }
                $q = DB::table($table);
                foreach ($where as $k => $v) $q->where($k, $v);
                $out[] = $q->first();
            }
        });
        return response()->json($out);
    }

    public function destroy(Request $request, string $table)
    {
        $this->assertTable($table);
        $filters = (array) $request->query('f', []);
        if (empty($filters)) abort(400, 'DELETE requires at least one filter');

        $q = DB::table($table);
        foreach ($filters as $col => $ops) {
            foreach ($ops as $op => $val) {
                if ($op === 'eq') $q->where($col, $val);
                elseif ($op === 'in') $q->whereIn($col, is_array($val) ? $val : explode(',', (string) $val));
            }
        }
        $deleted = $q->delete();
        return response()->json(['deleted' => $deleted]);
    }

    private function primaryKey(string $table): string
    {
        // Prefer 'id', else first column.
        if (Schema::hasColumn($table, 'id')) return 'id';
        return Schema::getColumnListing($table)[0] ?? 'id';
    }

    private function isAssoc(array $a): bool
    {
        return array_keys($a) !== range(0, count($a) - 1);
    }

    private function stampTimestamps(string $table, array $row, bool $isInsert): array
    {
        $now = now();
        if (Schema::hasColumn($table, 'updated_at') && !isset($row['updated_at'])) {
            $row['updated_at'] = $now;
        }
        if ($isInsert && Schema::hasColumn($table, 'created_at') && !isset($row['created_at'])) {
            $row['created_at'] = $now;
        }
        return $row;
    }
}
