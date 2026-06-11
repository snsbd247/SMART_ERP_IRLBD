<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        foreach (['sales_returns', 'purchase_returns'] as $tbl) {
            if (Schema::hasTable($tbl) && ! Schema::hasColumn($tbl, 'warehouse_id')) {
                Schema::table($tbl, function (Blueprint $t) {
                    $t->uuid('warehouse_id')->nullable()->after('branch_id');
                });
            }
        }
    }

    public function down(): void
    {
        foreach (['sales_returns', 'purchase_returns'] as $tbl) {
            if (Schema::hasTable($tbl) && Schema::hasColumn($tbl, 'warehouse_id')) {
                Schema::table($tbl, function (Blueprint $t) {
                    $t->dropColumn('warehouse_id');
                });
            }
        }
    }
};
