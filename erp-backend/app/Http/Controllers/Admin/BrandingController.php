<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use App\Models\SystemSetting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * BrandingController — Laravel endpoint replacing the former
 * `system_settings` upsert + `branding` storage bucket used by the
 * React Branding & White-Label page.
 *
 * Safe Extension: only the existing `system_settings` table is used;
 * no schema changes.
 */
class BrandingController extends BaseController
{
    private const KEYS = [
        'software_name', 'software_version', 'footer_text', 'developer_name',
        'white_label_mode', 'primary_color', 'secondary_color',
        'company_logo_url', 'login_logo_url', 'favicon_url',
    ];

    /** Allowed MIME types for logo / favicon uploads. */
    private const ALLOWED_MIMES = [
        'image/png', 'image/jpeg', 'image/jpg', 'image/gif',
        'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon',
    ];

    private const MAX_KB = 2048; // 2 MB

    public function show()
    {
        $rows = SystemSetting::whereIn('setting_key', self::KEYS)
            ->get(['setting_key', 'setting_value']);
        return $this->success($rows);
    }

    public function update(Request $request)
    {
        $data = $request->validate([
            'settings' => 'required|array|min:1',
            'settings.*.setting_key' => 'required|string|in:' . implode(',', self::KEYS),
            'settings.*.setting_value' => 'nullable|string|max:10000',
        ]);

        foreach ($data['settings'] as $row) {
            SystemSetting::updateOrCreate(
                ['setting_key' => $row['setting_key']],
                ['setting_value' => (string) ($row['setting_value'] ?? '')]
            );
        }

        return $this->success(['updated' => count($data['settings'])]);
    }

    public function uploadLogo(Request $request)
    {
        try {
            $request->validate([
                'file' => 'required|file|max:' . self::MAX_KB,
                'setting_key' => 'required|string|in:company_logo_url,login_logo_url,favicon_url',
            ], [
                'file.required' => 'No file was uploaded.',
                'file.max' => 'Logo file must be ' . (self::MAX_KB / 1024) . ' MB or smaller.',
                'setting_key.in' => 'Invalid logo slot. Must be company_logo_url, login_logo_url, or favicon_url.',
            ]);
        } catch (ValidationException $e) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $e->errors(),
            ], 422);
        }

        $file = $request->file('file');
        $mime = strtolower((string) $file->getMimeType());

        if (!in_array($mime, self::ALLOWED_MIMES, true)) {
            return response()->json([
                'success' => false,
                'message' => 'Unsupported file type. Allowed: PNG, JPG, GIF, WEBP, SVG, ICO.',
                'errors' => ['file' => ['Unsupported MIME type: ' . $mime]],
            ], 422);
        }

        try {
            $ext = strtolower($file->getClientOriginalExtension() ?: 'png');
            $name = $request->input('setting_key') . '_' . time() . '.' . $ext;
            $path = $file->storeAs('branding', $name, 'public');
            $publicUrl = url(Storage::url($path));

            return $this->success(['url' => $publicUrl, 'path' => $path, 'mime' => $mime]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to save uploaded file: ' . $e->getMessage(),
            ], 500);
        }
    }
}
