<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('license_state', function (Blueprint $table) {
            if (!Schema::hasColumn('license_state', 'activated_at')) {
                $table->timestamp('activated_at')->nullable()->after('expires_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('license_state', function (Blueprint $table) {
            if (Schema::hasColumn('license_state', 'activated_at')) $table->dropColumn('activated_at');
        });
    }
};
