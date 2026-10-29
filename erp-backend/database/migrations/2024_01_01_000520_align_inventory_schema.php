<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Align the Laravel inventory schema with the column names the React
 * frontend expects (PostgREST-style):
 *   - stock_groups table (was missing)
 *   - item_master.stock_group_id, item_master.is_active
 *   - warehouses.warehouse_name / warehouse_code / status mirrors
 */
return new class extends Migration {
    public function up(): void
    {
        // 1. stock_groups (parent/child hierarchy + primary_group_id)
        if (!Schema::hasTable('stock_groups')) {
            Schema::create('stock_groups', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('name', 100);
                $table->uuid('parent_id')->nullable();
                $table->uuid('primary_group_id')->nullable();
                $table->text('description')->nullable();
                $table->tinyInteger('is_active')->default(1);
                $table->timestamps();
                $table->index('parent_id');
            });
        }

        // 2. item_master extra columns the frontend queries
        if (Schema::hasTable('item_master')) {
            Schema::table('item_master', function (Blueprint $table) {
                if (!Schema::hasColumn('item_master', 'stock_group_id')) {
                    $table->uuid('stock_group_id')->nullable()->after('category_id');
                    $table->index('stock_group_id');
                }
                if (!Schema::hasColumn('item_master', 'is_active')) {
                    $table->tinyInteger('is_active')->default(1)->after('status');
                }
            });
            // keep is_active in sync with status for legacy rows
            DB::statement("UPDATE item_master SET is_active = CASE WHEN status='active' THEN 1 ELSE 0 END");
        }

        // 3. warehouses: expose warehouse_name / warehouse_code / status mirrors
        if (Schema::hasTable('warehouses')) {
            Schema::table('warehouses', function (Blueprint $table) {
                if (!Schema::hasColumn('warehouses', 'warehouse_name')) {
                    $table->string('warehouse_name', 100)->nullable()->after('name');
                }
                if (!Schema::hasColumn('warehouses', 'warehouse_code')) {
                    $table->string('warehouse_code', 20)->nullable()->after('warehouse_name');
                }
                if (!Schema::hasColumn('warehouses', 'status')) {
                    $table->string('status', 20)->default('active')->after('is_active');
                }
            });
            DB::statement("UPDATE warehouses SET warehouse_name = COALESCE(warehouse_name, name)");
            DB::statement("UPDATE warehouses SET warehouse_code = COALESCE(warehouse_code, code)");
            DB::statement("UPDATE warehouses SET status = CASE WHEN is_active=1 THEN 'active' ELSE 'inactive' END");
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('warehouses')) {
            Schema::table('warehouses', function (Blueprint $table) {
                foreach (['warehouse_name', 'warehouse_code', 'status'] as $c) {
                    if (Schema::hasColumn('warehouses', $c)) $table->dropColumn($c);
                }
            });
        }
        if (Schema::hasTable('item_master')) {
            Schema::table('item_master', function (Blueprint $table) {
                foreach (['stock_group_id', 'is_active'] as $c) {
                    if (Schema::hasColumn('item_master', $c)) $table->dropColumn($c);
                }
            });
        }
        Schema::dropIfExists('stock_groups');
    }
};
