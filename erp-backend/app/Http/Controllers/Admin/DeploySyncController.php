<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Artisan;

/**
 * GitHub Deploy Sync — Super Admin only.
 * Features: configurable settings, diff viewer, dry-run, async jobs, auto-migrate,
 * audit log, multi-backup restore, job log export, GitHub test-connection.
 */
class DeploySyncController extends BaseController
{
    private string $apiBase = 'https://api.github.com';

    private array $syncPaths = [
        'erp-backend/app', 'erp-backend/config', 'erp-backend/database/migrations',
        'erp-backend/database/seeders', 'erp-backend/routes', 'erp-backend/resources/views',
        'erp-backend/composer.json', 'erp-backend/composer.lock', 'erp-backend/artisan',
    ];
    private array $protectedPaths = [
        '.env', 'erp-backend/.env', 'erp-backend/vendor', 'erp-backend/storage',
        'erp-backend/.git', 'erp-backend/node_modules', 'erp-backend/public/storage',
    ];

    private function guard(Request $r) {
        $u = $r->user();
        if (!$u || !$u->isSuperAdmin()) abort(403, 'Super Admin access required');
    }

    private function projectRoot(): string { return dirname(base_path()); }

    private function getSettings(): array
    {
        $row = DB::table('deploy_sync_settings')->first();
        if (!$row) {
            DB::table('deploy_sync_settings')->insert([
                'owner' => 'snsbd247', 'repo' => 'smart_accounting', 'branch' => 'main',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $row = DB::table('deploy_sync_settings')->first();
        }
        $token = null;
        if ($row->token_encrypted) {
            try { $token = Crypt::decryptString($row->token_encrypted); } catch (\Throwable $e) { $token = null; }
        }
        return [
            'id' => $row->id, 'owner' => $row->owner, 'repo' => $row->repo, 'branch' => $row->branch,
            'token' => $token, 'auto_migrate' => (bool)$row->auto_migrate,
            'has_token' => !empty($token),
            'retention_count' => (int)($row->retention_count ?? 10),
            'retention_days' => (int)($row->retention_days ?? 30),
            'last_pulled_at' => $row->last_pulled_at, 'last_backup_id' => $row->last_backup_id,
        ];
    }

    private function ghHeaders(?string $token = null): array
    {
        $h = ['Accept' => 'application/vnd.github+json', 'User-Agent' => 'SmartERP-DeploySync'];
        $token = $token ?? $this->getSettings()['token'] ?? env('GITHUB_TOKEN');
        if ($token) $h['Authorization'] = 'Bearer ' . $token;
        return $h;
    }

    private function fetchRemoteTree(array $s): array
    {
        $br = Http::withHeaders($this->ghHeaders($s['token']))
            ->get("{$this->apiBase}/repos/{$s['owner']}/{$s['repo']}/branches/{$s['branch']}");
        if (!$br->successful()) abort(502, 'GitHub branch fetch failed: ' . $br->status() . ' — ' . substr($br->body(), 0, 200));
        $treeSha = $br->json('commit.commit.tree.sha');
        $tr = Http::withHeaders($this->ghHeaders($s['token']))
            ->get("{$this->apiBase}/repos/{$s['owner']}/{$s['repo']}/git/trees/{$treeSha}?recursive=1");
        if (!$tr->successful()) abort(502, 'GitHub tree fetch failed');
        return $tr->json('tree') ?? [];
    }

    private function isProtected(string $p): bool {
        foreach ($this->protectedPaths as $x) if ($p === $x || str_starts_with($p, $x . '/')) return true;
        return false;
    }
    private function isSyncable(string $p): bool {
        if ($this->isProtected($p)) return false;
        foreach ($this->syncPaths as $x) if ($p === $x || str_starts_with($p, $x . '/')) return true;
        return false;
    }
    private function gitBlobSha(string $abs): ?string {
        if (!is_file($abs)) return null;
        $c = file_get_contents($abs);
        return sha1('blob ' . strlen($c) . "\0" . $c);
    }

    // ─── Audit logging ───────────────────────────────────────────
    private function audit(Request $r, string $event, string $status, array $extra = []): void
    {
        try {
            $u = $r->user();
            DB::table('deploy_sync_audit_log')->insert(array_merge([
                'event' => $event,
                'status' => $status,
                'user_id' => $u?->id,
                'user_name' => $u?->name ?? 'system',
                'ip_address' => $r->ip(),
                'created_at' => now(),
            ], $extra));
        } catch (\Throwable $e) { /* never break the request for audit */ }
    }

    // ─── Settings ─────────────────────────────────────────────────
    public function getConfig(Request $r) {
        $this->guard($r);
        $s = $this->getSettings(); unset($s['token']);
        return $this->success($s);
    }

    public function updateConfig(Request $r) {
        $this->guard($r);
        $data = $r->validate([
            'owner' => 'required|string|max:100', 'repo' => 'required|string|max:100',
            'branch' => 'required|string|max:100', 'token' => 'nullable|string',
            'auto_migrate' => 'boolean',
            'retention_count' => 'nullable|integer|min:1|max:500',
            'retention_days' => 'nullable|integer|min:1|max:3650',
        ]);
        $update = [
            'owner' => $data['owner'], 'repo' => $data['repo'], 'branch' => $data['branch'],
            'auto_migrate' => $data['auto_migrate'] ?? false,
            'retention_count' => $data['retention_count'] ?? 10,
            'retention_days' => $data['retention_days'] ?? 30,
            'updated_at' => now(),
        ];
        if (!empty($data['token'])) {
            $update['token_encrypted'] = Crypt::encryptString($data['token']);
        }
        DB::table('deploy_sync_settings')->where('id', $this->getSettings()['id'])->update($update);
        $this->audit($r, 'settings_update', 'success', [
            'branch' => $data['branch'],
            'message' => "owner={$data['owner']} repo={$data['repo']} branch={$data['branch']}"
                . (!empty($data['token']) ? ' (token updated)' : ''),
        ]);
        return $this->success(null, 'Settings saved');
    }

    public function clearToken(Request $r) {
        $this->guard($r);
        DB::table('deploy_sync_settings')->update(['token_encrypted' => null, 'updated_at' => now()]);
        $this->audit($r, 'settings_update', 'success', ['message' => 'Token cleared']);
        return $this->success(null, 'Token cleared');
    }

    /** Test the configured/provided GitHub repo+branch+token. */
    public function testConnection(Request $r) {
        $this->guard($r);
        $data = $r->validate([
            'owner' => 'required|string', 'repo' => 'required|string',
            'branch' => 'required|string', 'token' => 'nullable|string',
        ]);
        // If token blank but stored token exists, fall back to stored
        $token = !empty($data['token']) ? $data['token'] : ($this->getSettings()['token'] ?? null);
        $h = ['Accept' => 'application/vnd.github+json', 'User-Agent' => 'SmartERP-DeploySync'];
        if ($token) $h['Authorization'] = 'Bearer ' . $token;

        // 1. Validate repo
        $repo = Http::withHeaders($h)->get("{$this->apiBase}/repos/{$data['owner']}/{$data['repo']}");
        if (!$repo->successful()) {
            $msg = "Repo check failed (HTTP {$repo->status()}): " . ($repo->json('message') ?? 'unknown');
            $this->audit($r, 'test_connection', 'failed', ['branch' => $data['branch'], 'message' => $msg]);
            return $this->error($msg, 400);
        }
        $private = (bool) $repo->json('private');

        // 2. Validate branch
        $br = Http::withHeaders($h)->get("{$this->apiBase}/repos/{$data['owner']}/{$data['repo']}/branches/{$data['branch']}");
        if (!$br->successful()) {
            $msg = "Branch '{$data['branch']}' not found (HTTP {$br->status()})";
            $this->audit($r, 'test_connection', 'failed', ['branch' => $data['branch'], 'message' => $msg]);
            return $this->error($msg, 400);
        }

        // 3. Validate token scopes (if private repo, token required)
        $tokenOk = !$private || !empty($token);
        $commitSha = $br->json('commit.sha');
        $commitMsg = $br->json('commit.commit.message');
        $commitDate = $br->json('commit.commit.committer.date');

        $this->audit($r, 'test_connection', 'success', [
            'branch' => $data['branch'],
            'message' => "OK private={$private} latest={$commitSha}",
        ]);

        return $this->success([
            'repo' => $data['owner'] . '/' . $data['repo'],
            'branch' => $data['branch'],
            'private' => $private,
            'token_used' => !empty($token),
            'token_required' => $private,
            'token_ok' => $tokenOk,
            'latest_commit' => substr($commitSha, 0, 7),
            'latest_message' => $commitMsg,
            'latest_date' => $commitDate,
        ], 'Connection OK');
    }

    // ─── Status / Diff ────────────────────────────────────────────
    public function status(Request $r) {
        $this->guard($r);
        $s = $this->getSettings();
        $tree = $this->fetchRemoteTree($s);
        $root = $this->projectRoot();
        $added = $modified = $unchanged = [];
        foreach ($tree as $n) {
            if (($n['type'] ?? '') !== 'blob') continue;
            $path = $n['path'];
            if (!$this->isSyncable($path)) continue;
            $abs = $root . '/' . $path;
            $local = $this->gitBlobSha($abs);
            if ($local === null) $added[] = ['path' => $path, 'remote_sha' => $n['sha'], 'size' => $n['size'] ?? 0];
            elseif ($local !== $n['sha']) $modified[] = ['path' => $path, 'remote_sha' => $n['sha'], 'local_sha' => $local];
            else $unchanged[] = $path;
        }
        return $this->success([
            'branch' => $s['branch'], 'repo' => $s['owner'] . '/' . $s['repo'],
            'counts' => ['added' => count($added), 'modified' => count($modified), 'unchanged' => count($unchanged)],
            'added' => $added, 'modified' => $modified,
            'last_pulled_at' => $s['last_pulled_at'],
            'has_backup' => !empty($s['last_backup_id']) && is_dir(storage_path('app/deploy_sync/backups/' . $s['last_backup_id'])),
            'auto_migrate' => $s['auto_migrate'],
            'has_token' => $s['has_token'],
        ]);
    }

    public function diff(Request $r) {
        $this->guard($r);
        $path = $r->query('path');
        if (!$path || !$this->isSyncable($path)) return $this->error('Invalid path', 400);
        $s = $this->getSettings();
        $abs = $this->projectRoot() . '/' . $path;
        $localContent = is_file($abs) ? file_get_contents($abs) : '';

        $tree = $this->fetchRemoteTree($s);
        $sha = null;
        foreach ($tree as $n) if (($n['path'] ?? '') === $path) { $sha = $n['sha']; break; }
        if (!$sha) return $this->error('File not found in remote', 404);
        $blob = Http::withHeaders($this->ghHeaders($s['token']))
            ->get("{$this->apiBase}/repos/{$s['owner']}/{$s['repo']}/git/blobs/{$sha}");
        if (!$blob->successful()) return $this->error('Blob fetch failed', 502);
        $remoteContent = base64_decode($blob->json('content') ?? '');

        return $this->success([
            'path' => $path,
            'local' => $localContent,
            'remote' => $remoteContent,
            'local_size' => strlen($localContent),
            'remote_size' => strlen($remoteContent),
        ]);
    }

    // ─── Background job helpers ──────────────────────────────────
    private function jobFile(string $id): string {
        $dir = storage_path('app/deploy_sync/jobs');
        File::ensureDirectoryExists($dir);
        return $dir . '/' . $id . '.json';
    }
    private function writeJob(string $id, array $data): void {
        file_put_contents($this->jobFile($id), json_encode($data + ['updated_at' => now()->toIso8601String()]));
    }
    private function readJob(string $id): ?array {
        $f = $this->jobFile($id);
        return is_file($f) ? json_decode(file_get_contents($f), true) : null;
    }

    public function jobStatus(Request $r, string $id) {
        $this->guard($r);
        $job = $this->readJob($id);
        if (!$job) return $this->error('Job not found', 404);
        return $this->success($job);
    }

    /** Download a job's full progress + migrate output as a text file. */
    public function jobExport(Request $r, string $id) {
        $this->guard($r);
        $job = $this->readJob($id);
        if (!$job) return $this->error('Job not found', 404);
        $lines = [];
        $lines[] = '=== Deploy Sync Job Export ===';
        $lines[] = 'Job ID:     ' . $id;
        $lines[] = 'Type:       ' . ($job['type'] ?? '');
        $lines[] = 'Status:     ' . ($job['status'] ?? '');
        $lines[] = 'Progress:   ' . ($job['progress'] ?? 0) . '%';
        $lines[] = 'Updated:    ' . ($job['updated_at'] ?? '');
        $lines[] = 'Backup ID:  ' . ($job['backup_id'] ?? '-');
        $lines[] = 'Message:    ' . ($job['message'] ?? '');
        $lines[] = '';
        if (!empty($job['pulled'])) {
            $lines[] = '--- Pulled Files (' . count($job['pulled']) . ') ---';
            foreach ($job['pulled'] as $p) $lines[] = '  ' . $p;
            $lines[] = '';
        }
        if (!empty($job['errors'])) {
            $lines[] = '--- Errors ---';
            foreach ($job['errors'] as $e) $lines[] = '  ' . json_encode($e);
            $lines[] = '';
        }
        if (!empty($job['migrate_output'])) {
            $lines[] = '--- Migrate Output ---';
            $lines[] = $job['migrate_output'];
        }
        $body = implode("\n", $lines);
        return response($body, 200, [
            'Content-Type' => 'text/plain; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="deploy-sync-' . $id . '.txt"',
        ]);
    }

    /** Detach from client so work continues after response. */
    private function detach(): void {
        @ignore_user_abort(true);
        @set_time_limit(0);
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        }
    }

    // ─── Pull (sync dry-run OR async actual) ─────────────────────
    public function pull(Request $r) {
        $this->guard($r);
        $dryRun = $r->boolean('dry_run', false);
        $s = $this->getSettings();

        if ($dryRun) {
            $tree = $this->fetchRemoteTree($s);
            $root = $this->projectRoot();
            $would = [];
            foreach ($tree as $n) {
                if (($n['type'] ?? '') !== 'blob') continue;
                if (!$this->isSyncable($n['path'])) continue;
                $local = $this->gitBlobSha($root . '/' . $n['path']);
                if ($local !== $n['sha']) {
                    $would[] = [
                        'path' => $n['path'],
                        'action' => $local === null ? 'create' : 'overwrite',
                        'will_backup' => is_file($root . '/' . $n['path']),
                        'remote_size' => $n['size'] ?? 0,
                    ];
                }
            }
            $this->audit($r, 'dry_run', 'success', [
                'branch' => $s['branch'],
                'message' => count($would) . ' file(s) would change',
            ]);
            return $this->success([
                'dry_run' => true,
                'would_change_count' => count($would),
                'would_backup_to' => 'storage/app/deploy_sync/backups/' . date('Ymd_His') . ' (would be created)',
                'changes' => $would,
                'protected_skipped' => $this->protectedPaths,
            ]);
        }

        $jobId = 'pull_' . date('Ymd_His') . '_' . substr(md5(uniqid()), 0, 6);
        $this->writeJob($jobId, ['type' => 'pull', 'status' => 'queued', 'progress' => 0, 'message' => 'Starting...']);
        $this->audit($r, 'pull', 'started', ['job_id' => $jobId, 'branch' => $s['branch']]);
        $userName = $r->user()?->name; $userId = $r->user()?->id; $ip = $r->ip();
        $this->detach();
        try {
            $this->runPull($jobId, $s);
            // Re-read final job to record outcome
            $job = $this->readJob($jobId);
            DB::table('deploy_sync_audit_log')->insert([
                'event' => 'pull', 'status' => $job['status'] === 'done' ? 'success' : 'failed',
                'user_id' => $userId, 'user_name' => $userName, 'ip_address' => $ip,
                'job_id' => $jobId, 'backup_id' => $job['backup_id'] ?? null,
                'branch' => $s['branch'],
                'message' => ($job['message'] ?? '') . ' (pulled=' . ($job['pulled_count'] ?? 0) . ')',
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            $this->writeJob($jobId, ['type' => 'pull', 'status' => 'failed', 'progress' => 0, 'message' => $e->getMessage()]);
            DB::table('deploy_sync_audit_log')->insert([
                'event' => 'pull', 'status' => 'failed', 'user_id' => $userId, 'user_name' => $userName,
                'ip_address' => $ip, 'job_id' => $jobId, 'branch' => $s['branch'],
                'message' => $e->getMessage(), 'created_at' => now(),
            ]);
        }
        return $this->success(['job_id' => $jobId, 'status' => 'queued']);
    }

    private function runPull(string $jobId, array $s): void
    {
        $this->writeJob($jobId, ['type' => 'pull', 'status' => 'running', 'progress' => 5, 'message' => 'Fetching remote tree...']);
        $tree = $this->fetchRemoteTree($s);
        $root = $this->projectRoot();
        $stamp = date('Ymd_His');
        $backupDir = storage_path('app/deploy_sync/backups/' . $stamp);
        File::ensureDirectoryExists($backupDir);

        $toPull = [];
        foreach ($tree as $n) {
            if (($n['type'] ?? '') !== 'blob') continue;
            if (!$this->isSyncable($n['path'])) continue;
            $local = $this->gitBlobSha($root . '/' . $n['path']);
            if ($local !== $n['sha']) $toPull[] = $n;
        }

        $total = max(count($toPull), 1);
        $pulled = []; $errors = [];
        foreach ($toPull as $i => $n) {
            $path = $n['path'];
            $blob = Http::withHeaders($this->ghHeaders($s['token']))
                ->get("{$this->apiBase}/repos/{$s['owner']}/{$s['repo']}/git/blobs/{$n['sha']}");
            if (!$blob->successful()) { $errors[] = ['path' => $path, 'error' => 'fetch ' . $blob->status()]; continue; }
            $content = base64_decode($blob->json('content') ?? '');
            $abs = $root . '/' . $path;
            if (is_file($abs)) {
                $bak = $backupDir . '/' . $path;
                File::ensureDirectoryExists(dirname($bak));
                @copy($abs, $bak);
            }
            File::ensureDirectoryExists(dirname($abs));
            if (file_put_contents($abs, $content) === false) { $errors[] = ['path' => $path, 'error' => 'write failed']; continue; }
            $pulled[] = $path;

            $progress = 10 + (int)(($i + 1) / $total * 75);
            $this->writeJob($jobId, [
                'type' => 'pull', 'status' => 'running', 'progress' => $progress,
                'message' => "Pulled {$path}", 'pulled_count' => count($pulled),
            ]);
        }

        // Record metadata file alongside backup for friendly listing
        @file_put_contents($backupDir . '/_meta.json', json_encode([
            'job_id' => $jobId, 'pulled_count' => count($pulled),
            'created_at' => now()->toIso8601String(), 'branch' => $s['branch'],
        ]));

        DB::table('deploy_sync_settings')->update([
            'last_pulled_at' => now(), 'last_backup_id' => $stamp, 'updated_at' => now(),
        ]);

        $migrateOut = null;
        if (!empty($s['auto_migrate']) && count($pulled) > 0) {
            $this->writeJob($jobId, ['type' => 'pull', 'status' => 'running', 'progress' => 90, 'message' => 'Running migrations...']);
            try {
                Artisan::call('migrate', ['--force' => true]);
                $migrateOut = Artisan::output();
            } catch (\Throwable $e) {
                $migrateOut = 'Migration error: ' . $e->getMessage();
            }
        }

        $this->writeJob($jobId, [
            'type' => 'pull', 'status' => 'done', 'progress' => 100,
            'message' => 'Pull complete', 'pulled_count' => count($pulled),
            'pulled' => $pulled, 'errors' => $errors,
            'backup_id' => $stamp, 'migrate_output' => $migrateOut,
        ]);
    }

    // ─── Backups: list + selective rollback ──────────────────────
    public function listBackups(Request $r) {
        $this->guard($r);
        $base = storage_path('app/deploy_sync/backups');
        if (!is_dir($base)) return $this->success(['backups' => []]);
        $entries = [];
        foreach (scandir($base) as $name) {
            if ($name === '.' || $name === '..') continue;
            $full = $base . '/' . $name;
            if (!is_dir($full)) continue;
            $meta = is_file($full . '/_meta.json') ? json_decode(file_get_contents($full . '/_meta.json'), true) : [];
            // count files
            $count = 0;
            try {
                $rii = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($full, \RecursiveDirectoryIterator::SKIP_DOTS));
                foreach ($rii as $f) if (!$f->isDir() && $f->getFilename() !== '_meta.json') $count++;
            } catch (\Throwable $e) {}
            $entries[] = [
                'backup_id' => $name,
                'file_count' => $count,
                'created_at' => $meta['created_at'] ?? date('c', @filemtime($full) ?: time()),
                'branch' => $meta['branch'] ?? null,
                'job_id' => $meta['job_id'] ?? null,
            ];
        }
        usort($entries, fn($a, $b) => strcmp($b['backup_id'], $a['backup_id']));
        $current = $this->getSettings()['last_backup_id'];
        return $this->success(['backups' => $entries, 'latest_backup_id' => $current]);
    }

    public function rollback(Request $r) {
        $this->guard($r);
        $s = $this->getSettings();
        $backupId = $r->input('backup_id') ?: $s['last_backup_id'];
        if (empty($backupId)) return $this->error('No backup available', 404);
        // Sanitize
        if (!preg_match('/^[A-Za-z0-9_\-]+$/', $backupId)) return $this->error('Invalid backup id', 400);
        $backupDir = storage_path('app/deploy_sync/backups/' . $backupId);
        if (!is_dir($backupDir)) return $this->error('Backup folder missing', 404);

        $jobId = 'rb_' . date('Ymd_His') . '_' . substr(md5(uniqid()), 0, 6);
        $this->writeJob($jobId, ['type' => 'rollback', 'status' => 'queued', 'progress' => 0, 'message' => 'Starting...', 'backup_id' => $backupId]);
        $this->audit($r, 'rollback', 'started', ['job_id' => $jobId, 'backup_id' => $backupId, 'branch' => $s['branch']]);
        $userName = $r->user()?->name; $userId = $r->user()?->id; $ip = $r->ip();
        $this->detach();
        try {
            $this->runRollback($jobId, $backupDir, $backupId);
            $job = $this->readJob($jobId);
            DB::table('deploy_sync_audit_log')->insert([
                'event' => 'rollback', 'status' => $job['status'] === 'done' ? 'success' : 'failed',
                'user_id' => $userId, 'user_name' => $userName, 'ip_address' => $ip,
                'job_id' => $jobId, 'backup_id' => $backupId, 'branch' => $s['branch'],
                'message' => ($job['message'] ?? '') . ' (restored=' . ($job['restored_count'] ?? 0) . ')',
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            $this->writeJob($jobId, ['type' => 'rollback', 'status' => 'failed', 'progress' => 0, 'message' => $e->getMessage()]);
            DB::table('deploy_sync_audit_log')->insert([
                'event' => 'rollback', 'status' => 'failed', 'user_id' => $userId, 'user_name' => $userName,
                'ip_address' => $ip, 'job_id' => $jobId, 'backup_id' => $backupId, 'branch' => $s['branch'],
                'message' => $e->getMessage(), 'created_at' => now(),
            ]);
        }
        return $this->success(['job_id' => $jobId, 'status' => 'queued', 'backup_id' => $backupId]);
    }

    private function runRollback(string $jobId, string $backupDir, string $stamp): void
    {
        $this->writeJob($jobId, ['type' => 'rollback', 'status' => 'running', 'progress' => 10, 'message' => 'Scanning backup...', 'backup_id' => $stamp]);
        $root = $this->projectRoot();
        $files = [];
        $rii = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($backupDir, \RecursiveDirectoryIterator::SKIP_DOTS));
        foreach ($rii as $f) if (!$f->isDir() && $f->getFilename() !== '_meta.json') $files[] = $f->getPathname();
        $total = max(count($files), 1);
        $restored = [];
        foreach ($files as $i => $abs) {
            $rel = ltrim(str_replace($backupDir, '', $abs), '/\\');
            if ($this->isProtected($rel)) continue;
            $dest = $root . '/' . $rel;
            File::ensureDirectoryExists(dirname($dest));
            @copy($abs, $dest);
            $restored[] = $rel;
            $progress = 10 + (int)(($i + 1) / $total * 85);
            $this->writeJob($jobId, ['type' => 'rollback', 'status' => 'running', 'progress' => $progress, 'message' => "Restored {$rel}", 'backup_id' => $stamp]);
        }
        $this->writeJob($jobId, [
            'type' => 'rollback', 'status' => 'done', 'progress' => 100,
            'message' => 'Rollback complete', 'restored_count' => count($restored),
            'backup_id' => $stamp,
        ]);
    }

    // ─── Manual migrate button ───────────────────────────────────
    public function migrate(Request $r) {
        $this->guard($r);
        try {
            Artisan::call('migrate', ['--force' => true]);
            $out = Artisan::output();
            $this->audit($r, 'migrate', 'success', ['message' => substr($out, 0, 500)]);
            return $this->success(['output' => $out], 'Migrations executed');
        } catch (\Throwable $e) {
            $this->audit($r, 'migrate', 'failed', ['message' => $e->getMessage()]);
            return $this->error('Migration failed: ' . $e->getMessage(), 500);
        }
    }

    // ─── Audit log listing ───────────────────────────────────────
    public function auditLog(Request $r) {
        $this->guard($r);
        $perPage = min(max((int)$r->query('per_page', 50), 10), 200);
        $q = DB::table('deploy_sync_audit_log')->orderByDesc('id');
        if ($e = $r->query('event')) $q->where('event', $e);
        if ($st = $r->query('status')) $q->where('status', $st);
        $rows = $q->limit($perPage)->get();
        return $this->success(['items' => $rows]);
    }
}
