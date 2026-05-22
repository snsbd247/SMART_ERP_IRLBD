<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\File;

/**
 * GitHub Deploy Sync for cPanel deployments.
 * 
 * Compares whitelisted local files against a GitHub repo branch, pulls
 * updates via the GitHub REST API, and lets users rollback to the last
 * known-good backup. Only Super Admin (employee_id = NULL) can access.
 * 
 * NEVER touches: .env, vendor/, storage/, .git/, node_modules/, public/storage
 */
class DeploySyncController extends BaseController
{
    private string $owner = 'snsbd247';
    private string $repo  = 'smart_accounting';
    private string $branch;
    private string $apiBase = 'https://api.github.com';

    /** Files that are eligible for sync (relative to project root). */
    private array $syncPaths = [
        'erp-backend/app',
        'erp-backend/config',
        'erp-backend/database/migrations',
        'erp-backend/database/seeders',
        'erp-backend/routes',
        'erp-backend/resources/views',
        'erp-backend/composer.json',
        'erp-backend/composer.lock',
        'erp-backend/artisan',
    ];

    /** Hard-blocked paths — never overwritten. */
    private array $protectedPaths = [
        '.env',
        'erp-backend/.env',
        'erp-backend/vendor',
        'erp-backend/storage',
        'erp-backend/.git',
        'erp-backend/node_modules',
        'erp-backend/public/storage',
    ];

    public function __construct()
    {
        $this->branch = env('DEPLOY_SYNC_BRANCH', 'main');
    }

    /** Guard: Super Admin only. */
    private function guard(Request $r)
    {
        $u = $r->user();
        if (!$u || !$u->isSuperAdmin()) {
            abort(403, 'Super Admin access required');
        }
    }

    /** Local project root (one level above Laravel base_path()). */
    private function projectRoot(): string
    {
        return dirname(base_path());
    }

    private function ghHeaders(): array
    {
        $headers = ['Accept' => 'application/vnd.github+json', 'User-Agent' => 'SmartERP-DeploySync'];
        if ($token = env('GITHUB_TOKEN')) {
            $headers['Authorization'] = 'Bearer ' . $token;
        }
        return $headers;
    }

    /** Fetch full git tree for the branch (recursive). */
    private function fetchRemoteTree(): array
    {
        $branchRes = Http::withHeaders($this->ghHeaders())
            ->get("{$this->apiBase}/repos/{$this->owner}/{$this->repo}/branches/{$this->branch}");

        if (!$branchRes->successful()) {
            abort(502, 'GitHub branch fetch failed: ' . $branchRes->status() . ' ' . $branchRes->body());
        }
        $treeSha = $branchRes->json('commit.commit.tree.sha');

        $treeRes = Http::withHeaders($this->ghHeaders())
            ->get("{$this->apiBase}/repos/{$this->owner}/{$this->repo}/git/trees/{$treeSha}?recursive=1");

        if (!$treeRes->successful()) {
            abort(502, 'GitHub tree fetch failed');
        }
        return $treeRes->json('tree') ?? [];
    }

    private function isProtected(string $path): bool
    {
        foreach ($this->protectedPaths as $p) {
            if ($path === $p || str_starts_with($path, $p . '/')) return true;
        }
        return false;
    }

    private function isSyncable(string $path): bool
    {
        if ($this->isProtected($path)) return false;
        foreach ($this->syncPaths as $p) {
            if ($path === $p || str_starts_with($path, $p . '/')) return true;
        }
        return false;
    }

    /** GitHub blob SHA = sha1("blob " . filesize . "\0" . contents) */
    private function gitBlobSha(string $absPath): ?string
    {
        if (!is_file($absPath)) return null;
        $contents = file_get_contents($absPath);
        $header = 'blob ' . strlen($contents) . "\0";
        return sha1($header . $contents);
    }

