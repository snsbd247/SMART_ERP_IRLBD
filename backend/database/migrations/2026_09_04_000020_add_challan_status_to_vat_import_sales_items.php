<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tracks the Challan-side (PO -> VAT Challan -> Delivery Challan) import
 * separately from the Invoice-side import for the same line-item, so a
 * challan can be pulled into the app at its own stage (left "pending" like
 * a real fresh delivery, to be advanced via the normal Customer Receive /
 * HO Receive / Invoice Queue pages) without forcing the whole chain to
 * completion — and so importing the invoice later correctly reuses
 * whatever was already created instead of duplicating it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vat_import_sales_items_staging', function (Blueprint $t) {
            if (!Schema::hasColumn('vat_import_sales_items_staging', 'challan_status')) {
                $t->string('challan_status', 20)->default('pending')->after('po_date'); // pending|imported
            }
            if (!Schema::hasColumn('vat_import_sales_items_staging', 'created_purchase_order_id')) {
                $t->uuid('created_purchase_order_id')->nullable();
            }
            if (!Schema::hasColumn('vat_import_sales_items_staging', 'created_vat_challan_id')) {
                $t->uuid('created_vat_challan_id')->nullable();
            }
            if (!Schema::hasColumn('vat_import_sales_items_staging', 'created_vat_challan_item_id')) {
                $t->uuid('created_vat_challan_item_id')->nullable();
            }
            if (!Schema::hasColumn('vat_import_sales_items_staging', 'created_delivery_challan_id')) {
                $t->uuid('created_delivery_challan_id')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('vat_import_sales_items_staging', function (Blueprint $t) {
            foreach (['challan_status', 'created_purchase_order_id', 'created_vat_challan_id', 'created_vat_challan_item_id', 'created_delivery_challan_id'] as $col) {
                if (Schema::hasColumn('vat_import_sales_items_staging', $col)) $t->dropColumn($col);
            }
        });
    }
};
