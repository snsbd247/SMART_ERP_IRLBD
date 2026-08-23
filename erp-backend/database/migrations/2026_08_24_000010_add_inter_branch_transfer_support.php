<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Inter-branch fund transfers (e.g. HO funding Factory Petty Cash) need to
 * post as two branch-scoped vouchers instead of one, so each branch's own
 * Account Ledger stays fully self-contained (no cross-branch data needed to
 * reconcile a balance) while BranchScope keeps enforcing strict per-branch
 * visibility. This adds:
 *   - acc_vouchers.linked_voucher_id : points a transfer leg at its sibling
 *     leg (the other branch's voucher for the same transfer).
 *   - chart_of_accounts 1259 "Inter-Branch Fund Transfer (Clearing)" : the
 *     shared clearing account both legs post through.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('acc_vouchers', function (Blueprint $table) {
            if (!Schema::hasColumn('acc_vouchers', 'linked_voucher_id')) {
                $table->uuid('linked_voucher_id')->nullable()->after('transfer_reason');
            }
        });

        if (!DB::table('chart_of_accounts')->where('account_code', '1259')->exists()) {
            $parentId = DB::table('chart_of_accounts')->where('account_code', '1250')->value('id');
            DB::table('chart_of_accounts')->insert([
                'id' => (string) Str::uuid(),
                'account_code' => '1259',
                'account_name' => 'Inter-Branch Fund Transfer (Clearing)',
                'account_type' => 'asset',
                'parent_id' => $parentId,
                'opening_balance' => 0,
                'opening_balance_type' => 'debit',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('acc_vouchers', function (Blueprint $table) {
            if (Schema::hasColumn('acc_vouchers', 'linked_voucher_id')) {
                $table->dropColumn('linked_voucher_id');
            }
        });
        DB::table('chart_of_accounts')->where('account_code', '1259')->delete();
    }
};
