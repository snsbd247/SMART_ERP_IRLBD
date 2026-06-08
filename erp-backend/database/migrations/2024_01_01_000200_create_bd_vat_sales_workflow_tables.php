<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Bangladesh VAT Sales Workflow
 * PO → VAT Challan → Delivery Challan → Customer Receive → HO Receive → Invoice → Bill Submit → Payment/TDS
 * Additive only — existing tables untouched.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('purchase_orders', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('po_number', 50)->unique();
            $t->date('po_date');
            $t->uuid('customer_id');
            $t->date('delivery_date')->nullable();
            $t->string('status', 20)->default('open');
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

        Schema::create('vat_challans', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('challan_number', 50)->unique();
            $t->date('challan_date');
            $t->uuid('customer_id');
            $t->uuid('purchase_order_id');
            $t->string('vehicle_no', 50)->nullable();
            $t->string('driver_name', 100)->nullable();
            $t->decimal('subtotal', 18, 2)->default(0);
            $t->decimal('vat_amount', 18, 2)->default(0);
            $t->decimal('grand_total', 18, 2)->default(0);
            $t->string('source', 20)->default('purchase_order');
            $t->string('status', 20)->default('issued');
            $t->string('attachment_url', 500)->nullable();
            $t->text('notes')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('financial_year_id')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->softDeletes();
            $t->foreign('purchase_order_id')->references('id')->on('purchase_orders')->restrictOnDelete();
            $t->index(['customer_id', 'challan_date']);
            $t->index('purchase_order_id');
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
            $t->index('vat_challan_id');
        });

        Schema::create('delivery_challans', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('dc_number', 50)->unique();
            $t->date('dc_date');
            $t->uuid('vat_challan_id');
            $t->uuid('vat_challan_item_id');
            $t->uuid('product_id');
            $t->decimal('qty', 18, 3)->default(0);
            $t->uuid('customer_id');
            $t->string('status', 20)->default('issued'); // issued|delivered|customer_received|sent_to_ho|ho_received|invoiced
            $t->string('attachment_url', 500)->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->foreign('vat_challan_id')->references('id')->on('vat_challans')->cascadeOnDelete();
            $t->foreign('vat_challan_item_id')->references('id')->on('vat_challan_items')->cascadeOnDelete();
            $t->index(['customer_id', 'status']);
        });

        Schema::create('customer_receives', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('delivery_challan_id');
            $t->date('receive_date');
            $t->string('received_by_name', 100)->nullable();
            $t->string('transport_info', 200)->nullable();
            $t->string('scan_url', 500)->nullable();
            $t->text('notes')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->foreign('delivery_challan_id')->references('id')->on('delivery_challans')->cascadeOnDelete();
            $t->index('delivery_challan_id');
        });

        Schema::create('ho_receives', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('delivery_challan_id');
            $t->date('ho_receive_date');
            $t->uuid('verified_by')->nullable();
            $t->boolean('missing_flag')->default(false);
            $t->text('notes')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->foreign('delivery_challan_id')->references('id')->on('delivery_challans')->cascadeOnDelete();
            $t->index('delivery_challan_id');
        });

        Schema::create('sales_invoices_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('invoice_number', 50)->unique();
            $t->date('invoice_date');
            $t->uuid('customer_id');
            $t->string('mode', 20)->default('single'); // single|same_day|custom
            $t->decimal('subtotal', 18, 2)->default(0);
            $t->decimal('vat_total', 18, 2)->default(0);
            $t->decimal('grand_total', 18, 2)->default(0);
            $t->decimal('paid_amount', 18, 2)->default(0);
            $t->decimal('tds_amount', 18, 2)->default(0);
            $t->decimal('due_amount', 18, 2)->default(0);
            $t->string('status', 20)->default('draft'); // draft|posted|partial_paid|paid|cancelled
            $t->uuid('voucher_id')->nullable();
            $t->text('notes')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('financial_year_id')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->softDeletes();
            $t->index(['customer_id', 'status']);
            $t->index('invoice_date');
        });

        Schema::create('sales_invoice_items_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('invoice_id');
            $t->uuid('product_id');
            $t->decimal('qty', 18, 3)->default(0);
            $t->decimal('rate', 18, 4)->default(0);
            $t->decimal('vat_pct', 8, 2)->default(0);
            $t->decimal('line_subtotal', 18, 2)->default(0);
            $t->decimal('vat_amount', 18, 2)->default(0);
            $t->decimal('line_total', 18, 2)->default(0);
            $t->uuid('source_vat_challan_item_id')->nullable();
            $t->integer('sort_order')->default(0);
            $t->foreign('invoice_id')->references('id')->on('sales_invoices_v2')->cascadeOnDelete();
            $t->index('invoice_id');
        });

        Schema::create('invoice_challans', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('invoice_id');
            $t->uuid('vat_challan_id');
            $t->timestamp('created_at')->useCurrent();
            $t->foreign('invoice_id')->references('id')->on('sales_invoices_v2')->cascadeOnDelete();
            $t->foreign('vat_challan_id')->references('id')->on('vat_challans');
            $t->unique(['invoice_id', 'vat_challan_id']);
        });

        Schema::create('invoice_payments', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('payment_number', 50)->unique();
            $t->uuid('invoice_id');
            $t->date('payment_date');
            $t->string('mode', 20)->default('bank'); // cash|bank|cheque|online
            $t->decimal('amount_received', 18, 2)->default(0);
            $t->decimal('tds_amount', 18, 2)->default(0);
            $t->decimal('total_settled', 18, 2)->default(0);
            $t->uuid('bank_account_id')->nullable();
            $t->string('reference', 100)->nullable();
            $t->uuid('voucher_id')->nullable();
            $t->text('notes')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('financial_year_id')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->foreign('invoice_id')->references('id')->on('sales_invoices_v2');
            $t->index(['invoice_id', 'payment_date']);
        });

        Schema::create('tds_entries', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('invoice_id');
            $t->uuid('payment_id')->nullable();
            $t->decimal('tds_pct', 8, 2)->default(0);
            $t->decimal('tds_amount', 18, 2)->default(0);
            $t->string('certificate_no', 100)->nullable();
            $t->date('certificate_date')->nullable();
            $t->uuid('voucher_id')->nullable();
            $t->text('notes')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->foreign('invoice_id')->references('id')->on('sales_invoices_v2');
            $t->foreign('payment_id')->references('id')->on('invoice_payments')->nullOnDelete();
            $t->index('invoice_id');
        });

        Schema::create('invoice_status_logs', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('invoice_id');
            $t->string('old_status', 20)->nullable();
            $t->string('new_status', 20);
            $t->uuid('changed_by')->nullable();
            $t->text('notes')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->foreign('invoice_id')->references('id')->on('sales_invoices_v2')->cascadeOnDelete();
            $t->index('invoice_id');
        });

        // Seed number sequences for the new doc types
        \DB::table('number_sequences')->insertOrIgnore([
            ['id' => 'purchase_order',  'prefix' => 'PO',  'current_number' => 0, 'year' => (int) date('Y'), 'description' => 'Customer Purchase Order'],
            ['id' => 'vat_challan',     'prefix' => 'VCH', 'current_number' => 0, 'year' => (int) date('Y'), 'description' => 'VAT Challan (Mushak 6.3)'],
            ['id' => 'delivery_challan','prefix' => 'DC',  'current_number' => 0, 'year' => (int) date('Y'), 'description' => 'Delivery Challan'],
            ['id' => 'sales_invoice_v2','prefix' => 'INV', 'current_number' => 0, 'year' => (int) date('Y'), 'description' => 'Consolidated Sales Invoice'],
            ['id' => 'invoice_payment', 'prefix' => 'RCP', 'current_number' => 0, 'year' => (int) date('Y'), 'description' => 'Invoice Payment Receipt'],
            ['id' => 'tds_entry',       'prefix' => 'TDS', 'current_number' => 0, 'year' => (int) date('Y'), 'description' => 'TDS Entry'],
        ]);
    }

    public function down(): void
    {
        foreach ([
            'invoice_status_logs','tds_entries','invoice_payments',
            'invoice_challans','sales_invoice_items_v2','sales_invoices_v2',
            'ho_receives','customer_receives','delivery_challans',
            'vat_challan_items','vat_challans',
            'po_amendments','purchase_order_items','purchase_orders',
        ] as $tbl) {
            Schema::dropIfExists($tbl);
        }
    }
};
