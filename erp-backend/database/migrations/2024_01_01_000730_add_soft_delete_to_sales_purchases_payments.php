<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Soft-delete support for sales invoices, purchases and party payments.
 * Mirrors the pattern already applied to acc_vouchers.
 */
return new class extends Migration
{
    public function up(): void
    {
        // sales_invoices_v2
        if (Schema::hasTable('sales_invoices_v2')) {
            Schema::table('sales_invoices_v2', function (Blueprint $table) {
                if (!Schema::hasColumn('sales_invoices_v2', 'deleted_at')) {
                    $table->timestamp('deleted_at')->nullable()->index();
                }
                if (!Schema::hasColumn('sales_invoices_v2', 'deleted_by')) {
                    $table->uuid('deleted_by')->nullable();
                }
                if (!Schema::hasColumn('sales_invoices_v2', 'prev_status')) {
                    $table->string('prev_status', 20)->nullable();
                }
            });
        }

        // purchases
        if (Schema::hasTable('purchases')) {
            Schema::table('purchases', function (Blueprint $table) {
                if (!Schema::hasColumn('purchases', 'deleted_at')) {
                    $table->timestamp('deleted_at')->nullable()->index();
                }
                if (!Schema::hasColumn('purchases', 'deleted_by')) {
                    $table->uuid('deleted_by')->nullable();
                }
                if (!Schema::hasColumn('purchases', 'prev_status')) {
                    $table->string('prev_status', 20)->nullable();
                }
            });
        }

        // party_payments (no status column, soft delete only)
        if (Schema::hasTable('party_payments')) {
            Schema::table('party_payments', function (Blueprint $table) {
                if (!Schema::hasColumn('party_payments', 'deleted_at')) {
                    $table->timestamp('deleted_at')->nullable()->index();
                }
                if (!Schema::hasColumn('party_payments', 'deleted_by')) {
                    $table->uuid('deleted_by')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        foreach (['sales_invoices_v2', 'purchases'] as $t) {
            if (Schema::hasTable($t)) {
                Schema::table($t, function (Blueprint $table) use ($t) {
                    foreach (['prev_status', 'deleted_by', 'deleted_at'] as $col) {
                        if (Schema::hasColumn($t, $col)) $table->dropColumn($col);
                    }
                });
            }
        }
        if (Schema::hasTable('party_payments')) {
            Schema::table('party_payments', function (Blueprint $table) {
                foreach (['deleted_by', 'deleted_at'] as $col) {
                    if (Schema::hasColumn('party_payments', $col)) $table->dropColumn($col);
                }
            });
        }
    }
};
