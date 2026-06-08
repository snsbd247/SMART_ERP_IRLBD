<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('company_settings', 'public_employee_registration_enabled')) {
            Schema::table('company_settings', function (Blueprint $table) {
                $table->boolean('public_employee_registration_enabled')->default(0);
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('company_settings', 'public_employee_registration_enabled')) {
            Schema::table('company_settings', function (Blueprint $table) {
                $table->dropColumn('public_employee_registration_enabled');
            });
        }
    }
};
