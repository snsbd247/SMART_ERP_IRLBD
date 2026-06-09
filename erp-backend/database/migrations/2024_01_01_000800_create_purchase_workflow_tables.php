<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * New Purchase Workflow: PR → PO → GRN → Bill → Payment
 * Mirrors the Supabase schema; introduced alongside the legacy `purchases` table
 * (Safe Extension Only — legacy tables remain intact).
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1) Purchase Requisitions
        Schema::create('purchase_requisitions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('pr_number', 40)->unique();
            $table->date('pr_date');
            $table->uuid('branch_id')->nullable();
            $table->uuid('requested_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->text('notes')->nullable();
            $table->string('status', 30)->default('pending_admin');
            $table->uuid('created_by')->nullable();
            $table->timestamps();
            $table->index(['pr_date', 'status']);
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
        });

        Schema::create('purchase_requisition_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('pr_id');
            $table->uuid('product_id');
            $table->decimal('qty_required', 15, 2);
            $table->decimal('qty_ordered', 15, 2)->default(0);
            $table->text('remarks')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->foreign('pr_id')->references('id')->on('purchase_requisitions')->cascadeOnDelete();
            $table->index('product_id');
        });

        // 2) Purchase Orders v2
        Schema::create('purchase_orders_v2', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('po_number', 40)->unique();
            $table->date('po_date');
            $table->uuid('supplier_id');
            $table->uuid('pr_id')->nullable();
            $table->uuid('branch_id')->nullable();
            $table->decimal('subtotal', 15, 2)->default(0);
            $table->decimal('vat_amount', 15, 2)->default(0);
            $table->decimal('grand_total', 15, 2)->default(0);
            $table->string('status', 30)->default('draft');
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();
            $table->index(['po_date', 'status']);
            $table->foreign('supplier_id')->references('id')->on('suppliers')->cascadeOnDelete();
            $table->foreign('pr_id')->references('id')->on('purchase_requisitions')->nullOnDelete();
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
        });

        Schema::create('purchase_order_items_v2', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('po_id');
            $table->uuid('pr_item_id')->nullable();
            $table->uuid('product_id');
            $table->decimal('qty_ordered', 15, 2);
            $table->decimal('qty_received', 15, 2)->default(0);
            $table->decimal('rate', 15, 2)->default(0);
            $table->decimal('vat_pct', 8, 2)->default(0);
            $table->decimal('line_total', 15, 2)->default(0);
            $table->timestamp('created_at')->useCurrent();
            $table->foreign('po_id')->references('id')->on('purchase_orders_v2')->cascadeOnDelete();
            $table->foreign('pr_item_id')->references('id')->on('purchase_requisition_items')->nullOnDelete();
            $table->index('product_id');
        });

        // 3) GRNs
        Schema::create('grns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('grn_number', 40)->unique();
            $table->date('grn_date');
            $table->uuid('po_id');
            $table->uuid('supplier_id');
            $table->string('supplier_invoice_no', 80)->nullable();
            $table->date('supplier_invoice_date')->nullable();
            $table->uuid('branch_id')->nullable();
            $table->uuid('received_by')->nullable();
            $table->decimal('total_amount', 15, 2)->default(0);
            $table->string('status', 30)->default('posted');
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();
            $table->index(['grn_date', 'status']);
            $table->foreign('po_id')->references('id')->on('purchase_orders_v2')->cascadeOnDelete();
            $table->foreign('supplier_id')->references('id')->on('suppliers')->cascadeOnDelete();
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
        });

        Schema::create('grn_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('grn_id');
            $table->uuid('po_item_id');
            $table->uuid('product_id');
            $table->decimal('qty_received', 15, 2);
            $table->decimal('rate', 15, 2)->default(0);
            $table->decimal('line_total', 15, 2)->default(0);
            $table->decimal('qty_billed', 15, 2)->default(0);
            $table->timestamp('created_at')->useCurrent();
            $table->foreign('grn_id')->references('id')->on('grns')->cascadeOnDelete();
            $table->foreign('po_item_id')->references('id')->on('purchase_order_items_v2')->cascadeOnDelete();
            $table->index('product_id');
        });

        // 4) Purchase Bills + GRN bridge + Payments
        Schema::create('purchase_bills', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('bill_number', 40)->unique();
            $table->date('bill_date');
            $table->uuid('supplier_id');
            $table->string('supplier_bill_no', 80)->nullable();
            $table->date('due_date')->nullable();
            $table->uuid('branch_id')->nullable();
            $table->decimal('subtotal', 15, 2)->default(0);
            $table->decimal('vat_amount', 15, 2)->default(0);
            $table->decimal('grand_total', 15, 2)->default(0);
            $table->decimal('paid_amount', 15, 2)->default(0);
            $table->decimal('tds_amount', 15, 2)->default(0);
            $table->string('status', 20)->default('unpaid');
            $table->uuid('voucher_id')->nullable();
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();
            $table->index(['bill_date', 'status']);
            $table->foreign('supplier_id')->references('id')->on('suppliers')->cascadeOnDelete();
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
        });

        Schema::create('purchase_bill_grns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('bill_id');
            $table->uuid('grn_id');
            $table->decimal('amount', 15, 2)->default(0);
            $table->timestamp('created_at')->useCurrent();
            $table->foreign('bill_id')->references('id')->on('purchase_bills')->cascadeOnDelete();
            $table->foreign('grn_id')->references('id')->on('grns')->cascadeOnDelete();
            $table->unique(['bill_id', 'grn_id']);
        });

        Schema::create('purchase_bill_payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('payment_number', 40)->unique();
            $table->uuid('bill_id');
            $table->date('payment_date');
            $table->decimal('amount', 15, 2);
            $table->decimal('tds_amount', 15, 2)->default(0);
            $table->string('payment_method', 30)->default('cash');
            $table->uuid('bank_account_id')->nullable();
            $table->string('reference_no', 80)->nullable();
            $table->uuid('voucher_id')->nullable();
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();
            $table->index(['payment_date']);
            $table->foreign('bill_id')->references('id')->on('purchase_bills')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_bill_payments');
        Schema::dropIfExists('purchase_bill_grns');
        Schema::dropIfExists('purchase_bills');
        Schema::dropIfExists('grn_items');
        Schema::dropIfExists('grns');
        Schema::dropIfExists('purchase_order_items_v2');
        Schema::dropIfExists('purchase_orders_v2');
        Schema::dropIfExists('purchase_requisition_items');
        Schema::dropIfExists('purchase_requisitions');
    }
};
