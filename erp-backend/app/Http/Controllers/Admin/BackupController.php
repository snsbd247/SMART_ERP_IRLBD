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
     * Create a new SQL or JSON backup.
     */
    public function create(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can create backups.', 403);
        }

        $format = strtolower((string) $request->input('format', 'sql'));
        if (!in_array($format, ['sql', 'json'], true)) $format = 'sql';
        $uploadDrive = (bool) $request->input('upload_to_drive', false);

        try {
            $exitCode = Artisan::call('backup:database', [
                '--type' => 'manual',
                '--format' => $format,
                '--gdrive' => $uploadDrive ? 'yes' : 'no',
            ]);

            if ($exitCode !== 0) {
                return $this->error('Backup command failed.', 500);
            }

            $latest = DB::table('backup_history')->orderByDesc('created_at')->first();
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

        $mime = ($record->format ?? 'sql') === 'json' ? 'application/json' : 'application/sql';
        return response()->download($fullPath, $record->file_name, ['Content-Type' => $mime]);
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
            'sql_file' => 'required|file|max:5242880', // 5GB max (in KB)
        ]);

        @ini_set('memory_limit', '-1');
        @ini_set('upload_max_filesize', '5120M');
        @ini_set('post_max_size', '5120M');
        @ini_set('max_input_time', '-1');
        @ini_set('max_execution_time', '0');
        @set_time_limit(0);

        $file = $request->file('sql_file');
        $originalName = $file->getClientOriginalName();
        $uploadedSize = (int) @filesize($file->getRealPath());

        $isJson = Str::endsWith(strtolower($originalName), '.json');
        $isSql  = Str::endsWith(strtolower($originalName), '.sql');
        if (!$isJson && !$isSql) {
            return $this->error('Only .sql or .json backup files are allowed.', 422);
        }
        $format = $isJson ? 'json' : 'sql';

        try {
            $backupsDir = storage_path('app/backups');
            if (!is_dir($backupsDir)) @mkdir($backupsDir, 0775, true);

            $fileName = 'restore_' . date('Y_m_d_H_i_s') . '.' . $format;
            $fullPath = $backupsDir . '/' . $fileName;
            $path = 'backups/' . $fileName;

            if (!@move_uploaded_file($file->getRealPath(), $fullPath)) {
                $stored = $file->storeAs('backups', $fileName, 'local');
                if (!$stored) throw new \RuntimeException('Failed to save uploaded file to ' . $fullPath);
                $fullPath = Storage::disk('local')->path($stored);
                $path = $stored;
            }

            if (!file_exists($fullPath)) {
                throw new \RuntimeException('Uploaded file not found at ' . $fullPath);
            }

            if ($isJson) {
                [$ok, $skipped, $firstError] = $this->phpJsonRestore($fullPath);
            } else {
                [$ok, $skipped, $firstError] = $this->phpSqlRestore($fullPath);
            }

            DB::table('backup_history')->insert([
                'id' => Str::uuid(),
                'file_name' => $originalName,
                'backup_type' => 'restore',
                'format' => $format,
                'status' => $ok > 0 ? 'completed' : 'failed',
                'file_size' => $uploadedSize ?: @filesize($fullPath) ?: 0,
                'storage_path' => $path,
                'records_count' => $ok,
                'error_message' => $skipped > 0 ? "Skipped {$skipped} statements. First: " . substr((string) $firstError, 0, 300) : null,
                'created_at' => now(),
            ]);

            @unlink($fullPath);

            if ($ok === 0) {
                return $this->error('Restore failed: no rows applied. ' . ($firstError ?? 'Check storage/logs/laravel.log for details.'), 500);
            }

            $msg = "Database restored. {$ok} rows applied";
            if ($skipped > 0) $msg .= ", {$skipped} skipped";
            return $this->success(['executed' => $ok, 'skipped' => $skipped, 'format' => $format], $msg);

        } catch (\Exception $e) {
            Log::error("Restore failed: " . $e->getMessage());

            DB::table('backup_history')->insert([
                'id' => Str::uuid(),
                'file_name' => $originalName,
                'backup_type' => 'restore',
                'format' => $format,
                'status' => 'failed',
                'error_message' => $e->getMessage(),
                'created_at' => now(),
            ]);

            return $this->error('Restore failed: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Restore from a JSON dump produced by `backup:database --format=json`.
     * Returns [ok, skipped, firstError].
     */
    private function phpJsonRestore(string $path): array
    {
        $raw = file_get_contents($path);
        if ($raw === false || $raw === '') throw new \RuntimeException('Cannot read JSON file or it is empty');
        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['tables']) || !is_array($data['tables'])) {
            throw new \RuntimeException('Invalid JSON backup format (missing "tables")');
        }

        $ok = 0; $skipped = 0; $firstError = null;
        try {
            DB::statement('SET FOREIGN_KEY_CHECKS = 0');
            foreach ($data['tables'] as $table => $rows) {
                if (!is_string($table) || !is_array($rows) || !Schema::hasTable($table)) continue;
                $cols = Schema::getColumnListing($table);
                foreach ($rows as $row) {
                    if (!is_array($row)) { $skipped++; continue; }
                    $clean = array_intersect_key($row, array_flip($cols));
                    if (!$clean) { $skipped++; continue; }
                    try {
                        if (array_key_exists('id', $clean)) {
                            DB::table($table)->updateOrInsert(['id' => $clean['id']], $clean);
                        } else {
                            DB::table($table)->insert($clean);
                        }
                        $ok++;
                    } catch (\Throwable $e) {
                        $skipped++;
                        if ($firstError === null) $firstError = $e->getMessage();
                    }
                }
            }
        } finally {
            DB::statement('SET FOREIGN_KEY_CHECKS = 1');
        }

        Log::info("JSON restore: {$ok} rows ok, {$skipped} skipped");
        return [$ok, $skipped, $firstError];
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
            // Mask secrets but indicate whether they are configured
            $payload = (array) $settings;
            $payload['gdrive_client_secret_set'] = !empty($payload['gdrive_client_secret'] ?? null);
            $payload['gdrive_refresh_token_set'] = !empty($payload['gdrive_refresh_token'] ?? null);
            unset($payload['gdrive_client_secret'], $payload['gdrive_refresh_token']);
            return $this->success($payload);
        }

        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can update settings.', 403);
        }

        $data = $request->validate([
            'auto_backup_enabled' => 'nullable|boolean',
            'schedule_interval' => 'nullable|in:hourly,daily,weekly',
            'retention_days' => 'nullable|integer|min:1|max:365',
            'gdrive_enabled' => 'nullable|boolean',
            'gdrive_client_id' => 'nullable|string|max:500',
            'gdrive_client_secret' => 'nullable|string|max:500',
            'gdrive_refresh_token' => 'nullable|string|max:2000',
            'gdrive_folder_id' => 'nullable|string|max:200',
            'gdrive_format' => 'nullable|in:sql,json',
        ]);

        // Only update fields that were actually provided so blank inputs don't wipe secrets
        $update = [];
        foreach ($data as $k => $v) {
            if ($request->exists($k) && $v !== null && $v !== '') {
                $update[$k] = $v;
            } elseif ($request->exists($k) && in_array($k, ['auto_backup_enabled', 'gdrive_enabled'], true)) {
                $update[$k] = (bool) $v ? 1 : 0;
            }
        }
        $update['updated_by'] = $request->user()->id;
        $update['updated_at'] = now();

        DB::table('backup_settings')->where('id', 'default')->update($update);
        return $this->success(null, 'Settings updated');
    }

    /**
     * Test Google Drive credentials without persisting them.
     */
    public function gdriveTest(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can test Google Drive.', 403);
        }
        $data = $request->validate([
            'client_id' => 'nullable|string',
            'client_secret' => 'nullable|string',
            'refresh_token' => 'nullable|string',
            'folder_id' => 'nullable|string',
        ]);
        // Fall back to saved values for fields the form left blank
        $saved = DB::table('backup_settings')->where('id', 'default')->first();
        try {
            $svc = new \App\Services\GoogleDriveService(
                $data['client_id'] ?: ($saved->gdrive_client_id ?? ''),
                $data['client_secret'] ?: ($saved->gdrive_client_secret ?? ''),
                $data['refresh_token'] ?: ($saved->gdrive_refresh_token ?? ''),
                $data['folder_id'] ?? ($saved->gdrive_folder_id ?? null),
            );
            $info = $svc->test();
            return $this->success([
                'user' => $info['user'] ?? null,
                'storageQuota' => $info['storageQuota'] ?? null,
            ], 'Google Drive credentials are valid');
        } catch (\Throwable $e) {
            return $this->error('Google Drive test failed: ' . $e->getMessage(), 422);
        }
    }

    /**
     * Upload an existing backup file (by history id) to Google Drive on demand.
     */
    public function gdriveUpload(string $id, Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can upload to Google Drive.', 403);
        }
        $record = DB::table('backup_history')->where('id', $id)->first();
        if (!$record || !$record->storage_path) return $this->error('Backup not found.', 404);
        $full = storage_path('app/' . $record->storage_path);
        if (!file_exists($full)) return $this->error('Backup file missing on disk.', 404);

        $settings = DB::table('backup_settings')->where('id', 'default')->first();
        try {
            $svc = \App\Services\GoogleDriveService::fromSettings($settings);
            $mime = ($record->format ?? 'sql') === 'json' ? 'application/json' : 'application/sql';
            $meta = $svc->upload($full, $record->file_name, $mime);
            DB::table('backup_settings')->where('id', 'default')->update([
                'last_gdrive_backup_at' => now(),
                'last_gdrive_error' => null,
            ]);
            return $this->success($meta, 'Uploaded to Google Drive');
        } catch (\Throwable $e) {
            DB::table('backup_settings')->where('id', 'default')->update([
                'last_gdrive_error' => substr($e->getMessage(), 0, 500),
            ]);
            return $this->error('Upload failed: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Build the Google OAuth consent URL for connecting a Drive account.
     * Requires the Client ID/Secret to already be saved via settings().
     */
    public function gdriveAuthUrl(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can connect Google Drive.', 403);
        }
        $settings = DB::table('backup_settings')->where('id', 'default')->first();
        $clientId = $settings->gdrive_client_id ?? '';
        if (!$clientId) {
            return $this->error('Save a Google OAuth Client ID first.', 422);
        }
        $redirectUri = $this->gdriveRedirectUri($request);
        $state = $this->signGdriveState();
        $url = \App\Services\GoogleDriveService::authUrl($clientId, $redirectUri, $state);
        return $this->success(['url' => $url]);
    }

    /**
     * Google redirects the admin's browser here after consent. Public route
     * (see routes/api.php) — protected by the signed `state` param instead
     * of auth:sanctum, since Google's redirect carries no Authorization
     * header. Ends with a redirect back into the SPA's Backup page.
     */
    public function gdriveCallback(Request $request)
    {
        $back = fn (string $q) => redirect($request->getSchemeAndHttpHost() . '/admin/backup?' . $q);

        if (!$this->verifyGdriveState((string) $request->query('state', ''))) {
            return $back('gdrive=error&message=' . urlencode('This connection request expired or is invalid. Please try again.'));
        }
        if ($request->query('error')) {
            return $back('gdrive=error&message=' . urlencode('Google sign-in was cancelled.'));
        }
        $code = (string) $request->query('code', '');
        if (!$code) {
            return $back('gdrive=error&message=' . urlencode('Google did not return an authorization code.'));
        }

        $settings = DB::table('backup_settings')->where('id', 'default')->first();
        $clientId = $settings->gdrive_client_id ?? '';
        $clientSecret = $settings->gdrive_client_secret ?? '';
        if (!$clientId || !$clientSecret) {
            return $back('gdrive=error&message=' . urlencode('Google OAuth Client ID/Secret are not configured.'));
        }

        try {
            $tokens = \App\Services\GoogleDriveService::exchangeCode($clientId, $clientSecret, $code, $this->gdriveRedirectUri($request));
            $refreshToken = $tokens['refresh_token'] ?? null;
            if (!$refreshToken) {
                return $back('gdrive=error&message=' . urlencode("Google didn't return a refresh token. Remove this app's access at myaccount.google.com/permissions and try connecting again."));
            }

            $svc = new \App\Services\GoogleDriveService($clientId, $clientSecret, $refreshToken);
            $info = $svc->test();
            $email = $info['user']['emailAddress'] ?? null;

            DB::table('backup_settings')->where('id', 'default')->update([
                'gdrive_refresh_token' => $refreshToken,
                'gdrive_account_email' => $email,
                'gdrive_enabled' => 1,
                'last_gdrive_error' => null,
                'updated_at' => now(),
            ]);

            return $back('gdrive=connected');
        } catch (\Throwable $e) {
            Log::error('GDrive OAuth callback failed: ' . $e->getMessage());
            return $back('gdrive=error&message=' . urlencode($e->getMessage()));
        }
    }

    /**
     * List folders directly under the given parent (Drive root if omitted)
     * for the folder-picker UI.
     */
    public function gdriveFolders(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can browse Google Drive.', 403);
        }
        $settings = DB::table('backup_settings')->where('id', 'default')->first();
        if (!$settings || !$settings->gdrive_refresh_token) {
            return $this->error('Google Drive is not connected yet.', 422);
        }
        try {
            $svc = \App\Services\GoogleDriveService::fromSettings($settings);
            $folders = $svc->listFolders($request->query('parent_id') ?: null);
            return $this->success($folders);
        } catch (\Throwable $e) {
            return $this->error('Failed to list folders: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Create a new folder from the folder-picker UI.
     */
    public function gdriveCreateFolder(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can manage Google Drive folders.', 403);
        }
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'parent_id' => 'nullable|string|max:200',
        ]);
        $settings = DB::table('backup_settings')->where('id', 'default')->first();
        if (!$settings || !$settings->gdrive_refresh_token) {
            return $this->error('Google Drive is not connected yet.', 422);
        }
        try {
            $svc = \App\Services\GoogleDriveService::fromSettings($settings);
            $folder = $svc->createFolder($data['name'], $data['parent_id'] ?? null);
            return $this->success($folder, 'Folder created');
        } catch (\Throwable $e) {
            return $this->error('Failed to create folder: ' . $e->getMessage(), 500);
        }
    }

    /**
     * Save which Drive folder future backups should upload to.
     */
    public function gdriveSelectFolder(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can select the backup folder.', 403);
        }
        $data = $request->validate([
            'folder_id' => 'required|string|max:200',
            'folder_name' => 'required|string|max:255',
        ]);
        DB::table('backup_settings')->where('id', 'default')->update([
            'gdrive_folder_id' => $data['folder_id'],
            'gdrive_folder_name' => $data['folder_name'],
            'updated_by' => $request->user()->id,
            'updated_at' => now(),
        ]);
        return $this->success(null, 'Backup folder updated');
    }

    /**
     * Disconnect the currently connected Google account (keeps the saved
     * Client ID/Secret, only clears the per-account token + folder).
     */
    public function gdriveDisconnect(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can disconnect Google Drive.', 403);
        }
        DB::table('backup_settings')->where('id', 'default')->update([
            'gdrive_refresh_token' => null,
            'gdrive_account_email' => null,
            'gdrive_folder_id' => null,
            'gdrive_folder_name' => null,
            'gdrive_enabled' => 0,
            'last_gdrive_error' => null,
            'updated_by' => $request->user()->id,
            'updated_at' => now(),
        ]);
        return $this->success(null, 'Google Drive disconnected');
    }

    private function gdriveRedirectUri(Request $request): string
    {
        return $request->getSchemeAndHttpHost() . '/api/v1/backups/gdrive/callback';
    }

    /**
     * Signs a short-lived, single-purpose token proving the OAuth callback
     * request followed an auth-url this server itself issued — the only
     * protection the public callback route has, since Google's redirect
     * carries no Authorization header for auth:sanctum to check.
     */
    private function signGdriveState(): string
    {
        $payload = base64_encode(json_encode(['ts' => time(), 'n' => Str::random(16)]));
        $sig = hash_hmac('sha256', $payload, config('app.key'));
        return $payload . '.' . $sig;
    }

    private function verifyGdriveState(string $state): bool
    {
        $parts = explode('.', $state, 2);
        if (count($parts) !== 2) return false;
        [$payload, $sig] = $parts;
        $expected = hash_hmac('sha256', $payload, config('app.key'));
        if (!hash_equals($expected, $sig)) return false;
        $decoded = json_decode(base64_decode($payload), true);
        if (!is_array($decoded) || empty($decoded['ts'])) return false;
        return (time() - (int) $decoded['ts']) < 600; // 10 minutes
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

            if ($this->isInsertOnlyBackup($sql)) {
                $this->resetTablesForInsertRestore();
            }

            foreach ($statements as $stmt) {
                $stmt = trim($stmt);
                if ($stmt === '' || stripos($stmt, 'SET FOREIGN_KEY_CHECKS') === 0) continue;

                try {
                    if (preg_match('/^\s*(INSERT|REPLACE)\s+INTO\s+/i', $stmt)) {
                        $ok += $this->restoreInsertStatement($stmt);
                    } else {
                        // Same-app Laravel backups contain DROP/CREATE statements.
                        // Execute those normally; rows from other backup formats
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

    private function isInsertOnlyBackup(string $sql): bool
    {
        return stripos($sql, 'CREATE TABLE') === false
            && preg_match('/\bINSERT\s+INTO\s+`?(profiles|branches|company_settings|chart_of_accounts|custom_roles)`?/i', $sql);
    }

    private function resetTablesForInsertRestore(): void
    {
        $tables = [
            'backup_history', 'messages', 'conversation_participants', 'conversations',
            'login_logs', 'user_activities', 'audit_log', 'page_shortcuts', 'module_settings', 'system_settings', 'backup_settings',
            'tds_entries', 'invoice_payments', 'invoice_challans', 'sales_invoice_items_v2', 'sales_invoices_v2',
            'ho_receives', 'customer_receives', 'delivery_challans', 'vat_challan_items', 'vat_challans',
            'invoice_status_logs',
            'po_amendments', 'purchase_order_items', 'purchase_orders',
            'payment_allocations', 'party_payments', 'party_notes',
            'fund_transactions', 'employee_fund_settings', 'payroll', 'overtime_records', 'leave_requests', 'attendance',
            'face_data', 'employee_documents', 'employee_bank_info', 'employee_education', 'employee_experience', 'employee_emergency_contacts', 'salary_structures',
            'production_materials', 'production_entries', 'bom_items', 'bill_of_materials', 'raw_materials',
            'purchase_return_items', 'purchase_returns', 'purchase_items', 'purchases',
            'sales_return_items', 'sales_returns', 'sales_invoice_items', 'sales_invoices',
            'stock_transfers', 'stock_ledger', 'stock_movements', 'warehouse_stock', 'products', 'product_categories', 'warehouses', 'item_master', 'item_categories', 'units',
            'voucher_entries', 'acc_vouchers', 'chart_of_accounts',
            'employees', 'users', 'user_custom_roles', 'role_permissions', 'custom_roles',
            'number_sequences', 'financial_years', 'company_settings', 'branches',
        ];

        foreach ($tables as $table) {
            if (Schema::hasTable($table)) {
                DB::table($table)->truncate();
            }
        }
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
        // Some backups carry auth-facing users as `profiles` rows (the
        // profiles view), while the app stores them in the `users` table.
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

