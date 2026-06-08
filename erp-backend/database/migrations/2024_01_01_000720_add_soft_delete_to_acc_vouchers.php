<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Soft-delete support for accounting vouchers.
 *
 * Adds:
 *   - deleted_at  : when the voucher was soft-deleted (NULL = active)
 *   - deleted_by  : user id of the Super Admin who deleted it
 *   - prev_status : previous status before soft delete, used to restore
 *
 * Soft-deleted vouchers get status = 'deleted' so existing reports that
 * filter on status = 'approved' automatically exclude them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('acc_vouchers', function (Blueprint $table) {
            if (!Schema::hasColumn('acc_vouchers', 'deleted_at')) {
                $table->timestamp('deleted_at')->nullable()->index();
            }
            if (!Schema::hasColumn('acc_vouchers', 'deleted_by')) {
                $table->uuid('deleted_by')->nullable();
            }
            if (!Schema::hasColumn('acc_vouchers', 'prev_status')) {
                $table->string('prev_status', 20)->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('acc_vouchers', function (Blueprint $table) {
            if (Schema::hasColumn('acc_vouchers', 'prev_status')) {
                $table->dropColumn('prev_status');
            }
            if (Schema::hasColumn('acc_vouchers', 'deleted_by')) {
                $table->dropColumn('deleted_by');
            }
            if (Schema::hasColumn('acc_vouchers', 'deleted_at')) {
                $table->dropColumn('deleted_at');
            }
        });
    }
};
