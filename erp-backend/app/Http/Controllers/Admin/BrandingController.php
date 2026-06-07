<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use App\Models\SystemSetting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * BrandingController — Laravel VPS equivalent of the Supabase
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

    public function show()
    {
        $rows = SystemSetting::whereIn('setting_key', self::KEYS)
            ->get(['setting_key', 'setting_value']);
        return $this->success($rows);
    }

    public function update(Request $request)
    {
        $data = $request->validate([
            'settings' => 'required|array',
            'settings.*.setting_key' => 'required|string|in:' . implode(',', self::KEYS),
            'settings.*.setting_value' => 'nullable|string',
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
        $request->validate([
            'file' => 'required|file|image|max:5120', // 5MB
            'setting_key' => 'required|string|in:company_logo_url,login_logo_url,favicon_url',
        ]);

        $file = $request->file('file');
        $ext = $file->getClientOriginalExtension() ?: 'png';
        $name = $request->input('setting_key') . '_' . time() . '.' . $ext;
        $path = $file->storeAs('branding', $name, 'public');

        $publicUrl = url(Storage::url($path)); // /storage/branding/<file>
        return $this->success(['url' => $publicUrl, 'path' => $path]);
    }
}
