<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Bangladesh VAT Sales Workflow — Phase 1
 * PO → Dispatch → VAT Challan → Delivery Challan → Receive → HO → Invoice → Payment/TDS
 * Additive only — does NOT modify existing tables.
 */
return new class extends Migration {
    public function up(): void
    {
        // 1. PURCHASE ORDERS
        Schema::create('purchase_orders', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('po_number', 50)->unique();
            $t->date('po_date');
            $t->uuid('customer_id');
            $t->date('delivery_date')->nullable();
            $t->string('status', 20)->default('open'); // draft|open|partial|closed|cancelled
            $t->decimal('subtotal', 18, 2)->default(0);
            $t->decimal('vat_amount', 18, 2)->default(0);
            $t->decimal('grand_total', 18, 2)->default(0);
            $t->text('notes')->nullable();
            $t->string('attachment_url', 500)->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('financial_year_id')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->softDeletes();
            $t->index(['customer_id', 'status']);
            $t->index('po_date');
        });

        Schema::create('purchase_order_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('po_id');
            $t->uuid('product_id');
            $t->decimal('qty_ordered', 18, 3)->default(0);
            $t->decimal('qty_delivered', 18, 3)->default(0);
            $t->decimal('qty_remaining', 18, 3)->default(0);
            $t->decimal('rate', 18, 4)->default(0);
            $t->decimal('vat_pct', 8, 2)->default(0);
            $t->decimal('line_subtotal', 18, 2)->default(0);
            $t->decimal('line_vat', 18, 2)->default(0);
            $t->decimal('line_total', 18, 2)->default(0);
            $t->integer('sort_order')->default(0);
            $t->foreign('po_id')->references('id')->on('purchase_orders')->cascadeOnDelete();
            $t->index(['po_id', 'product_id']);
        });

        Schema::create('po_amendments', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('po_id');
            $t->uuid('amended_by')->nullable();
            $t->json('old_data')->nullable();
            $t->json('new_data')->nullable();
            $t->text('reason')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->foreign('po_id')->references('id')->on('purchase_orders')->cascadeOnDelete();
        });

        // 2. DISPATCH
        Schema::create('dispatches', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('dispatch_number', 50)->unique();
            $t->date('dispatch_date');
            $t->uuid('customer_id');
            $t->string('vehicle_no', 50)->nullable();
            $t->string('driver_name', 100)->nullable();
            $t->string('driver_phone', 30)->nullable();
            $t->string('status', 20)->default('draft'); // draft|dispatched|delivered|received|cancelled
            $t->decimal('total_qty', 18, 3)->default(0);
            $t->text('notes')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('financial_year_id')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->softDeletes();
            $t->index(['customer_id', 'status']);
        });

        Schema::create('dispatch_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('dispatch_id');
            $t->uuid('product_id');
            $t->decimal('qty', 18, 3)->default(0);
            $t->integer('sort_order')->default(0);
            $t->foreign('dispatch_id')->references('id')->on('dispatches')->cascadeOnDelete();
            $t->index('dispatch_id');
        });

        Schema::create('dispatch_po_allocations', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('dispatch_item_id');
            $t->uuid('po_item_id');
            $t->uuid('po_id');
            $t->decimal('allocated_qty', 18, 3)->default(0);
            $t->timestamp('created_at')->useCurrent();
            $t->foreign('dispatch_item_id')->references('id')->on('dispatch_items')->cascadeOnDelete();
            $t->foreign('po_item_id')->references('id')->on('purchase_order_items');
            $t->index(['dispatch_item_id', 'po_item_id']);
        });

        // 3. VAT CHALLAN
        Schema::create('vat_challans', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('challan_number', 50)->unique();
            $t->date('challan_date');
            $t->uuid('customer_id');
            $t->uuid('dispatch_id')->nullable();
            $t->string('vehicle_no', 50)->nullable();
            $t->string('driver_name', 100)->nullable();
            $t->decimal('subtotal', 18, 2)->default(0);
            $t->decimal('vat_amount', 18, 2)->default(0);
            $t->decimal('grand_total', 18, 2)->default(0);
            $t->string('source', 20)->default('manual'); // manual|import
            $t->string('status', 20)->default('issued');
            $t->string('attachment_url', 500)->nullable();
            $t->text('notes')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('financial_year_id')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->softDeletes();
            $t->foreign('dispatch_id')->references('id')->on('dispatches')->nullOnDelete();
            $t->index(['customer_id', 'challan_date']);
            $t->index('status');
        });

        Schema::create('vat_challan_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('vat_challan_id');
            $t->uuid('product_id');
            $t->decimal('qty', 18, 3)->default(0);
            $t->decimal('rate', 18, 4)->default(0);
            $t->decimal('vat_pct', 8, 2)->default(0);
            $t->decimal('line_subtotal', 18, 2)->default(0);
            $t->decimal('vat_amount', 18, 2)->default(0);
            $t->decimal('line_total', 18, 2)->default(0);
            $t->integer('sort_order')->default(0);
            $t->foreign('vat_challan_id')->references('id')->on('vat_challans')->cascadeOnDelete();
            $t->index('vat_