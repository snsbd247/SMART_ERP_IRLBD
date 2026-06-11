<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Safe Extension: add multi-item line support to stock_transfers.
 * - New table stock_transfer_items (line items).
 * - Make stock_transfers.item_id / quantity NULLABLE so multi-item rows
 *   don't need legacy single-item columns. Existing single-item rows are
 *   untouched (backward compatible).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('stock_transfer_items')) {
            Schema::create('stock_transfer_items', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('stock_transfer_id');
                $table->uuid('item_id');
                $table->decimal('quantity', 15, 2);
                $table->text('notes')->nullable();
                $table->timestamp('created_at')->useCurrent();

                $table->foreign('stock_transfer_id')->references('id')->on('stock_transfers')->cascadeOnDelete();
                $table->foreign('item_id')->references('id')->on('item_master')->restrictOnDelete();
                $table->index(['stock_transfer_id', 'item_id']);
            });
        }

        // Make legacy single-item columns nullable (MySQL-safe via raw SQL)
        try {
            DB::statement('ALTER TABLE stock_transfers MODIFY item_id CHAR(36) NULL');
            DB::statement('ALTER TABLE stock_transfers MODIFY quantity DECIMAL(15,2) NULL');
        } catch (\Throwable $e) {
            // ignore on engines that already allow null
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_transfer_items');
    }
};
