<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('backup_settings', function (Blueprint $table) {
            if (!Schema::hasColumn('backup_settings', 'gdrive_enabled')) {
                $table->tinyInteger('gdrive_enabled')->default(0)->after('retention_days');
            }
            if (!Schema::hasColumn('backup_settings', 'gdrive_client_id')) {
                $table->text('gdrive_client_id')->nullable()->after('gdrive_enabled');
            }
            if (!Schema::hasColumn('backup_settings', 'gdrive_client_secret')) {
                $table->text('gdrive_client_secret')->nullable()->after('gdrive_client_id');
            }
            if (!Schema::hasColumn('backup_settings', 'gdrive_refresh_token')) {
                $table->text('gdrive_refresh_token')->nullable()->after('gdrive_client_secret');
            }
            if (!Schema::hasColumn('backup_settings', 'gdrive_folder_id')) {
                $table->string('gdrive_folder_id', 200)->nullable()->after('gdrive_refresh_token');
            }
            if (!Schema::hasColumn('backup_settings', 'gdrive_format')) {
                $table->string('gdrive_format', 10)->default('sql')->after('gdrive_folder_id');
            }
            if (!Schema::hasColumn('backup_settings', 'last_gdrive_backup_at')) {
                $table->datetime('last_gdrive_backup_at')->nullable()->after('gdrive_format');
            }
            if (!Schema::hasColumn('backup_settings', 'last_gdrive_error')) {
                $table->text('last_gdrive_error')->nullable()->after('last_gdrive_backup_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('backup_settings', function (Blueprint $table) {
            foreach (['gdrive_enabled','gdrive_client_id','gdrive_client_secret','gdrive_refresh_token','gdrive_folder_id','gdrive_format','last_gdrive_backup_at','last_gdrive_error'] as $col) {
                if (Schema::hasColumn('backup_settings', $col)) $table->dropColumn($col);
            }
        });
    }
};
