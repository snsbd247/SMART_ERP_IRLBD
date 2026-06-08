<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('vat_challans', function (Blueprint $t) {
            if (!Schema::hasColumn('vat_challans', 'purchase_order_id')) {
                $t->uuid('purchase_order_id')->nullable()->after('customer_id');
                $t->index('purchase_order_id');
            }
        });

        DB::table('vat_challans')
            ->where('source', '!=', 'purchase_order')
            ->update(['source' => 'purchase_order']);

        Schema::table('vat_challan_items', function (Blueprint $t) {
            if (!Schema::hasColumn('vat_challan_items', 'purchase_order_item_id')) {
                $t->uuid('purchase_order_item_id')->nullable()->after('product_id');
                $t->index('purchase_order_item_id');
            }
            if (!Schema::hasColumn('vat_challan_items', 'po_qty_consumed')) {
                $t->decimal('po_qty_consumed', 18, 3)->default(0)->after('qty');
            }
        });

        if (Schema::hasColumn('vat_challans', 'purchase_order_id')) {
            try { DB::statement("ALTER TABLE vat_challans MODIFY purchase_order_id CHAR(36) NOT NULL"); } catch (Throwable $e) {}
        }
        if (Schema::hasColumn('vat_challan_items', 'purchase_order_item_id')) {
            try { DB::statement("ALTER TABLE vat_challan_items MODIFY purchase_order_item_id CHAR(36) NOT NULL"); } catch (Throwable $e) {}
        }
    }

    public function down(): void
    {
        Schema::table('vat_challan_items', function (Blueprint $t) {
            if (Schema::hasColumn('vat_challan_items', 'po_qty_consumed')) $t->dropColumn('po_qty_consumed');
            if (Schema::hasColumn('vat_challan_items', 'purchase_order_item_id')) $t->dropColumn('purchase_order_item_id');
        });
        Schema::table('vat_challans', function (Blueprint $t) {
            if (Schema::hasColumn('vat_challans', 'purchase_order_id')) $t->dropColumn('purchase_order_id');
        });
    }
};
