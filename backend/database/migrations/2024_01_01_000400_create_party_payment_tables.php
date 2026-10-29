<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Party payment & notes tables.
 *
 * Models that referenced these tables (PartyPayment, PaymentAllocation, PartyNote)
 * existed in App\Models but their schema migration was missing — causing
 * "Table doesn't exist" errors when recording payments or party notes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('party_payments')) {
            Schema::create('party_payments', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('party_id');
                $table->string('party_type', 20); // customer | supplier
                $table->decimal('amount', 15, 2);
                $table->date('payment_date');
                $table->string('payment_method', 30)->default('cash');
                $table->string('reference', 100)->nullable();
                $table->text('notes')->nullable();
                $table->uuid('created_by')->nullable();
                $table->timestamps();

                $table->index(['party_id', 'party_type']);
                $table->index('payment_date');
                $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
            });
        }

        if (!Schema::hasTable('payment_allocations')) {
            Schema::create('payment_allocations', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('payment_id');
                $table->uuid('invoice_id');
                $table->string('invoice_type', 30); // sales_invoice | purchase
                $table->decimal('allocated_amount', 15, 2);

                $table->foreign('payment_id')->references('id')->on('party_payments')->cascadeOnDelete();
                $table->index(['invoice_id', 'invoice_type']);
            });
        }

        if (!Schema::hasTable('party_notes')) {
            Schema::create('party_notes', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('party_id');
                $table->string('party_type', 20); // customer | supplier
                $table->text('note');
                $table->uuid('created_by')->nullable();
                $table->timestamp('created_at')->useCurrent();

                $table->index(['party_id', 'party_type']);
                $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_allocations');
        Schema::dropIfExists('party_payments');
        Schema::dropIfExists('party_notes');
    }
};
