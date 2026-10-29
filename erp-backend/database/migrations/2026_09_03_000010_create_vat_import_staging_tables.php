<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Staging area for one-way historical Sales/Purchase import from an external
 * VAT accounting system (MS SQL Server, read-only source — never written to).
 * A local script extracts and JSON-dumps the source data; an artisan command
 * loads it here (skipping rows already staged, by source_ref_no); a review
 * page lets an admin selectively convert pending rows into real
 * sales_invoices_v2 / supplier_bills_v2 records (+ accounting voucher +
 * match-or-create customer/supplier/item). Imported rows never show again.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vat_import_sales_staging', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('source_ref_no', 60)->unique();
            $t->date('invoice_date');
            $t->string('party_name', 200);
            $t->string('party_bin', 50)->nullable();
            $t->string('party_tin', 50)->nullable();
            $t->text('party_address')->nullable();
            $t->string('party_phone', 50)->nullable();
            $t->decimal('subtotal', 18, 2)->default(0);
            $t->decimal('vat_amount', 18, 2)->default(0);
            $t->decimal('grand_total', 18, 2)->default(0);
            $t->text('narration')->nullable();
            $t->string('status', 20)->default('pending'); // pending|imported
            $t->uuid('created_customer_id')->nullable();
            $t->uuid('created_sales_invoice_id')->nullable();
            $t->uuid('created_voucher_id')->nullable();
            $t->uuid('imported_by')->nullable();
            $t->timestamp('imported_at')->nullable();
            $t->timestamps();
            $t->index('status');
        });

        Schema::create('vat_import_sales_items_staging', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('staging_id');
            $t->integer('line_no')->default(1);
            $t->string('item_name', 200);
            $t->string('item_hs_code', 50)->nullable();
            $t->string('unit', 20)->nullable();
            $t->decimal('quantity', 18, 4)->default(0);
            $t->decimal('rate', 18, 4)->default(0);
            $t->decimal('vat_pct', 8, 2)->default(0);
            $t->decimal('vat_amount', 18, 2)->default(0);
            $t->decimal('line_subtotal', 18, 2)->default(0);
            $t->decimal('line_total', 18, 2)->default(0);
            $t->string('godown_name', 100)->nullable();
            $t->uuid('created_item_id')->nullable();
            $t->foreign('staging_id')->references('id')->on('vat_import_sales_staging')->cascadeOnDelete();
            $t->index('staging_id');
        });

        Schema::create('vat_import_purchase_staging', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('source_ref_no', 60)->unique();
            $t->date('bill_date');
            $t->string('party_name', 200);
            $t->string('party_bin', 50)->nullable();
            $t->string('party_tin', 50)->nullable();
            $t->text('party_address')->nullable();
            $t->string('party_phone', 50)->nullable();
            $t->decimal('subtotal', 18, 2)->default(0);
            $t->decimal('vat_amount', 18, 2)->default(0);
            $t->decimal('grand_total', 18, 2)->default(0);
            $t->text('narration')->nullable();
            $t->string('status', 20)->default('pending'); // pending|imported
            $t->uuid('created_supplier_id')->nullable();
            $t->uuid('created_bill_id')->nullable();
            $t->uuid('created_voucher_id')->nullable();
            $t->uuid('imported_by')->nullable();
            $t->timestamp('imported_at')->nullable();
            $t->timestamps();
            $t->index('status');
        });

        Schema::create('vat_import_purchase_items_staging', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('staging_id');
            $t->integer('line_no')->default(1);
            $t->string('item_name', 200);
            $t->string('item_hs_code', 50)->nullable();
            $t->string('unit', 20)->nullable();
            $t->decimal('quantity', 18, 4)->default(0);
            $t->decimal('rate', 18, 4)->default(0);
            $t->decimal('vat_pct', 8, 2)->default(0);
            $t->decimal('vat_amount', 18, 2)->default(0);
            $t->decimal('line_subtotal', 18, 2)->default(0);
            $t->decimal('line_total', 18, 2)->default(0);
            $t->string('godown_name', 100)->nullable();
            $t->uuid('created_item_id')->nullable();
            $t->foreign('staging_id')->references('id')->on('vat_import_purchase_staging')->cascadeOnDelete();
            $t->index('staging_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vat_import_purchase_items_staging');
        Schema::dropIfExists('vat_import_purchase_staging');
        Schema::dropIfExists('vat_import_sales_items_staging');
        Schema::dropIfExists('vat_import_sales_staging');
    }
};
