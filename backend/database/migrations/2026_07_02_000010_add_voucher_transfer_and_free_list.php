<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Voucher Type Change (Transfer) support.
 *
 *  1) number_sequence_free_list — released voucher numbers reusable by next entry.
 *  2) acc_vouchers additions:
 *       - source_module         : marks auto-posted vouchers (Sales/Purchase) — blocked from transfer.
 *       - transferred_to_id     : links old voucher → new voucher after type change.
 *       - transferred_from_id   : links new voucher ← old voucher.
 *       - transfer_reason       : audit note captured at transfer time.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('number_sequence_free_list')) {
            Schema::create('number_sequence_free_list', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('sequence_id', 100);
                $table->string('number', 50);
                $table->uuid('released_by')->nullable();
                $table->timestamp('released_at')->useCurrent();
                $table->timestamp('consumed_at')->nullable();
                $table->index(['sequence_id', 'consumed_at']);
            });
        }

        Schema::table('acc_vouchers', function (Blueprint $table) {
            if (!Schema::hasColumn('acc_vouchers', 'source_module')) {
                $table->string('source_module', 50)->nullable()->index();
            }
            if (!Schema::hasColumn('acc_vouchers', 'transferred_to_id')) {
                $table->uuid('transferred_to_id')->nullable();
            }
            if (!Schema::hasColumn('acc_vouchers', 'transferred_from_id')) {
                $table->uuid('transferred_from_id')->nullable();
            }
            if (!Schema::hasColumn('acc_vouchers', 'transfer_reason')) {
                $table->text('transfer_reason')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('acc_vouchers', function (Blueprint $table) {
            foreach (['transfer_reason', 'transferred_from_id', 'transferred_to_id', 'source_module'] as $col) {
                if (Schema::hasColumn('acc_vouchers', $col)) $table->dropColumn($col);
            }
        });
        Schema::dropIfExists('number_sequence_free_list');
    }
};
