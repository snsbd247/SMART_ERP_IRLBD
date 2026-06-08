<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use App\Models\CompanySetting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SettingsController extends BaseController
{
    private const SINGLETON_ID = 'default';

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
        ]);

        $settings = DB::transaction(function () use ($data) {
            $this->singleton();
            $payload = $this->cleanPayload(array_merge($data, [
                'id' => self::SINGLETON_ID,
                'updated_at' => now(),
            ]));
            DB::table('company_settings')->updateOrInsert(['id' => self::SINGLETON_ID], $payload);
            DB::table('company_settings')->where('id', '!=', self::SINGLETON_ID)->delete();
            return CompanySetting::where('id', self::SINGLETON_ID)->first();
        });

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
            $existing = CompanySetting::where('id', self::SINGLETON_ID)->first();
            if (!$existing) {
                $source = CompanySetting::orderByDesc('updated_at')->orderByDesc('created_at')->first();
                $payload = $source ? (array) $source->getAttributes() : $this->defaultPayload();
                $payload['id'] = self::SINGLETON_ID;
                if (Schema::hasColumn('company_settings', 'created_at')) $payload['created_at'] = $payload['created_at'] ?? now();
                if (Schema::hasColumn('company_settings', 'updated_at')) $payload['updated_at'] = $payload['updated_at'] ?? now();
                DB::table('company_settings')->updateOrInsert(['id' => self::SINGLETON_ID], $this->cleanPayload($payload));
            }

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
