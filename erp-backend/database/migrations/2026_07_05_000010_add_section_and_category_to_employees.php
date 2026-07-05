<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add `section_id` and `employee_category` columns to the employees table.
 *
 * The frontend Add/Edit Employee form has always sent these fields, but on
 * VPS/MySQL they were silently dropped by Eloquent because the columns and
 * the model's fillable list did not include them. This adds parity with the
 * Supabase schema so the values actually persist.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('employees')) return;

        Schema::table('employees', function (Blueprint $table) {
            if (!Schema::hasColumn('employees', 'section_id')) {
                $table->uuid('section_id')->nullable()->after('branch_id');
                $table->index('section_id');
            }
            if (!Schema::hasColumn('employees', 'employee_category')) {
                $table->string('employee_category', 30)->default('staff')->after('section_id');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('employees')) return;

        Schema::table('employees', function (Blueprint $table) {
            if (Schema::hasColumn('employees', 'section_id')) {
                try { $table->dropIndex(['section_id']); } catch (\Throwable) {}
                $table->dropColumn('section_id');
            }
            if (Schema::hasColumn('employees', 'employee_category')) {
                $table->dropColumn('employee_category');
            }
        });
    }
};
