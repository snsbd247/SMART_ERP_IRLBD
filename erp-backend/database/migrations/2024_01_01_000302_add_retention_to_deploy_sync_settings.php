<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('deploy_sync_settings', function (Blueprint $t) {
            $t->unsignedInteger('retention_count')->default(10)->after('auto_migrate');
            $t->unsignedInteger('retention_days')->default(30)->after('retention_count');
        });
    }
    public function down(): void
    {
        Schema::table('deploy_sync_settings', function (Blueprint $t) {
            $t->dropColumn(['retention_count', 'retention_days']);
        });
    }
};
