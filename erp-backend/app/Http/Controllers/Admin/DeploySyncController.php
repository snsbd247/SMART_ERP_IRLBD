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
 * Features: configurable settings, diff viewer, dry-run, async jobs, auto-migrate.
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
        ]);
        $update = [
            'owner' => $data['owner'], 'repo' => $data['repo'], 'branch' => $data['branch'],
            'auto_migrate' => $data['auto_migrate'] ?? false, 'updated_at' => now(),
        ];
        if (!empty($data['token'])) {
            $update['token_encrypted'] = Crypt::encryptString($data['token']);
        }
        DB::table('deploy_sync_settings')->where('id', $this->getSettings()['id'])->update($update);
        return $this->success(null, 'Settings saved');
    }

    public function clearToken(Request $r) {
        $this->guard($r);
        DB::table('deploy_sync_settings')->update(['token_encrypted' => null, 'updated_at' => now()]);
        return $this->success(null, 'Token cleared');
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
            // Compute & return immediately, no writes.
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
            return $this->success([
                'dry_run' => true,
                'would_change_count' => count($would),
                'would_backup_to' => 'storage/app/deploy_sync/backups/' . date('Ymd_His') . ' (would be created)',
                'changes' => $would,
                'protected_skipped' => $this->protectedPaths,
            ]);
        }

        // Async actual pull
        $jobId = 'pull_' . date('Ymd_His') . '_' . substr(md5(uniqid()), 0, 6);
        $this->writeJob($jobId, ['type' => 'pull', 'status' => 'queued', 'progress' => 0, 'message' => 'Starting...']);
        $this->detach();
        try { $this->runPull($jobId, $s); } catch (\Throwable $e) {
            $this->writeJob($jobId, ['type' => 'pull', 'status' => 'failed', 'progress' => 0, 'message' => $e->getMessage()]);
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

    // ─── Rollback (async) ────────────────────────────────────────
    public function rollback(Request $r) {
        $this->guard($r);
        $s = $this->getSettings();
        if (empty($s['last_backup_id'])) return $this->error('No backup available', 404);
        $backupDir = storage_path('app/deploy_sync/backups/' . $s['last_backup_id']);
        if (!is_dir($backupDir)) return $this->error('Backup folder missing', 404);

        $jobId = 'rb_' . date('Ymd_His') . '_' . substr(md5(uniqid()), 0, 6);
        $this->writeJob($jobId, ['type' => 'rollback', 'status' => 'queued', 'progress' => 0, 'message' => 'Starting...']);
        $this->detach();
        try { $this->runRollback($jobId, $backupDir, $s['last_backup_id']); } catch (\Throwable $e) {
            $this->writeJob($jobId, ['type' => 'rollback', 'status' => 'failed', 'progress' => 0, 'message' => $e->getMessage()]);
        }
        return $this->success(['job_id' => $jobId, 'status' => 'queued']);
    }

    private function runRollback(string $jobId, string $backupDir, string $stamp): void
    {
        $this->writeJob($jobId, ['type' => 'rollback', 'status' => 'running', 'progress' => 10, 'message' => 'Scanning backup...']);
        $root = $this->projectRoot();
        $files = [];
        $rii = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($backupDir, \RecursiveDirectoryIterator::SKIP_DOTS));
        foreach ($rii as $f) if (!$f->isDir()) $files[] = $f->getPathname();
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
            $this->writeJob($jobId, ['type' => 'rollback', 'status' => 'running', 'progress' => $progress, 'message' => "Restored {$rel}"]);
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
            return $this->success(['output' => Artisan::output()], 'Migrations executed');
        } catch (\Throwable $e) {
            return $this->error('Migration failed: ' . $e->getMessage(), 500);
        }
    }
}
