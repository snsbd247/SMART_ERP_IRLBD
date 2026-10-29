<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Safe Extension Only — align Laravel schema with frontend expectations.
 *
 * Adds nullable columns the React frontend schema already
 * references but that were missing from the Laravel migrations:
 *
 *   - customers.receivable_account_id  -> chart_of_accounts.id  (auto-posting)
 *   - stock_movements.stock_group_id   -> stock_groups.id       (stock reports)
 *
 * Both are nullable, no defaults, no behavioural change for existing rows.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('customers')) {
            Schema::table('customers', function (Blueprint $table) {
                if (!Schema::hasColumn('customers', 'receivable_account_id')) {
                    $table->uuid('receivable_account_id')->nullable()->after('status');
                    $table->index('receivable_account_id');
                }
            });
        }

        if (Schema::hasTable('stock_movements')) {
            Schema::table('stock_movements', function (Blueprint $table) {
                if (!Schema::hasColumn('stock_movements', 'stock_group_id')) {
                    $table->uuid('stock_group_id')->nullable()->after('product_id');
                    $table->index('stock_group_id');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('stock_movements') && Schema::hasColumn('stock_movements', 'stock_group_id')) {
            Schema::table('stock_movements', function (Blueprint $table) {
                $table->dropColumn('stock_group_id');
            });
        }
        if (Schema::hasTable('customers') && Schema::hasColumn('customers', 'receivable_account_id')) {
            Schema::table('customers', function (Blueprint $table) {
                $table->dropColumn('receivable_account_id');
            });
        }
    }
};
