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
 */
class GenericStorageController extends BaseController
{
    private const ALLOWED_BUCKETS = ['company-assets', 'branding', 'employee-photos', 'backups'];
    private const MAX_KB = 10240; // 10 MB default

    public function upload(Request $request, string $bucket)
    {
        $this->assertBucket($bucket);
        $request->validate([
            'file' => 'required|file|max:' . self::MAX_KB,
            'path' => 'nullable|string|max:255',
        ]);

        $file = $request->file('file');
        $folder = trim((string) $request->input('path', ''), '/');
        $ext = strtolower($file->getClientOriginalExtension() ?: 'bin');
        $original = pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME) ?: (string) Str::uuid();
        $safeName = Str::slug($original) ?: (string) Str::uuid();
        $name = ($folder ? $folder . '/' : '') . $safeName . '.' . $ext;

        $stored = $file->storeAs($bucket, $name, 'public');
        return $this->success([
            'path' => $stored,
            'url' => url(Storage::url($stored)),
        ]);
    }

    public function destroy(string $bucket, string $path)
    {
        $this->assertBucket($bucket);
        Storage::disk('public')->delete("$bucket/$path");
        return $this->success(['deleted' => true]);
    }

    public function publicUrl(string $bucket, string $path)
    {
        $this->assertBucket($bucket);
        return $this->success(['url' => url(Storage::url("$bucket/$path"))]);
    }

    private function assertBucket(string $bucket): void
    {
        if (!in_array($bucket, self::ALLOWED_BUCKETS, true)) {
            abort(403, "Bucket '$bucket' is not allowed");
        }
    }
}
