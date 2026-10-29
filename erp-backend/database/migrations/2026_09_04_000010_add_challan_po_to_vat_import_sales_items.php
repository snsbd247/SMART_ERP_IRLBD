<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The VAT software records a Challan No + PO No against most sales invoice
 * lines (a real delivery/PO trail, not synthesized) — carrying them through
 * staging lets the import reconstruct the full
 * PO -> VAT Challan -> Delivery Challan -> Receive -> Invoice chain instead
 * of only creating the final invoice.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vat_import_sales_items_staging', function (Blueprint $t) {
            if (!Schema::hasColumn('vat_import_sales_items_staging', 'challan_no')) {
                $t->string('challan_no', 100)->nullable()->after('godown_name');
            }
            if (!Schema::hasColumn('vat_import_sales_items_staging', 'po_no')) {
                $t->string('po_no', 100)->nullable()->after('challan_no');
            }
            if (!Schema::hasColumn('vat_import_sales_items_staging', 'po_date')) {
                $t->date('po_date')->nullable()->after('po_no');
            }
        });
    }

    public function down(): void
    {
        Schema::table('vat_import_sales_items_staging', function (Blueprint $t) {
            foreach (['challan_no', 'po_no', 'po_date'] as $col) {
                if (Schema::hasColumn('vat_import_sales_items_staging', $col)) $t->dropColumn($col);
            }
        });
    }
};
