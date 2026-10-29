<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('money_receipts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('receipt_no', 20)->unique();
            // Reference-only link to an existing Receipt Voucher (acc_vouchers).
            // Intentionally no accounting effect — this table never touches
            // ledgers/balances, it is purely a printable record.
            $table->uuid('receipt_voucher_id')->nullable();
            $table->string('received_from', 191);
            $table->text('address')->nullable();
            $table->text('on_account_of')->nullable();
            $table->string('payment_mode', 20); // cash | cheque | po | dd
            $table->string('payment_ref_no', 100)->nullable();
            $table->date('receipt_date');
            $table->string('against_bill_no', 100)->nullable();
            $table->decimal('amount', 15, 2);
            $table->string('amount_in_words', 255)->nullable();
            $table->uuid('branch_id')->nullable();
            $table->string('verify_code', 40)->unique();
            $table->uuid('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('receipt_voucher_id');
            $table->index('branch_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('money_receipts');
    }
};
