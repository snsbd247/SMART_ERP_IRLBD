<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('voucher_approval_history')) return;

        Schema::create('voucher_approval_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('voucher_id')->index();
            $table->uuid('actor_user_id')->nullable()->index();
            $table->string('actor_name', 100)->nullable();
            $table->string('action', 20);            // approve | reject | reopen
            $table->string('before_status', 20)->nullable();
            $table->string('after_status', 20)->nullable();
            $table->text('note')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('voucher_id')->references('id')->on('acc_vouchers')->cascadeOnDelete();
            $table->foreign('actor_user_id')->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('voucher_approval_history');
    }
};
