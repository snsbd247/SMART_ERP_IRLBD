<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasColumn('vat_challans', 'dispatch_id')) {
            DB::statement("UPDATE vat_challans vc JOIN dispatch_items di ON di.dispatch_id = vc.dispatch_id JOIN dispatch_po_allocations dpa ON dpa.dispatch_item_id = di.id SET vc.purchase_order_id = COALESCE(vc.purchase_order_id, dpa.po_id), vc.source = 'purchase_order'");
            Schema::table('vat_challans', function (Blueprint $t) {
                try { $t->dropForeign(['dispatch_id']); } catch (Throwable $e) {}
                $t->dropColumn('dispatch_id');
            });
        }

        Schema::dropIfExists('dispatch_status_logs');
        Schema::dropIfExists('dispatch_po_allocations');
        Schema::dropIfExists('dispatch_items');
        Schema::dropIfExists('dispatches');
    }

    public function down(): void
    {
        // Intentionally not restoring the removed legacy Dispatch workflow.
    }
};