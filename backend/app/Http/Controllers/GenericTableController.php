<?php

namespace App\Http\Controllers;

use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Generic PostgREST-compatible CRUD controller for whitelisted public-schema
 * tables. Used by the frontend data bridge
 * (`src/integrations/data/laravel-bridge.ts`) so all pages that call
 * `dataClient.from(...)` work against this API.
 *
 * Query-string protocol (URL-friendly, decoded by bridge):
 *   ?select=col1,col2                — column projection
 *   ?f[col][eq]=value                — equality (also: neq,gt,gte,lt,lte,like,ilike,is)
 *   ?f[col][in]=a,b,c                — IN
 *   ?order[col]=asc|desc             — ORDER BY (multi allowed)
 *   ?limit=N&offset=N                — pagination
 *   ?single=1                        — return first row as object (not array)
 *
 * Bodies (POST/PATCH) accept the same row shape the frontend data client sends.
 * Responses match the data client: `{ data, error }` is shaped by the bridge; this
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

    private const TABLE_PERMISSIONS = [
        'custom_roles' => ['read' => ['roles.view'], 'write' => ['roles.create', 'roles.edit'], 'delete' => ['roles.delete']],
        'role_permissions' => ['read' => ['roles.view'], 'write' => ['roles.create', 'roles.edit'], 'delete' => ['roles.edit']],
        'user_roles' => ['read' => ['users.view'], 'write' => ['users.create', 'users.edit'], 'delete' => ['users.edit']],
        'user_custom_roles' => ['read' => ['users.view'], 'write' => ['users.create', 'users.edit'], 'delete' => ['users.edit']],
        'sms_logs' => ['read' => ['sms.view', 'settings.view'], 'write' => ['sms.edit', 'settings.edit'], 'delete' => ['sms.delete', 'settings.edit']],
        'login_logs' => ['read' => ['hrm.view', 'users.view'], 'write' => ['users.edit'], 'delete' => ['users.delete']],
        // App-wide settings: readable by everyone (the SPA needs them), changed only by admins.
        'system_settings' => ['write' => ['settings.edit', 'sms.edit'], 'delete' => ['settings.edit']],
        'company_settings' => ['write' => ['settings.edit'], 'delete' => ['settings.edit']],
        'module_settings' => ['write' => ['settings.edit', 'modules.edit'], 'delete' => ['settings.edit', 'modules.edit']],
        // Salary and bank data: HR/payroll staff, or the employee's own rows (see OWN_ROW_TABLES).
        'payroll' => ['read' => ['payroll.view', 'hrm.view'], 'write' => ['payroll.create', 'payroll.edit'], 'delete' => ['payroll.delete']],
        'salary_structures' => ['read' => ['payroll.view', 'hrm.view', 'employees.view'], 'write' => ['payroll.create', 'payroll.edit', 'hrm.edit', 'employees.edit'], 'delete' => ['payroll.delete', 'hrm.delete']],
        'employee_bank_info' => ['read' => ['hrm.view', 'employees.view', 'payroll.view'], 'write' => ['hrm.create', 'hrm.edit', 'employees.create', 'employees.edit'], 'delete' => ['hrm.delete', 'employees.delete']],
    ];

    /** Whole-database backups and Google Drive credentials: Super Admin only, every operation. */
    private const SUPER_ADMIN_TABLES = ['backup_settings', 'backup_history', 'backups'];

    /** Audit trails: anyone may append, only a Super Admin may change or remove entries. */
    private const APPEND_ONLY_TABLES = ['audit_log', 'purchase_audit_log', 'user_activities', 'invoice_status_logs'];

    /**
     * Tables keyed by employee_id where an employee without the module permission may
     * still read (and, if 'write' is listed, edit) rows that belong to themselves —
     * the self-service portal (My Payslips, My Profile).
     */
    private const OWN_ROW_TABLES = [
        'payroll' => ['read'],
        'salary_structures' => ['read'],
        'employee_bank_info' => ['read', 'write'],
    ];

    /** system_settings keys whose values are secrets: hidden from users who cannot edit settings. */
    private const SECRET_SETTING_KEYS = ['sms_api_key', 'github_deploy_sync_settings'];

    /**
     * Per-table virtual column aliases. Lets frontend code written against the
     * legacy schema (e.g. item_master.name / item_master.sku) keep working
     * against the Laravel/MySQL schema (item_name / item_code). Applied to
     * select projection, filters, order, insert and update bodies.
     */
    private const ALIASES = [
        'item_master' => [
            'name' => 'item_name',
            'sku'  => 'item_code',
        ],
    ];

    private function aliasMap(string $table): array
    {
        return self::ALIASES[$table] ?? [];
    }

    private function resolveCol(string $table, string $col): string
    {
        $map = $this->aliasMap($table);
        return $map[$col] ?? $col;
    }

    private function applyAliasesToRows(string $table, $rows)
    {
        $map = $this->aliasMap($table);
        if (!$map) return $rows;
        $flip = array_flip($map); // real => virtual
        $mapRow = function ($row) use ($flip) {
            if ($row === null) return $row;
            $arr = is_object($row) ? (array) $row : $row;
            foreach ($flip as $real => $virtual) {
                if (array_key_exists($real, $arr) && !array_key_exists($virtual, $arr)) {
                    $arr[$virtual] = $arr[$real];
                }
            }
            return is_object($row) ? (object) $arr : $arr;
        };
        if (is_array($rows)) return array_map($mapRow, $rows);
        if ($rows instanceof \Illuminate\Support\Collection) return $rows->map($mapRow);
        return $mapRow($rows);
    }

    private function rewriteBody(string $table, array $row): array
    {
        $map = $this->aliasMap($table);
        if (!$map) return $row;
        $out = [];
        foreach ($row as $k => $v) {
            $out[$map[$k] ?? $k] = $v;
        }
        return $out;
    }

    /**
     * Browser/PostgREST-style clients often send ISO timestamps such as
     * 2026-06-10T16:03:58.512Z. MySQL DATETIME columns reject that format, so
     * normalize all incoming full ISO timestamps before insert/update/upsert.
     */
    private function normalizeTemporalValues(array $row): array
    {
        foreach ($row as $key => $value) {
            if (!is_string($value)) continue;
            if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})$/', $value)) continue;

            try {
                $row[$key] = Carbon::parse($value)->utc()->format('Y-m-d H:i:s');
            } catch (\Throwable $e) {
                $row[$key] = substr(str_replace('T', ' ', $value), 0, 19);
            }
        }

        return $row;
    }

    /**
     * MySQL JSON columns can't accept raw PHP arrays via the query builder —
     * that produces "Array to string conversion" and a 500. Encode any
     * array/object values to JSON strings before insert/update/upsert.
     */
    private function encodeJsonValues(array $row): array
    {
        foreach ($row as $key => $value) {
            if (is_array($value) || is_object($value)) {
                $row[$key] = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            }
        }
        return $row;
    }

    private function assertTable(string $table): void
    {
        if (!preg_match('/^[a-z_][a-z0-9_]*$/', $table)) {
            abort(400, "Invalid table name");
        }
        if (in_array($table, self::DENYLIST, true)) {
            abort(403, "Table '{$table}' is not accessible via generic API");
        }
        // Allow both base tables and views (Schema::hasTable misses views on some drivers)
        $exists = Schema::hasTable($table) || DB::selectOne(
            "SELECT 1 AS x FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
            [$table]
        );
        if (!$exists) {
            abort(404, "Table '{$table}' not found");
        }
    }

    /**
     * Checks the caller may perform $action ('read' | 'write' | 'delete') on $table.
     *
     * Returns null for unrestricted access, or an employee_id when the caller may only
     * touch their own rows (OWN_ROW_TABLES); callers must then scope the query to it.
     */
    private function assertTablePermission(Request $request, string $table, string $action): ?string
    {
        $user = $request->user();
        if (!$user) abort(401);
        if ($user->isSuperAdmin()) return null;

        if (in_array($table, self::SUPER_ADMIN_TABLES, true)) {
            abort(403, "Only Super Admins can access {$table}");
        }
        if ($action !== 'read' && in_array($table, self::APPEND_ONLY_TABLES, true) && $request->isMethod('post') === false) {
            // POST = insert (allowed); PATCH/PUT/DELETE would rewrite or erase the audit trail.
            abort(403, "Entries in {$table} cannot be changed or deleted");
        }

        $rules = self::TABLE_PERMISSIONS[$table][$action] ?? null;
        if (!$rules) return null;
        foreach ($rules as $permission) {
            if ($user->hasPermission($permission)) return null;
        }

        if ($action !== 'delete' && in_array($action, self::OWN_ROW_TABLES[$table] ?? [], true) && $user->employee_id) {
            return (string) $user->employee_id;
        }

        abort(403, "Permission denied for {$table}");
    }

    /** True when the caller may see secret settings values. */
    private function canSeeSecrets(Request $request): bool
    {
        $user = $request->user();
        return $user && ($user->isSuperAdmin() || $user->hasPermission('settings.edit') || $user->hasPermission('sms.edit'));
    }

    /** Blank out secret system_settings values for callers who cannot edit settings. */
    private function maskSecrets(Request $request, string $table, $rows)
    {
        if ($table !== 'system_settings' || $this->canSeeSecrets($request)) return $rows;
        $mask = function ($row) {
            if (is_object($row) && isset($row->setting_key) && in_array($row->setting_key, self::SECRET_SETTING_KEYS, true) && property_exists($row, 'setting_value')) {
                $row->setting_value = null;
            }
            return $row;
        };
        if ($rows instanceof \Illuminate\Support\Collection) return $rows->map($mask);
        return $mask($rows);
    }

    /**
     * user_roles: only a Super Admin may grant the 'super_admin' role, and other users'
     * changes never touch existing super_admin rows (so they cannot remove the owner).
     */
    private function guardSuperAdminRole(Request $request, string $table, array $rows, $query = null): void
    {
        if ($table !== 'user_roles' || $request->user()?->isSuperAdmin()) return;
        foreach ($rows as $r) {
            if (is_array($r) && ($r['role'] ?? null) === 'super_admin') {
                abort(403, 'Only a Super Admin can grant the super_admin role');
            }
        }
        if ($query) $query->where('role', '!=', 'super_admin');
    }

    /** Production error responses must not reveal SQL, table structure or submitted data. */
    private function failure(string $message, \Throwable $e, string $table)
    {
        \Illuminate\Support\Facades\Log::error("db {$table}: {$message}: " . $e->getMessage());
        return response()->json(
            config('app.debug') ? ['message' => $message, 'error' => $e->getMessage()] : ['message' => $message, 'error' => $message],
            500
        );
    }

    public function index(Request $request, string $table)
    {
        $this->assertTable($table);
        $ownEmployee = $this->assertTablePermission($request, $table, 'read');

        $query = DB::table($table);
        if ($ownEmployee !== null) $query->where('employee_id', $ownEmployee);
        $tableCols = Schema::getColumnListing($table);
        $aliasMap = $this->aliasMap($table); // virtual => real

        // SELECT projection — drop relation embeds and unknown columns silently
        if ($sel = $request->query('select')) {
            $cols = array_filter(array_map('trim', explode(',', $sel)));
            $cols = array_filter($cols, fn ($c) => !str_contains($c, '(') && !str_contains($c, '.'));
            $selectExprs = [];
            foreach ($cols as $c) {
                if (isset($aliasMap[$c]) && in_array($aliasMap[$c], $tableCols, true)) {
                    $selectExprs[] = DB::raw("`{$aliasMap[$c]}` AS `{$c}`");
                } elseif (in_array($c, $tableCols, true)) {
                    $selectExprs[] = $c;
                }
            }
            if ($selectExprs) $query->select($selectExprs);
        }

        // Filters: ?f[col][op]=value  (skip unknown columns to avoid 500s)
        $filters = (array) $request->query('f', []);
        foreach ($filters as $col => $ops) {
            if (!is_array($ops) || !preg_match('/^[a-z_][a-z0-9_]*$/i', $col)) continue;
            $realCol = $this->resolveCol($table, $col);
            if (!in_array($realCol, $tableCols, true)) continue;
            foreach ($ops as $op => $val) {
                if ($op === 'in') {
                    $vals = is_array($val) ? $val : explode(',', (string) $val);
                    $query->whereIn($realCol, $vals);
                } elseif ($op === 'is') {
                    if ($val === 'null' || $val === null) $query->whereNull($realCol);
                    elseif ($val === 'notnull') $query->whereNotNull($realCol);
                    else $query->where($realCol, '=', $val);
                } elseif (isset(self::ALLOWED_OPS[$op])) {
                    $sql = self::ALLOWED_OPS[$op];
                    if ($sql === 'ILIKE') {
                        $query->whereRaw("LOWER($realCol) LIKE ?", [strtolower((string) $val)]);
                    } else {
                        $query->where($realCol, $sql, $val);
                    }
                }
            }
        }

        // ORDER BY — skip unknown columns to avoid 500
        $orders = (array) $request->query('order', []);
        foreach ($orders as $col => $dir) {
            if (!preg_match('/^[a-z_][a-z0-9_]*$/i', (string) $col)) continue;
            $realCol = $this->resolveCol($table, (string) $col);
            if (!in_array($realCol, $tableCols, true)) continue;
            $query->orderBy($realCol, strtolower((string) $dir) === 'desc' ? 'desc' : 'asc');
        }

        if ($limit = (int) $request->query('limit')) $query->limit($limit);
        if ($offset = (int) $request->query('offset')) $query->offset($offset);

        $rows = $query->get();
        $rows = $this->maskSecrets($request, $table, $this->applyAliasesToRows($table, $rows));

        if ($request->boolean('single')) {
            return response()->json(is_object($rows) ? $rows : ($rows->first() ?? null));
        }
        return response()->json($rows);
    }

    public function show(Request $request, string $table, $id)
    {
        $this->assertTable($table);
        $ownEmployee = $this->assertTablePermission($request, $table, 'read');
        $pk = $this->primaryKey($table);
        $query = DB::table($table)->where($pk, $id);
        if ($ownEmployee !== null) $query->where('employee_id', $ownEmployee);
        $row = $query->first();
        if (!$row) abort(404);
        return response()->json($this->maskSecrets($request, $table, $this->applyAliasesToRows($table, $row)));
    }

    /** Own-row writers may only write rows for themselves and never move a row to someone else. */
    private function assertOwnRows(?string $ownEmployee, array $rows, bool $requireKey): void
    {
        if ($ownEmployee === null) return;
        foreach ($rows as $r) {
            if (!is_array($r)) continue;
            $has = array_key_exists('employee_id', $r);
            if (($requireKey && !$has) || ($has && (string) $r['employee_id'] !== $ownEmployee)) {
                abort(403, 'You can only change your own records');
            }
        }
    }

    /** Filters for UPDATE/DELETE: only real columns, only eq / in. */
    private function applyWriteFilters($q, string $table, array $filters, array $cols): void
    {
        foreach ($filters as $col => $ops) {
            $realCol = $this->resolveCol($table, (string) $col);
            if (!is_array($ops) || !in_array($realCol, $cols, true)) abort(400, "Unknown filter column '{$col}'");
            foreach ($ops as $op => $val) {
                if ($op === 'eq') $q->where($realCol, $val);
                elseif ($op === 'in') $q->whereIn($realCol, is_array($val) ? $val : explode(',', (string) $val));
            }
        }
    }

    public function store(Request $request, string $table)
    {
        $this->assertTable($table);
        $ownEmployee = $this->assertTablePermission($request, $table, 'write');
        $payload = $request->json()->all();
        if (!is_array($payload)) abort(400, 'Body must be JSON object or array');

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $this->assertOwnRows($ownEmployee, $rows, true);
        $this->guardSuperAdminRole($request, $table, $rows);
        $rows = array_map(fn ($r) => $this->stampTimestamps($table, $this->encodeJsonValues($this->normalizeTemporalValues($this->rewriteBody($table, $r))), true), $rows);

        $inserted = [];
        $pk = $this->primaryKey($table);
        $cols = Schema::getColumnListing($table);

        try {
            DB::transaction(function () use ($table, $rows, $pk, $cols, &$inserted) {
                foreach ($rows as $r) {
                    $clean = array_intersect_key($r, array_flip($cols));
                    // Normalize empty strings on nullable/UUID FK columns → NULL
                    foreach ($clean as $k => $v) {
                        if ($v === '') $clean[$k] = null;
                    }
                    if (array_key_exists($pk, $clean) && $clean[$pk] !== null && $clean[$pk] !== '') {
                        DB::table($table)->insert($clean);
                        $id = $clean[$pk];
                    } else {
                        $id = DB::table($table)->insertGetId($clean, $pk);
                    }
                    $inserted[] = DB::table($table)->where($pk, $id)->first();
                }
            });
        } catch (\Throwable $e) {
            return $this->failure('Insert failed', $e, $table);
        }

        return response()->json($this->applyAliasesToRows($table, $inserted), 201);
    }

    public function update(Request $request, string $table)
    {
        $this->assertTable($table);
        $ownEmployee = $this->assertTablePermission($request, $table, 'write');
        $payload = $request->json()->all();
        if (!is_array($payload)) abort(400, 'Body must be a JSON object');
        $filters = (array) $request->query('f', []);
        if (empty($filters)) abort(400, 'UPDATE requires at least one filter (f[col][eq]=...)');
        $this->assertOwnRows($ownEmployee, [$payload], false);
        $this->guardSuperAdminRole($request, $table, [$payload]);
        $cols = Schema::getColumnListing($table);

        $applyFilters = function ($q) use ($request, $table, $filters, $cols, $ownEmployee) {
            $this->applyWriteFilters($q, $table, $filters, $cols);
            if ($ownEmployee !== null) $q->where('employee_id', $ownEmployee);
            $this->guardSuperAdminRole($request, $table, [], $q);
        };

        try {
            $q = DB::table($table);
            $applyFilters($q);
            $clean = array_intersect_key(
                $this->stampTimestamps($table, $this->encodeJsonValues($this->normalizeTemporalValues($this->rewriteBody($table, $payload))), false),
                array_flip($cols)
            );
            // Normalize empty strings on UUID/nullable FK columns → NULL
            foreach ($clean as $k => $v) {
                if ($v === '') $clean[$k] = null;
            }
            $q->update($clean);

            $q2 = DB::table($table);
            $applyFilters($q2);
            return response()->json($this->applyAliasesToRows($table, $q2->get()));
        } catch (\Throwable $e) {
            return $this->failure('Update failed', $e, $table);
        }
    }



    public function upsert(Request $request, string $table)
    {
        $this->assertTable($table);
        $ownEmployee = $this->assertTablePermission($request, $table, 'write');
        $payload = $request->json()->all();
        if (!is_array($payload)) abort(400, 'Body must be JSON object or array');
        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $this->assertOwnRows($ownEmployee, $rows, true);
        $this->guardSuperAdminRole($request, $table, $rows);
        $onConflict = $request->query('on_conflict');
        $conflictCols = $onConflict
            ? array_filter(array_map('trim', explode(',', $onConflict)))
            : [$this->primaryKey($table)];
        // resolve aliases on conflict columns too
        $conflictCols = array_map(fn ($c) => $this->resolveCol($table, $c), $conflictCols);

        $cols = Schema::getColumnListing($table);
        $clean = array_map(
            fn ($r) => array_intersect_key(
                $this->stampTimestamps($table, $this->encodeJsonValues($this->normalizeTemporalValues($this->rewriteBody($table, $r))), true),
                array_flip($cols)
            ),
            $rows
        );

        $conflictCols = array_values(array_filter($conflictCols, fn ($c) => in_array($c, $cols, true)));

        $out = [];
        DB::transaction(function () use ($table, $clean, $conflictCols, $ownEmployee, &$out) {
            foreach ($clean as $r) {
                $where = [];
                foreach ($conflictCols as $c) {
                    if (array_key_exists($c, $r)) $where[$c] = $r[$c];
                }
                // An own-row writer must never overwrite another employee's row that shares the key.
                if ($ownEmployee !== null && $where) $where['employee_id'] = $ownEmployee;
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
        return response()->json($this->applyAliasesToRows($table, $out));
    }

    public function destroy(Request $request, string $table)
    {
        $this->assertTable($table);
        $this->assertTablePermission($request, $table, 'delete');
        $filters = (array) $request->query('f', []);
        if (empty($filters)) abort(400, 'DELETE requires at least one filter');

        $q = DB::table($table);
        $this->applyWriteFilters($q, $table, $filters, Schema::getColumnListing($table));
        $this->guardSuperAdminRole($request, $table, [], $q);
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
        // Auto-generate UUID for `id` primary key on INSERT when the column is
        // a CHAR(36)/VARCHAR UUID without a DB default and the frontend did
        // not supply one. Without this, MySQL fails with
        // "Field 'id' doesn't have a default value" for every UUID-PK table.
        if ($isInsert && Schema::hasColumn($table, 'id') && !isset($row['id'])) {
            // Detect auto-increment by querying information_schema. If the
            // `id` column is NOT auto-increment we assume it is a UUID/string
            // PK without a DB default and generate one here.
            $isAutoInc = false;
            try {
                $info = DB::selectOne(
                    'SELECT EXTRA, DATA_TYPE FROM information_schema.COLUMNS
                       WHERE TABLE_SCHEMA = DATABASE()
                         AND TABLE_NAME = ?
                         AND COLUMN_NAME = ?',
                    [$table, 'id']
                );
                if ($info) {
                    $extra = strtolower((string) ($info->EXTRA ?? $info->extra ?? ''));
                    $isAutoInc = str_contains($extra, 'auto_increment');
                }
            } catch (\Throwable $e) {
                // If detection fails, fall through and generate UUID anyway.
            }
            if (!$isAutoInc) {
                $row['id'] = (string) \Illuminate\Support\Str::uuid();
            }
        }
        return $row;
    }
}