    /** GET /api/v1/deploy-sync/status — compare remote vs local */
    public function status(Request $r)
    {
        $this->guard($r);
        $tree = $this->fetchRemoteTree();
        $root = $this->projectRoot();

        $added = $modified = $unchanged = $skipped = [];

        foreach ($tree as $node) {
            if (($node['type'] ?? '') !== 'blob') continue;
            $path = $node['path'];
            if (!$this->isSyncable($path)) { continue; }

            $abs = $root . DIRECTORY_SEPARATOR . $path;
            $localSha = $this->gitBlobSha($abs);
            $remoteSha = $node['sha'];

            if ($localSha === null) {
                $added[] = ['path' => $path, 'remote_sha' => $remoteSha, 'size' => $node['size'] ?? 0];
            } elseif ($localSha !== $remoteSha) {
                $modified[] = ['path' => $path, 'remote_sha' => $remoteSha, 'local_sha' => $localSha];
            } else {
                $unchanged[] = $path;
            }
        }

        return response()->json([
            'success' => true,
            'data' => [
                'branch' => $this->branch,
                'repo' => "{$this->owner}/{$this->repo}",
                'counts' => [
                    'added' => count($added),
                    'modified' => count($modified),
                    'unchanged' => count($unchanged),
                ],
                'added' => $added,
                'modified' => $modified,
                'last_pulled_at' => Storage::exists('deploy_sync/last_pulled_at')
                    ? Storage::get('deploy_sync/last_pulled_at') : null,
                'has_backup' => Storage::exists('deploy_sync/backups/latest'),
            ],
        ]);
    }

    /** POST /api/v1/deploy-sync/pull — download changed files, backup old. */
    public function pull(Request $r)
    {
        $this->guard($r);

        $tree = $this->fetchRemoteTree();
        $root = $this->projectRoot();
        $stamp = date('Ymd_His');
        $backupDir = storage_path('app/deploy_sync/backups/' . $stamp);
        File::ensureDirectoryExists($backupDir);

        $pulled = [];
        $errors = [];

        foreach ($tree as $node) {
            if (($node['type'] ?? '') !== 'blob') continue;
            $path = $node['path'];
            if (!$this->isSyncable($path)) continue;

            $abs = $root . DIRECTORY_SEPARATOR . $path;
            $localSha = $this->gitBlobSha($abs);
            if ($localSha === $node['sha']) continue;

            // Fetch blob
            $blobRes = Http::withHeaders($this->ghHeaders())
                ->get("{$this->apiBase}/repos/{$this->owner}/{$this->repo}/git/blobs/{$node['sha']}");

            if (!$blobRes->successful()) {
                $errors[] = ['path' => $path, 'error' => 'fetch failed ' . $blobRes->status()];
                continue;
            }

            $content = base64_decode($blobRes->json('content') ?? '');

            // Backup existing
            if (is_file($abs)) {
                $bakAbs = $backupDir . DIRECTORY_SEPARATOR . $path;
                File::ensureDirectoryExists(dirname($bakAbs));
                @copy($abs, $bakAbs);
            }

            // Write new
            File::ensureDirectoryExists(dirname($abs));
            if (file_put_contents($abs, $content) === false) {
                $errors[] = ['path' => $path, 'error' => 'write failed (check permissions)'];
                continue;
            }
            $pulled[] = $path;
        }

        // Mark latest backup
        Storage::put('deploy_sync/backups/latest', $stamp);
        Storage::put('deploy_sync/last_pulled_at', now()->toIso8601String());

        return response()->json([
            'success' => true,
            'data' => [
                'pulled_count' => count($pulled),
                'pulled' => $pulled,
                'errors' => $errors,
                'backup_id' => $stamp,
                'next_steps' => [
                    'Run: php artisan migrate --force',
                    'Run: php artisan config:clear && php artisan cache:clear',
                ],
            ],
        ]);
    }

    /** POST /api/v1/deploy-sync/rollback — restore latest backup. */
    public function rollback(Request $r)
    {
        $this->guard($r);

        if (!Storage::exists('deploy_sync/backups/latest')) {
            return response()->json(['success' => false, 'message' => 'No backup available'], 404);
        }
        $stamp = trim(Storage::get('deploy_sync/backups/latest'));
        $backupDir = storage_path('app/deploy_sync/backups/' . $stamp);

        if (!is_dir($backupDir)) {
            return response()->json(['success' => false, 'message' => "Backup {$stamp} missing"], 404);
        }

        $root = $this->projectRoot();
        $restored = [];

        $rii = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($backupDir, \RecursiveDirectoryIterator::SKIP_DOTS));
        foreach ($rii as $file) {
            if ($file->isDir()) continue;
            $rel = ltrim(str_replace($backupDir, '', $file->getPathname()), DIRECTORY_SEPARATOR);
            if ($this->isProtected($rel)) continue;
            $dest = $root . DIRECTORY_SEPARATOR . $rel;
            File::ensureDirectoryExists(dirname($dest));
            @copy($file->getPathname(), $dest);
            $restored[] = $rel;
        }

        return response()->json([
            'success' => true,
            'data' => ['restored_count' => count($restored), 'backup_id' => $stamp],
        ]);
    }
}
