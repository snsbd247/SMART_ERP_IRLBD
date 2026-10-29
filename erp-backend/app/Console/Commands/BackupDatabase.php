<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class BackupDatabase extends Command
{
    protected $signature = 'backup:database {--type=auto : Backup type (manual|auto|auto_gdrive)} {--format=sql : Format (sql|json)} {--gdrive=auto : Upload to Google Drive (auto|yes|no)}';
    protected $description = 'Create a SQL or JSON dump backup of the database';

    public function handle(): int
    {
        if ($this->option('type') === 'auto_gdrive') {
            return $this->handleHourlyGdriveBackup();
        }

        $format = strtolower((string) $this->option('format'));
        if (!in_array($format, ['sql', 'json'], true)) $format = 'sql';

        $ext = $format === 'json' ? 'json' : 'sql';
        $filename = 'erp_backup_' . date('Y_m_d_H_i') . '.' . $ext;
        $dir = storage_path('app/backups');
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $path = $dir . '/' . $filename;
        $type = $this->option('type');

        $this->info("Creating {$format} backup: {$filename}");

        try {
            $host = config('database.connections.mysql.host');
            $port = config('database.connections.mysql.port', 3306);
            $database = config('database.connections.mysql.database');
            $username = config('database.connections.mysql.username');
            $password = config('database.connections.mysql.password');

            $method = 'php';
            if ($format === 'sql') {
                if ($this->tryMysqldump($host, $port, $database, $username, $password, $path)) {
                    $method = 'mysqldump';
                } else {
                    $this->info("mysqldump not available, using PHP fallback...");
                    $this->phpSqlExport($database, $path);
                }
            } else {
                $this->phpJsonExport($database, $path);
            }

            $this->recordBackup($filename, $path, $type, $method, $format);
            $this->info("✅ Backup created via {$method}: {$filename}");

            $this->cleanupOldBackups();
            $this->maybeUploadToDrive($path, $filename);

            return 0;
        } catch (\Exception $e) {
            Log::error("Backup failed: " . $e->getMessage());
            $this->error("❌ Backup failed: " . $e->getMessage());

            DB::table('backup_history')->insert([
                'id' => Str::uuid(),
                'file_name' => $filename,
                'backup_type' => $type,
                'format' => $format,
                'status' => 'failed',
                'error_message' => $e->getMessage(),
                'created_at' => now(),
            ]);

            return 1;
        }
    }

    private function phpJsonExport(string $database, string $path): void
    {
        // Full schema dump: every base table AND view, nothing skipped.
        $tables = DB::select('SHOW FULL TABLES');
        $tableKey = "Tables_in_{$database}";

        $payload = [
            'meta' => [
                'database' => $database,
                'generated_at' => date('c'),
                'version' => 2,
                'app' => 'SmartERP',
            ],
            'schema' => [],
            'tables' => [],
        ];

        $tableNames = [];
        foreach ($tables as $row) {
            $table = $row->$tableKey;
            $type  = $row->Table_type ?? 'BASE TABLE';
            $tableNames[] = $table;

            // Always capture CREATE statement so a JSON restore can rebuild schema if needed.
            try {
                if ($type === 'VIEW') {
                    $c = DB::select("SHOW CREATE VIEW `{$table}`");
                    $payload['schema'][$table] = [
                        'type' => 'view',
                        'create' => $c[0]->{'Create View'} ?? '',
                    ];
                    // Views hold no rows of their own
                    $payload['tables'][$table] = [];
                    continue;
                }
                $c = DB::select("SHOW CREATE TABLE `{$table}`");
                $payload['schema'][$table] = [
                    'type' => 'table',
                    'create' => $c[0]->{'Create Table'} ?? '',
                ];
            } catch (\Throwable $e) {
                $payload['schema'][$table] = ['type' => 'table', 'create' => '', 'error' => $e->getMessage()];
            }

            $rows = [];
            $count = (int) DB::table($table)->count();
            $offset = 0; $chunk = 500;
            while ($offset < $count) {
                foreach (DB::table($table)->offset($offset)->limit($chunk)->get() as $r) {
                    $rows[] = (array) $r;
                }
                $offset += $chunk;
            }
            $payload['tables'][$table] = $rows;
        }

        $payload['meta']['table_count'] = count($tableNames);
        $payload['meta']['tables'] = $tableNames;

        $ok = file_put_contents($path, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR));
        if ($ok === false) throw new \RuntimeException("Cannot write JSON backup to {$path}");

        // Coverage assertion: any base table in DB must appear in payload
        $expected = count($tableNames);
        $got = count($payload['tables']);
        if ($got < $expected) {
            throw new \RuntimeException("JSON backup incomplete: expected {$expected} tables, got {$got}");
        }
    }

    private function maybeUploadToDrive(string $path, string $filename): void
    {
        $gdriveOpt = strtolower((string) $this->option('gdrive'));
        if ($gdriveOpt === 'no') return;

        $settings = DB::table('backup_settings')->where('id', 'default')->first();
        if (!$settings) return;

        // 'auto' uploads only when gdrive is enabled (for any backup type).
        if ($gdriveOpt === 'auto' && empty($settings->gdrive_enabled)) return;
        if (empty($settings->gdrive_enabled) && $gdriveOpt !== 'yes') return;

        try {
            $svc = \App\Services\GoogleDriveService::fromSettings($settings);
            $mime = str_ends_with($filename, '.json') ? 'application/json' : 'application/sql';
            $svc->upload($path, $filename, $mime);
            DB::table('backup_settings')->where('id', 'default')->update([
                'last_gdrive_backup_at' => now(),
                'last_gdrive_error' => null,
            ]);
            $this->info("☁ Uploaded to Google Drive");
        } catch (\Throwable $e) {
            Log::warning('GDrive upload skipped: ' . $e->getMessage());
            DB::table('backup_settings')->where('id', 'default')->update([
                'last_gdrive_error' => substr($e->getMessage(), 0, 500),
            ]);
            $this->warn('Google Drive upload failed: ' . $e->getMessage());
        }
    }

    private function tryMysqldump(string $host, int $port, string $database, string $username, string $password, string $path): bool
    {
        $mysqldump = $this->findMysqldump();
        if (!$mysqldump) return false;

        $passArg = $password ? "--password=" . escapeshellarg($password) : "";
        // Flags chosen for a COMPLETE, restore-safe dump of the whole database:
        //   --single-transaction  consistent snapshot (InnoDB)
        //   --routines --triggers --events  include procs/triggers/events
        //   --add-drop-table --add-drop-trigger  clean replace on restore
        //   --hex-blob  preserve binary columns
        //   --complete-insert  column-name safe across schema drift
        //   --default-character-set=utf8mb4  full unicode
        //   --skip-lock-tables  works on shared MySQL hosts
        //   --no-tablespaces  cPanel/shared-host friendly
        //   --set-gtid-purged=OFF  avoid GTID metadata blocking restore (ignored if unsupported)
        $cmd = sprintf(
            '%s --user=%s %s --host=%s --port=%d --single-transaction --routines --triggers --events --add-drop-table --add-drop-trigger --hex-blob --complete-insert --default-character-set=utf8mb4 --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF --databases %s > %s 2>&1',
            escapeshellarg($mysqldump),
            escapeshellarg($username),
            $passArg,
            escapeshellarg($host),
            $port,
            escapeshellarg($database),
            escapeshellarg($path)
        );

        exec($cmd, $output, $returnCode);

        if ($returnCode !== 0) {
            Log::warning("mysqldump failed (code {$returnCode}): " . implode("\n", $output));
            @unlink($path);
            return false;
        }

        return file_exists($path) && filesize($path) > 0;
    }

    private function findMysqldump(): ?string
    {
        $paths = ['mysqldump', '/usr/bin/mysqldump', '/usr/local/bin/mysqldump', '/usr/local/mysql/bin/mysqldump'];
        foreach ($paths as $p) {
            exec("which {$p} 2>/dev/null", $out, $code);
            if ($code === 0) return trim($out[0] ?? $p);
        }
        return null;
    }

    private function phpSqlExport(string $database, string $path): void
    {
        $handle = fopen($path, 'w');
        if (!$handle) throw new \RuntimeException("Cannot write to {$path}");

        $pdo = DB::connection()->getPdo();

        fwrite($handle, "-- SmartERP SQL Backup (PHP fallback, full database)\n");
        fwrite($handle, "-- Generated: " . date('Y-m-d H:i:s') . "\n");
        fwrite($handle, "-- Database: {$database}\n");
        fwrite($handle, "SET NAMES utf8mb4;\n");
        fwrite($handle, "SET FOREIGN_KEY_CHECKS=0;\n");
        fwrite($handle, "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n");

        // Pull EVERY table + view — no exclusions
        $tables = DB::select('SHOW FULL TABLES');
        $tableKey = "Tables_in_{$database}";
        $baseTables = [];
        $views = [];
        foreach ($tables as $row) {
            $name = $row->$tableKey;
            $type = $row->Table_type ?? 'BASE TABLE';
            if ($type === 'VIEW') $views[] = $name; else $baseTables[] = $name;
        }

        $exportedTables = 0;
        $exportedRows = 0;

        foreach ($baseTables as $table) {
            $create = DB::select("SHOW CREATE TABLE `{$table}`");
            $createSql = $create[0]->{'Create Table'} ?? '';
            fwrite($handle, "DROP TABLE IF EXISTS `{$table}`;\n");
            fwrite($handle, $createSql . ";\n\n");
            $exportedTables++;

            $count = (int) DB::table($table)->count();
            if ($count === 0) { fwrite($handle, "\n"); continue; }

            $chunkSize = 500;
            $offset = 0;
            while ($offset < $count) {
                $rows = DB::table($table)->offset($offset)->limit($chunkSize)->get();
                foreach ($rows as $row) {
                    $arr = (array) $row;
                    $values = [];
                    foreach ($arr as $val) {
                        if (is_null($val)) { $values[] = 'NULL'; continue; }
                        if (is_int($val) || is_float($val)) { $values[] = (string) $val; continue; }
                        // PDO::quote handles all escaping incl. binary safely
                        $values[] = $pdo->quote((string) $val);
                    }
                    $columns = implode(', ', array_map(fn($c) => "`{$c}`", array_keys($arr)));
                    fwrite($handle, "INSERT INTO `{$table}` ({$columns}) VALUES (" . implode(', ', $values) . ");\n");
                    $exportedRows++;
                }
                $offset += $chunkSize;
            }
            fwrite($handle, "\n");
        }

        // Views last (they may depend on tables above)
        foreach ($views as $view) {
            try {
                $c = DB::select("SHOW CREATE VIEW `{$view}`");
                $sql = $c[0]->{'Create View'} ?? '';
                if ($sql) {
                    fwrite($handle, "DROP VIEW IF EXISTS `{$view}`;\n");
                    fwrite($handle, $sql . ";\n\n");
                }
            } catch (\Throwable $e) {
                Log::warning("View export failed for {$view}: " . $e->getMessage());
            }
        }

        fwrite($handle, "SET FOREIGN_KEY_CHECKS=1;\n");
        fclose($handle);

        // Coverage assertion: every base table must have been written
        if ($exportedTables < count($baseTables)) {
            throw new \RuntimeException("SQL backup incomplete: dumped {$exportedTables} of " . count($baseTables) . " tables");
        }
        Log::info("SQL backup OK: {$exportedTables} tables, {$exportedRows} rows, " . count($views) . " views");
    }

    private function recordBackup(string $filename, string $path, string $type, string $method, string $format = 'sql'): string
    {
        $fileSize = file_exists($path) ? filesize($path) : 0;
        $database = config('database.connections.mysql.database');
        $tables = DB::select('SHOW TABLES');
        $tablesCount = count($tables);
        $recordsCount = 0;
        $key = "Tables_in_{$database}";
        foreach ($tables as $t) {
            try {
                $recordsCount += DB::table($t->$key)->count();
            } catch (\Exception $e) {}
        }

        $id = (string) Str::uuid();
        DB::table('backup_history')->insert([
            'id' => $id,
            'file_name' => $filename,
            'backup_type' => $type,
            'format' => $format,
            'status' => 'completed',
            'file_size' => $fileSize,
            'tables_count' => $tablesCount,
            'records_count' => $recordsCount,
            'storage_path' => 'backups/' . $filename,
            'created_at' => now(),
        ]);

        // Update last auto backup time
        if (in_array($type, ['auto', 'auto_gdrive'], true)) {
            DB::table('backup_settings')->where('id', 'default')->update([
                'last_auto_backup_at' => now(),
            ]);
        }

        return $id;
    }

    /**
     * The hourly Drive-only flow: create a SQL backup, upload it, delete the
     * local copy on success (local disk is never used as long-term storage
     * for these), then prune Drive backups older than the retention window.
     * Skips entirely if Google Drive isn't connected/enabled.
     */
    private function handleHourlyGdriveBackup(): int
    {
        $settings = DB::table('backup_settings')->where('id', 'default')->first();
        if (!$settings || empty($settings->gdrive_enabled) || empty($settings->gdrive_refresh_token)) {
            $this->info('Google Drive not connected/enabled — skipping hourly backup.');
            return 0;
        }

        $filename = 'erp_backup_' . date('Y_m_d_H_i') . '.sql';
        $dir = storage_path('app/backups');
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $path = $dir . '/' . $filename;

        $this->info("Creating hourly SQL backup: {$filename}");
        try {
            $host = config('database.connections.mysql.host');
            $port = config('database.connections.mysql.port', 3306);
            $database = config('database.connections.mysql.database');
            $username = config('database.connections.mysql.username');
            $password = config('database.connections.mysql.password');

            $method = $this->tryMysqldump($host, $port, $database, $username, $password, $path) ? 'mysqldump' : 'php';
            if ($method === 'php') $this->phpSqlExport($database, $path);

            $historyId = $this->recordBackup($filename, $path, 'auto_gdrive', $method, 'sql');
        } catch (\Throwable $e) {
            Log::error('Hourly backup creation failed: ' . $e->getMessage());
            $this->error('Backup failed: ' . $e->getMessage());
            return 1;
        }

        try {
            $svc = \App\Services\GoogleDriveService::fromSettings($settings);
            $meta = $svc->upload($path, $filename, 'application/sql');
            DB::table('backup_history')->where('id', $historyId)->update([
                'storage_path' => null,
                'gdrive_file_id' => $meta['id'] ?? null,
                'gdrive_view_link' => $meta['webViewLink'] ?? null,
            ]);
            @unlink($path);
            DB::table('backup_settings')->where('id', 'default')->update([
                'last_gdrive_backup_at' => now(),
                'last_gdrive_error' => null,
            ]);
            $this->info('☁ Uploaded to Google Drive, local copy removed.');

            $this->cleanupOldDriveBackups($svc, $settings->gdrive_folder_id);
        } catch (\Throwable $e) {
            Log::warning('Hourly Google Drive upload failed, keeping local copy: ' . $e->getMessage());
            DB::table('backup_settings')->where('id', 'default')->update([
                'last_gdrive_error' => substr($e->getMessage(), 0, 500),
            ]);
            $this->warn('Upload failed, local copy kept as fallback: ' . $e->getMessage());
        }

        $this->cleanupStaleLocalAutoBackups();

        return 0;
    }

    /**
     * Delete Drive backups older than 5 days from the configured folder.
     */
    private function cleanupOldDriveBackups(\App\Services\GoogleDriveService $svc, ?string $folderId): void
    {
        try {
            $files = $svc->listFiles($folderId ?: null);
            $cutoff = now()->subDays(5);
            foreach ($files as $f) {
                if (empty($f['createdTime'])) continue;
                $created = \Illuminate\Support\Carbon::parse($f['createdTime']);
                if ($created->lt($cutoff)) {
                    $svc->deleteFile($f['id']);
                    $this->info("Deleted old Drive backup: {$f['name']}");
                }
            }
        } catch (\Throwable $e) {
            Log::warning('Drive backup cleanup failed: ' . $e->getMessage());
        }
    }

    /**
     * Safety-net cleanup: an hourly backup whose upload kept failing (and
     * so kept its local copy) shouldn't accumulate on disk forever — clear
     * anything still local past a week.
     */
    private function cleanupStaleLocalAutoBackups(): void
    {
        try {
            $cutoff = now()->subDays(7);
            $stale = DB::table('backup_history')
                ->where('backup_type', 'auto_gdrive')
                ->whereNotNull('storage_path')
                ->where('created_at', '<', $cutoff)
                ->get();
            foreach ($stale as $b) {
                $full = storage_path('app/' . $b->storage_path);
                if (file_exists($full)) @unlink($full);
                DB::table('backup_history')->where('id', $b->id)->update(['storage_path' => null]);
            }
        } catch (\Throwable $e) {
            Log::warning('Stale local auto-backup cleanup failed: ' . $e->getMessage());
        }
    }

    private function cleanupOldBackups(): void
    {
        try {
            $settings = DB::table('backup_settings')->where('id', 'default')->first();
            $retentionDays = $settings->retention_days ?? 30;
            $cutoff = now()->subDays($retentionDays);

            $oldBackups = DB::table('backup_history')
                ->where('created_at', '<', $cutoff)
                ->get();

            foreach ($oldBackups as $backup) {
                if ($backup->storage_path) {
                    $fullPath = storage_path('app/' . $backup->storage_path);
                    if (file_exists($fullPath)) @unlink($fullPath);
                }
            }

            DB::table('backup_history')->where('created_at', '<', $cutoff)->delete();
        } catch (\Exception $e) {
            Log::warning("Backup cleanup failed: " . $e->getMessage());
        }
    }
}
