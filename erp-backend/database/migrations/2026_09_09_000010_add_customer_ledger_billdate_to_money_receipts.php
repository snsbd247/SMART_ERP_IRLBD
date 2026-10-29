<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('money_receipts', function (Blueprint $table) {
            // Reference-only links (same non-posting convention as
            // receipt_voucher_id) — picked from Customers / Chart of Accounts
            // so the printed record is consistent, but nothing here touches
            // ledgers or balances.
            $table->uuid('customer_id')->nullable()->after('receipt_voucher_id');
            $table->uuid('on_account_ledger_id')->nullable()->after('on_account_of');
            $table->date('against_bill_date')->nullable()->after('against_bill_no');

            $table->index('customer_id');
            $table->index('on_account_ledger_id');
        });
    }

    public function down(): void
    {
        Schema::table('money_receipts', function (Blueprint $table) {
            $table->dropColumn(['customer_id', 'on_account_ledger_id', 'against_bill_date']);
        });
    }
};
