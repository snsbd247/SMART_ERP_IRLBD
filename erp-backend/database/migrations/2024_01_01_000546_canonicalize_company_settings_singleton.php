<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('company_settings')) return;

        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE company_settings MODIFY id VARCHAR(50) NOT NULL');
        }

        $now = now();
        $hasCreatedAt = Schema::hasColumn('company_settings', 'created_at');
        $hasUpdatedAt = Schema::hasColumn('company_settings', 'updated_at');
        $source = DB::table('company_settings')
            ->when($hasUpdatedAt, fn ($q) => $q->orderByDesc('updated_at'))
            ->when($hasCreatedAt, fn ($q) => $q->orderByDesc('created_at'))
            ->first();

        if ($source) {
            $payload = (array) $source;
            $payload['id'] = 'default';
            DB::table('company_settings')->updateOrInsert(['id' => 'default'], $payload);
            DB::table('company_settings')->where('id', '!=', 'default')->delete();
            return;
        }

        $row = [
            'id' => 'default',
            'company_name' => 'My Company',
            'currency_code' => 'USD',
            'currency_symbol' => '$',
            'currency_name' => 'US Dollar',
            'currency_position' => 'before',
        ];
        if ($hasCreatedAt) $row['created_at'] = $now;
        if ($hasUpdatedAt) $row['updated_at'] = $now;
        DB::table('company_settings')->insert($row);
    }

    public function down(): void
    {
        // Keep the canonical settings row intact on rollback.
    }
};