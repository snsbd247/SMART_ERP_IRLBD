<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use App\Models\CompanySetting;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SettingsController extends BaseController
{
    private const SINGLETON_ID = 'default';

    public function __construct(private AuditService $auditService) {}

    public function show()
    {
        return $this->success($this->singleton());
    }

    public function update(Request $request)
    {
        $data = $request->validate([
            'company_name' => 'sometimes|string|max:255',
            'address' => 'nullable|string',
            'phone' => 'nullable|string|max:30',
            'email' => 'nullable|email|max:100',
            'website' => 'nullable|string|max:255',
            'company_logo_url' => 'nullable|string',
            'currency_code' => 'sometimes|string|max:10',
            'currency_symbol' => 'sometimes|string|max:10',
            'currency_name' => 'sometimes|string|max:50',
            'currency_position' => 'sometimes|in:before,after',
            'default_branch_id' => 'nullable|exists:branches,id',
            'default_financial_year_id' => 'nullable|exists:financial_years,id',
            'public_employee_registration_enabled' => 'sometimes|boolean',
            'bin_number' => [
                'nullable',
                'string',
                'max:50',
                'regex:/^[\d\-\s]{9,20}$/',
            ],
        ], [
            'bin_number.regex' => 'BIN must be 9-13 digits (hyphens/spaces allowed).',
        ]);

        // Extra digit-count check (Bangladesh e-BIN = 9-13 digits)
        if (array_key_exists('bin_number', $data) && $data['bin_number']) {
            $digits = preg_replace('/\D/', '', $data['bin_number']);
            if (strlen($digits) < 9 || strlen($digits) > 13) {
                return response()->json([
                    'message' => 'BIN must be between 9 and 13 digits.',
                    'errors' => ['bin_number' => ['BIN must be between 9 and 13 digits.']],
                ], 422);
            }
        }

        $before = (array) ($this->singleton()->getAttributes());

        $settings = DB::transaction(function () use ($data) {
            $payload = $this->cleanPayload(array_merge($data, [
                'id' => self::SINGLETON_ID,
                'updated_at' => now(),
            ]));
            DB::table('company_settings')->updateOrInsert(['id' => self::SINGLETON_ID], $payload);
            DB::table('company_settings')->where('id', '!=', self::SINGLETON_ID)->delete();

            // Keep the login page / sidebar (which read the logo from
            // system_settings, not company_settings) in sync with the one
            // logo-upload control users actually see in General Settings.
            if (array_key_exists('company_logo_url', $data)) {
                DB::table('system_settings')->updateOrInsert(
                    ['setting_key' => 'company_logo_url'],
                    ['setting_value' => (string) ($data['company_logo_url'] ?? ''), 'updated_at' => now()]
                );
            }

            return CompanySetting::where('id', self::SINGLETON_ID)->first();
        });

        // Audit-log diff (only changed fields)
        try {
            $after = (array) $settings->getAttributes();
            $changedKeys = [];
            foreach ($data as $k => $v) {
                $old = $before[$k] ?? null;
                $new = $after[$k] ?? null;
                if ((string) $old !== (string) $new) $changedKeys[] = $k;
            }
            if (!empty($changedKeys)) {
                $oldDiff = array_intersect_key($before, array_flip($changedKeys));
                $newDiff = array_intersect_key($after, array_flip($changedKeys));
                $this->auditService->logUpdate(
                    'company_settings',
                    self::SINGLETON_ID,
                    $oldDiff,
                    $newDiff,
                    $request
                );
            }
        } catch (\Throwable $e) {
            \Log::warning('audit log failed for company_settings update: ' . $e->getMessage());
        }

        return $this->success($settings);
    }

    /**
     * Company settings is a singleton. Older installs may contain a UUID row
     * or duplicate rows, which made saves appear successful but reload from a
     * different empty row. Canonicalize every read/write to id="default".
     */
    private function singleton(): CompanySetting
    {
        return DB::transaction(function () {
            $source = CompanySetting::orderByDesc('updated_at')->orderByDesc('created_at')->first();
            $payload = $source ? (array) $source->getAttributes() : $this->defaultPayload();
            $payload['id'] = self::SINGLETON_ID;
            if (Schema::hasColumn('company_settings', 'created_at')) $payload['created_at'] = $payload['created_at'] ?? now();
            if (Schema::hasColumn('company_settings', 'updated_at')) $payload['updated_at'] = $payload['updated_at'] ?? now();
            DB::table('company_settings')->updateOrInsert(['id' => self::SINGLETON_ID], $this->cleanPayload($payload));

            DB::table('company_settings')->where('id', '!=', self::SINGLETON_ID)->delete();
            return CompanySetting::where('id', self::SINGLETON_ID)->firstOrFail();
        });
    }

    private function defaultPayload(): array
    {
        return [
            'id' => self::SINGLETON_ID,
            'company_name' => 'My Company',
            'currency_code' => 'USD',
            'currency_symbol' => '$',
            'currency_name' => 'US Dollar',
            'currency_position' => 'before',
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }

    private function cleanPayload(array $payload): array
    {
        return array_intersect_key($payload, array_flip(Schema::getColumnListing('company_settings')));
    }
}
