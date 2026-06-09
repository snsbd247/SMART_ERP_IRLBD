<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('company_settings') && !Schema::hasColumn('company_settings', 'bin_number')) {
            Schema::table('company_settings', function (Blueprint $table) {
                $table->string('bin_number', 50)->nullable()->after('website');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('company_settings') && Schema::hasColumn('company_settings', 'bin_number')) {
            Schema::table('company_settings', function (Blueprint $table) {
                $table->dropColumn('bin_number');
            });
        }
    }
};
