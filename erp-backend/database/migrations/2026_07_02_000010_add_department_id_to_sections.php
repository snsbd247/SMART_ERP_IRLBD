<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the `department_id` column to `sections` so the Sections page
 * (which lets users pick a Department per section) can persist the value.
 * The Supabase schema already has this column; MySQL/VPS was missing it,
 * causing "Unknown column 'department_id'" errors on save.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('sections') && !Schema::hasColumn('sections', 'department_id')) {
            Schema::table('sections', function (Blueprint $table) {
                $table->uuid('department_id')->nullable()->after('branch_id');
                $table->index('department_id');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('sections') && Schema::hasColumn('sections', 'department_id')) {
            Schema::table('sections', function (Blueprint $table) {
                $table->dropIndex(['department_id']);
                $table->dropColumn('department_id');
            });
        }
    }
};
