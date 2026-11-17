<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Generic file storage endpoints used by the frontend data client.
 * Routes:
 *   POST   /api/v1/storage/{bucket}            multipart "file" + optional "path"
 *   DELETE /api/v1/storage/{bucket}/{path}     remove an object
 *   GET    /api/v1/storage/{bucket}/{path}     returns public URL JSON
 *
 * Buckets are mapped to folders under storage/app/public/<bucket>/.
 *
 * Security: files in these buckets are served directly by the web server, so the
 * stored extension is derived from the detected file content (never from the
 * client's file name) and only harmless document/image types are accepted.
 * Paths are restricted to simple folder names (no "..").
 */
class GenericStorageController extends BaseController
{
    private const MAX_KB = 10240; // 10 MB default

    /** Detected MIME type => stored extension, per bucket. */
    private const IMAGES = [
        'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif',
    ];
    private const BUCKET_TYPES = [
        'company-assets' => self::IMAGES + ['application/pdf' => 'pdf', 'image/svg+xml' => 'svg'],
        'branding' => self::IMAGES + ['image/svg+xml' => 'svg', 'image/x-icon' => 'ico', 'image/vnd.microsoft.icon' => 'ico'],
        'employee-photos' => self::IMAGES,
        'backups' => [
            'application/sql' => 'sql', 'text/plain' => 'sql', 'text/x-sql' => 'sql',
            'application/json' => 'json', 'application/zip' => 'zip', 'application/gzip' => 'gz', 'application/x-gzip' => 'gz',
        ],
    ];
    /** Buckets whose files contain whole-database data: Super Admin only. */
    private const SUPER_ADMIN_BUCKETS = ['backups'];

    public function upload(Request $request, string $bucket)
    {
        $this->assertBucket($request, $bucket);
        $request->validate([
            'file' => 'required|file|max:' . self::MAX_KB,
            'path' => 'nullable|string|max:255',
        ]);

        $file = $request->file('file');
        $mime = strtolower((string) $file->getMimeType());
        $ext = self::BUCKET_TYPES[$bucket][$mime] ?? null;
        if ($ext === null) {
            return $this->error('This file type is not allowed here.', 422, ['file' => ["Unsupported file type: {$mime}"]]);
        }

        $folder = $this->cleanPath((string) $request->input('path', ''), true);
        $original = pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME) ?: (string) Str::uuid();
        $safeName = Str::slug($original) ?: (string) Str::uuid();
        $name = ($folder !== '' ? $folder . '/' : '') . $safeName . '.' . $ext;

        $stored = $file->storeAs($bucket, $name, 'public');
        return $this->success([
            'path' => $stored,
            'url' => url(Storage::url($stored)),
        ]);
    }

    public function destroy(Request $request, string $bucket, string $path)
    {
        $this->assertBucket($request, $bucket);
        Storage::disk('public')->delete($bucket . '/' . $this->cleanPath($path));
        return $this->success(['deleted' => true]);
    }

    public function publicUrl(Request $request, string $bucket, string $path)
    {
        $this->assertBucket($request, $bucket);
        return $this->success(['url' => url(Storage::url($bucket . '/' . $this->cleanPath($path)))]);
    }

    private function assertBucket(Request $request, string $bucket): void
    {
        if (!isset(self::BUCKET_TYPES[$bucket])) {
            abort(403, "Bucket '$bucket' is not allowed");
        }
        if (in_array($bucket, self::SUPER_ADMIN_BUCKETS, true) && !$request->user()?->isSuperAdmin()) {
            abort(403, 'Only Super Admins can access backups.');
        }
    }

    /** Simple relative path: letters, digits, "_", "-", "." and "/" only, never "..". */
    private function cleanPath(string $path, bool $folderOnly = false): string
    {
        $path = trim(str_replace('\\', '/', $path), '/');
        if ($path === '') return '';
        $allowed = $folderOnly ? '#^[A-Za-z0-9_\-/]+$#' : '#^[A-Za-z0-9_\-./]+$#';
        if (!preg_match($allowed, $path) || str_contains($path, '..') || str_contains($path, '//')) {
            abort(422, 'Invalid file path.');
        }
        return $path;
    }
}
