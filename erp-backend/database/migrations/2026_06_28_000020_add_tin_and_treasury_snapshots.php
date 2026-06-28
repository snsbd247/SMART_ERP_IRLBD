<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add TIN to parties and snapshot fields to treasury_entries (VPS / Laravel mirror).
 * Safe Extension Only — all columns nullable, hasColumn guards.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('employees') && !Schema::hasColumn('employees', 'tin_no')) {
            Schema::table('employees', fn (Blueprint $t) => $t->string('tin_no', 50)->nullable());
        }
        if (Schema::hasTable('customers') && !Schema::hasColumn('customers', 'tin_no')) {
            Schema::table('customers', fn (Blueprint $t) => $t->string('tin_no', 50)->nullable());
        }
        if (Schema::hasTable('suppliers') && !Schema::hasColumn('suppliers', 'tin_no')) {
            Schema::table('suppliers', fn (Blueprint $t) => $t->string('tin_no', 50)->nullable());
        }
        if (Schema::hasTable('treasury_entries')) {
            Schema::table('treasury_entries', function (Blueprint $t) {
                if (!Schema::hasColumn('treasury_entries', 'tin_snapshot'))         $t->string('tin_snapshot', 50)->nullable();
                if (!Schema::hasColumn('treasury_entries', 'designation_snapshot')) $t->string('designation_snapshot', 150)->nullable();
                if (!Schema::hasColumn('treasury_entries', 'branch_name_snapshot')) $t->string('branch_name_snapshot', 150)->nullable();
                if (!Schema::hasColumn('treasury_entries', 'challan_base_amount'))  $t->decimal('challan_base_amount', 18, 2)->nullable();
            });
        }
    }

    public function down(): void { /* Safe Extension Only — no-op */ }
};
