<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class BackupController extends BaseController
{
    /**
     * List backup history.
     */
    public function index(Request $request): JsonResponse
    {
        $history = DB::table('backup_history')
            ->orderByDesc('created_at')
            ->limit($request->input('limit', 50))
            ->get();

        return $this->success($history);
    }

    /**
     * Create a new SQL backup.
     */
    public function create(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can create backups.', 403);
        }

        try {
            $exitCode = Artisan::call('backup:database', ['--type' => 'manual']);

            if ($exitCode !== 0) {
                return $this->error('Backup command failed.', 500);
            }

            // Get the latest backup record
            $latest = DB::table('backup_history')
                ->orderByDesc('created_at')
                ->first();

            return $this->success($latest, 'Backup created successfully');
        } catch (\Exception $e) {
            Log::error("Backup creation failed: " . $e->getMessage());
            return $this->error('Backup failed: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Download a backup file.
     */
    public function download(string $id): \Symfony\Component\HttpFoundation\BinaryFileResponse|JsonResponse
    {
        $record = DB::table('backup_history')->where('id', $id)->first();
        if (!$record || !$record->storage_path) {
            return $this->error('Backup file not found.', 404);
        }

        $fullPath = storage_path('app/' . $record->storage_path);
        if (!file_exists($fullPath)) {
            return $this->error('Backup file not found on disk.', 404);
        }

        return response()->download($fullPath, $record->file_name, [
            'Content-Type' => 'application/sql',
        ]);
    }

    /**
     * Restore database from uploaded SQL file.
     */
    public function restore(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can restore backups.', 403);
        }

        $request->validate([
            'sql_file' => 'required|file|max:512000', // 500MB max
        ]);

        // Give the restore room to run on big SQL files
        @ini_set('memory_limit', '1024M');
        @set_time_limit(0);

        $file = $request->file('sql_file');
        $originalName = $file->getClientOriginalName();

        if (!Str::endsWith($originalName, '.sql')) {
            return $this->error('Only .sql files are allowed.', 422);
        }

        try {
            // Ensure backups dir exists
            $backupsDir = storage_path('app/backups');
            if (!is_dir($backupsDir)) {
                @mkdir($backupsDir, 0775, true);
            }

            $fileName = 'restore_' . date('Y_m_d_H_i_s') . '.sql';
            $fullPath = $backupsDir . '/' . $fileName;
            $path = 'backups/' . $fileName;

            if (!@move_uploaded_file($file->getRealPath(), $fullPath)) {
                // Fallback to Storage facade
                $stored = $file->storeAs('backups', $fileName, 'local');
                if (!$stored) {
                    throw new \RuntimeException('Failed to save uploaded SQL file to ' . $fullPath);
                }
                $fullPath = Storage::disk('local')->path($stored);
                $path = $stored;
            }

            if (!file_exists($fullPath)) {
                throw new \RuntimeException('Uploaded SQL file not found at ' . $fullPath);
            }

            // Always use the PHP-based restore. The `mysql` CLI is often missing
            // on shared/VPS PHP-FPM environments, and even when present it
            // silently swallows errors with --force which makes diagnosis hard.
            [$ok, $skipped, $firstError] = $this->phpSqlRestore($fullPath);

            // Record restore in history
            DB::table('backup_history')->insert([
                'id' => Str::uuid(),
                'file_name' => $originalName,
                'backup_type' => 'restore',
                'format' => 'sql',
                'status' => $ok > 0 ? 'completed' : 'failed',
                'file_size' => $file->getSize(),
                'storage_path' => $path,
                'records_count' => $ok,
                'error_message' => $skipped > 0 ? "Skipped {$skipped} statements. First: " . substr((string) $firstError, 0, 300) : null,
                'created_at' => now(),
            ]);

            // Clean up restore file
            @unlink($fullPath);

            if ($ok === 0) {
                return $this->error('Restore failed: no statements executed. ' . ($firstError ?? 'Check storage/logs/laravel.log for details.'), 500);
            }

            $msg = "Database restored. {$ok} statements applied";
            if ($skipped > 0) $msg .= ", {$skipped} skipped";
            return $this->success(['executed' => $ok, 'skipped' => $skipped], $msg);

        } catch (\Exception $e) {
            Log::error("Restore failed: " . $e->getMessage());

            DB::table('backup_history')->insert([
                'id' => Str::uuid(),
                'file_name' => $originalName,
                'backup_type' => 'restore',
                'format' => 'sql',
                'status' => 'failed',
                'error_message' => $e->getMessage(),
                'created_at' => now(),
            ]);

            return $this->error('Restore failed: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Delete a backup record and its file.
     */
    public function destroy(string $id, Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can delete backups.', 403);
        }

        $record = DB::table('backup_history')->where('id', $id)->first();
        if (!$record) {
            return $this->error('Backup not found.', 404);
        }

        // Delete file from disk
        if ($record->storage_path) {
            $fullPath = storage_path('app/' . $record->storage_path);
            if (file_exists($fullPath)) @unlink($fullPath);
        }

        DB::table('backup_history')->where('id', $id)->delete();

        return $this->success(null, 'Backup deleted');
    }

    /**
     * Get/update backup settings.
     */
    public function settings(Request $request): JsonResponse
    {
        if ($request->isMethod('get')) {
            $settings = DB::table('backup_settings')->where('id', 'default')->first();
            if (!$settings) {
                // Create default settings
                DB::table('backup_settings')->insert([
                    'id' => 'default',
                    'auto_backup_enabled' => false,
                    'schedule_interval' => 'daily',
                    'retention_days' => 30,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $settings = DB::table('backup_settings')->where('id', 'default')->first();
            }
            return $this->success($settings);
        }

        // Update settings
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can update settings.', 403);
        }

        $data = $request->validate([
            'auto_backup_enabled' => 'nullable|boolean',
            'schedule_interval' => 'nullable|in:hourly,daily,weekly',
            'retention_days' => 'nullable|integer|min:1|max:365',
        ]);

        DB::table('backup_settings')->where('id', 'default')->update(array_merge(
            array_filter($data, fn($v) => !is_null($v)),
            ['updated_by' => $request->user()->id, 'updated_at' => now()]
        ));

        return $this->success(null, 'Settings updated');
    }

    private function tryMysqlRestore(string $path): bool
    {
        $mysql = $this->findMysql();
        if (!$mysql) return false;

        $host = config('database.connections.mysql.host');
        $port = config('database.connections.mysql.port', 3306);
        $database = config('database.connections.mysql.database');
        $username = config('database.connections.mysql.username');
        $password = config('database.connections.mysql.password');

        $passArg = $password ? "--password=" . escapeshellarg($password) : "";
        $cmd = sprintf(
            '%s --force --user=%s %s --host=%s --port=%d %s < %s 2>&1',
            escapeshellarg($mysql),
            escapeshellarg($username),
            $passArg,
            escapeshellarg($host),
            $port,
            escapeshellarg($database),
            escapeshellarg($path)
        );

        exec($cmd, $output, $returnCode);
        return $returnCode === 0;
    }

    private function findMysql(): ?string
    {
        $paths = ['mysql', '/usr/bin/mysql', '/usr/local/bin/mysql', '/usr/local/mysql/bin/mysql'];
        foreach ($paths as $p) {
            exec("which {$p} 2>/dev/null", $out, $code);
            if ($code === 0) return trim($out[0] ?? $p);
        }
        return null;
    }

    /**
     * Execute a .sql backup in pure PHP. Returns [ok, skipped, firstError].
     */
    private function phpSqlRestore(string $path): array
    {
        $sql = file_get_contents($path);
        if ($sql === false || $sql === '') throw new \RuntimeException("Cannot read SQL file or file is empty");

        // Strip dump comments. The statement splitter below still protects
        // semicolons inside quoted values, so JSON/text fields are safe.
        $sql = preg_replace('/^\s*--.*$/m', '', $sql);
        $sql = preg_replace('/\/\*.*?\*\//s', '', $sql);

        $statements = $this->splitSqlStatements($sql);

        $errors = [];
        $firstError = null;
        $ok = 0;

        try {
            DB::statement('SET FOREIGN_KEY_CHECKS = 0');

            foreach ($statements as $stmt) {
                $stmt = trim($stmt);
                if ($stmt === '' || stripos($stmt, 'SET FOREIGN_KEY_CHECKS') === 0) continue;

                try {
                    if (preg_match('/^\s*(INSERT|REPLACE)\s+INTO\s+/i', $stmt)) {
                        $ok += $this->restoreInsertStatement($stmt);
                    } else {
                        // Same-app Laravel backups contain DROP/CREATE statements.
                        // Execute those normally; imported Supabase/Lovable backups
                        // are handled through the column-filtered INSERT path above.
                        DB::unprepared(rtrim($stmt, ';') . ';');
                        $ok++;
                    }
                } catch (\Throwable $e) {
                    $msg = $e->getMessage();
                    if ($firstError === null) $firstError = $msg;
                    $errors[] = substr($msg, 0, 200);
                    if (count($errors) <= 20) {
                        Log::warning("Restore stmt failed: " . $msg);
                    }
                }
            }
        } finally {
            DB::statement('SET FOREIGN_KEY_CHECKS = 1');
        }

        Log::info("Restore: {$ok} statements ok, " . count($errors) . " skipped");

        return [$ok, count($errors), $firstError];
    }

    private function splitSqlStatements(string $sql): array
    {
        $statements = [];
        $buffer = '';
        $quote = null;
        $escaped = false;
        $len = strlen($sql);

        for ($i = 0; $i < $len; $i++) {
            $ch = $sql[$i];
            $buffer .= $ch;

            if ($escaped) {
                $escaped = false;
                continue;
            }
            if ($quote !== null && $ch === '\\') {
                $escaped = true;
                continue;
            }
            if ($ch === "'" || $ch === '"' || $ch === '`') {
                if ($quote === null) {
                    $quote = $ch;
                } elseif ($quote === $ch) {
                    if ($ch === "'" && $i + 1 < $len && $sql[$i + 1] === "'") {
                        $buffer .= $sql[++$i];
                        continue;
                    }
                    $quote = null;
                }
                continue;
            }
            if ($ch === ';' && $quote === null) {
                $statements[] = trim(substr($buffer, 0, -1));
                $buffer = '';
            }
        }

        $tail = trim($buffer);
        if ($tail !== '') $statements[] = $tail;
        return $statements;
    }

    private function restoreInsertStatement(string $stmt): int
    {
        if (!preg_match('/^\s*(?:INSERT|REPLACE)\s+INTO\s+`?([A-Za-z0-9_]+)`?\s*(?:\((.*?)\))?\s+VALUES\s*(.+?)(?:\s+ON\s+DUPLICATE\s+KEY\s+UPDATE\s+.*)?\s*$/is', $stmt, $m)) {
            throw new \RuntimeException('Unsupported SQL INSERT format');
        }

        $sourceTable = $m[1];
        $columns = isset($m[2]) && trim($m[2]) !== ''
            ? $this->parseSqlIdentifiers($m[2])
            : (Schema::hasTable($sourceTable) ? Schema::getColumnListing($sourceTable) : []);
        $rows = $this->parseSqlValueRows($m[3]);
        $applied = 0;

        foreach ($rows as $values) {
            if (count($columns) !== count($values)) {
                throw new \RuntimeException("Column/value count mismatch for {$sourceTable}");
            }

            $row = array_combine($columns, $values);
            [$targetTable, $mapped] = $this->mapRestoreRow($sourceTable, $row);
            if (!$targetTable || !$mapped || !Schema::hasTable($targetTable)) continue;

            $targetCols = Schema::getColumnListing($targetTable);
            $clean = array_intersect_key($mapped, array_flip($targetCols));
            if (!$clean) continue;

            if ($targetTable === 'users' && empty($clean['password']) && in_array('password', $targetCols, true)) {
                $clean['password'] = Hash::make('Admin@123');
            }

            $key = array_key_exists('id', $clean) ? ['id' => $clean['id']] : null;
            if (!$key && $targetTable === 'number_sequences' && array_key_exists('id', $clean)) {
                $key = ['id' => $clean['id']];
            }

            if ($key) {
                DB::table($targetTable)->updateOrInsert($key, $clean);
            } else {
                DB::table($targetTable)->insertOrIgnore($clean);
            }
            $applied++;
        }

        return $applied;
    }

    private function mapRestoreRow(string $table, array $row): array
    {
        // Lovable/Supabase backups export auth-facing users as `profiles`,
        // while the VPS app stores them in Laravel's `users` table.
        if ($table === 'profiles' && Schema::hasTable('users')) {
            $existingPassword = !empty($row['id']) ? DB::table('users')->where('id', $row['id'])->value('password') : null;
            return ['users', [
                'id' => $row['id'] ?? (string) Str::uuid(),
                'username' => $row['username'] ?? $row['email'] ?? ('user_' . Str::random(8)),
                'name' => $row['name'] ?? $row['username'] ?? $row['email'] ?? 'Restored User',
                'email' => $row['email'] ?? null,
                'phone' => $row['phone'] ?? null,
                'branch_id' => $row['branch_id'] ?? null,
                'employee_id' => $row['employee_id'] ?? null,
                'status' => $row['status'] ?? 'active',
                'is_online' => 0,
                'last_seen_at' => $row['last_seen_at'] ?? null,
                'password' => $existingPassword ?: Hash::make('Admin@123'),
                'created_at' => $row['created_at'] ?? now(),
                'updated_at' => $row['updated_at'] ?? now(),
                'deleted_at' => $row['deleted_at'] ?? null,
            ]];
        }

        if ($table === 'user_roles' && !Schema::hasTable('user_roles')) {
            return [null, []];
        }

        foreach ($row as $key => $value) {
            if (is_array($value) || is_object($value)) $row[$key] = json_encode($value);
        }

        return [$table, $row];
    }

    private function parseSqlIdentifiers(string $csv): array
    {
        return array_map(fn ($c) => trim(trim($c), " `\"'"), explode(',', $csv));
    }

    private function parseSqlValueRows(string $valuesPart): array
    {
        $rows = [];
        $buffer = '';
        $depth = 0;
        $quote = null;
        $escaped = false;
        $len = strlen($valuesPart);

        for ($i = 0; $i < $len; $i++) {
            $ch = $valuesPart[$i];

            if ($escaped) {
                $buffer .= $ch;
                $escaped = false;
                continue;
            }
            if ($quote !== null && $ch === '\\') {
                $buffer .= $ch;
                $escaped = true;
                continue;
            }
            if ($ch === "'" || $ch === '"') {
                $buffer .= $ch;
                if ($quote === null) $quote = $ch;
                elseif ($quote === $ch) $quote = null;
                continue;
            }
            if ($quote === null && $ch === '(') {
                if ($depth++ > 0) $buffer .= $ch;
                continue;
            }
            if ($quote === null && $ch === ')') {
                if (--$depth === 0) {
                    $rows[] = $this->parseSqlRowValues($buffer);
                    $buffer = '';
                    continue;
                }
            }
            if ($depth > 0) $buffer .= $ch;
        }

        return $rows;
    }

    private function parseSqlRowValues(string $row): array
    {
        $values = [];
        $buffer = '';
        $quote = null;
        $escaped = false;
        $quoted = false;
        $len = strlen($row);

        for ($i = 0; $i < $len; $i++) {
            $ch = $row[$i];
            if ($escaped) {
                $buffer .= match ($ch) {
                    'n' => "\n", 'r' => "\r", 't' => "\t", '0' => "\0",
                    default => $ch,
                };
                $escaped = false;
                continue;
            }
            if ($quote !== null && $ch === '\\') {
                $escaped = true;
                continue;
            }
            if ($ch === "'" || $ch === '"') {
                if ($quote === null) {
                    $quote = $ch;
                    $quoted = true;
                    continue;
                }
                if ($quote === $ch) {
                    if ($ch === "'" && $i + 1 < $len && $row[$i + 1] === "'") {
                        $buffer .= "'";
                        $i++;
                        continue;
                    }
                    $quote = null;
                    continue;
                }
            }
            if ($ch === ',' && $quote === null) {
                $values[] = $this->convertSqlValue($buffer, $quoted);
                $buffer = '';
                $quoted = false;
                continue;
            }
            $buffer .= $ch;
        }

        $values[] = $this->convertSqlValue($buffer, $quoted);
        return $values;
    }

    private function convertSqlValue(string $value, bool $quoted): mixed
    {
        $value = trim($value);
        if (!$quoted) {
            if (strcasecmp($value, 'NULL') === 0 || $value === '\\N') return null;
            if (is_numeric($value)) return str_contains($value, '.') ? (float) $value : (int) $value;
        }
        return $value;
    }
}

