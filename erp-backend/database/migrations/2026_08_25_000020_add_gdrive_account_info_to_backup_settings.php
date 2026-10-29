<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('backup_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('backup_settings', 'gdrive_account_email')) {
                $table->string('gdrive_account_email', 255)->nullable()->after('gdrive_refresh_token');
            }
            if (!Schema::hasColumn('backup_settings', 'gdrive_folder_name')) {
                $table->string('gdrive_folder_name', 255)->nullable()->after('gdrive_folder_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('backup_settings', function (Blueprint $table) {
            foreach (['gdrive_account_email', 'gdrive_folder_name'] as $col) {
                if (Schema::hasColumn('backup_settings', $col)) $table->dropColumn($col);
            }
        });
    }
};
