<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the `stock_adjustments` table used by the Stock Adjustments page.
 * Additive only — safe to run on existing databases.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('stock_adjustments')) {
            return;
        }

        Schema::create('stock_adjustments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('adjustment_number', 50)->unique();
            $table->date('adjustment_date');
            $table->string('adjustment_type', 20); // increase | decrease
            $table->uuid('product_id');
            $table->uuid('warehouse_id')->nullable();
            $table->uuid('branch_id')->nullable();
            $table->decimal('quantity', 15, 2);
            $table->decimal('unit_cost', 15, 2)->default(0);
            $table->decimal('total_value', 15, 2)->default(0);
            $table->string('reason', 255)->nullable();
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('updated_at')->useCurrent();

            $table->index(['product_id', 'adjustment_date']);
            $table->index('warehouse_id');
            $table->index('branch_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_adjustments');
    }
};
