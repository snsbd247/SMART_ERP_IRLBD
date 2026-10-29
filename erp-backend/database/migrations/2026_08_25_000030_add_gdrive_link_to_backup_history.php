<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('backup_history', function (Blueprint $table) {
            if (!Schema::hasColumn('backup_history', 'gdrive_file_id')) {
                $table->string('gdrive_file_id', 200)->nullable()->after('storage_path');
            }
            if (!Schema::hasColumn('backup_history', 'gdrive_view_link')) {
                $table->text('gdrive_view_link')->nullable()->after('gdrive_file_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('backup_history', function (Blueprint $table) {
            foreach (['gdrive_file_id', 'gdrive_view_link'] as $col) {
                if (Schema::hasColumn('backup_history', $col)) $table->dropColumn($col);
            }
        });
    }
};
