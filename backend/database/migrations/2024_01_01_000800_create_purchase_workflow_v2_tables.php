<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 2 Backend Sync — Purchase Workflow v2.
 *
 * Mirrors the original schema for the full procure-to-pay workflow so that
 * Laravel/MySQL (cPanel) deployments have parity with the original
 * schema. Source migrations it was ported from:
 *   - 20260609094536  suppliers, purchase_types, purchase_settings,
 *                     purchase_approval_matrix, purchase_audit_log,
 *                     purchase_approval_history, purchase_coa_mapping
 *   - 20260609095337  purchase_requisitions(+items), purchase_orders_v2(+items),
 *                     po_pr_links, po_amendments_v2
 *   - 20260609100307  grns_v2(+items)
 *   - 20260609102632  supplier_bills_v2(+items), supplier_payments_v2,
 *                     supplier_payment_allocations, lc_documents, lc_charges
 *   - 20260609103147  purchase_returns_v2(+items)
 *
 * NOTE: The basic `suppliers` table is created in the earlier
 * 2024_01_01_000030_create_sales_purchase_tables migration with only 6 columns.
 * This migration extends it with the additional ~24 columns needed by the
 * supplier-master UI (BIN, address parts, tax info, payment terms, etc.).
 */
return new class extends Migration
{
    public function up(): void
    {
        // ───────── 1. Extend suppliers ─────────
        Schema::table('suppliers', function (Blueprint $t) {
            if (!Schema::hasColumn('suppliers', 'code'))               $t->string('code', 30)->nullable()->after('id');
            if (!Schema::hasColumn('suppliers', 'contact_person'))     $t->string('contact_person', 100)->nullable();
            if (!Schema::hasColumn('suppliers', 'designation'))        $t->string('designation', 100)->nullable();
            if (!Schema::hasColumn('suppliers', 'mobile'))             $t->string('mobile', 30)->nullable();
            if (!Schema::hasColumn('suppliers', 'bin_number'))         $t->string('bin_number', 30)->nullable();
            if (!Schema::hasColumn('suppliers', 'tin_number'))         $t->string('tin_number', 30)->nullable();
            if (!Schema::hasColumn('suppliers', 'tax_id'))             $t->string('tax_id', 50)->nullable();
            if (!Schema::hasColumn('suppliers', 'website'))            $t->string('website', 200)->nullable();
            if (!Schema::hasColumn('suppliers', 'city'))               $t->string('city', 80)->nullable();
            if (!Schema::hasColumn('suppliers', 'state'))              $t->string('state', 80)->nullable();
            if (!Schema::hasColumn('suppliers', 'country'))            $t->string('country', 80)->nullable();
            if (!Schema::hasColumn('suppliers', 'postal_code'))        $t->string('postal_code', 20)->nullable();
            if (!Schema::hasColumn('suppliers', 'currency'))           $t->string('currency', 10)->default('BDT');
            if (!Schema::hasColumn('suppliers', 'payment_terms_days')) $t->integer('payment_terms_days')->default(0);
            if (!Schema::hasColumn('suppliers', 'credit_limit'))       $t->decimal('credit_limit', 15, 2)->default(0);
            if (!Schema::hasColumn('suppliers', 'opening_balance'))    $t->decimal('opening_balance', 15, 2)->default(0);
            if (!Schema::hasColumn('suppliers', 'bank_name'))          $t->string('bank_name', 100)->nullable();
            if (!Schema::hasColumn('suppliers', 'bank_account_no'))    $t->string('bank_account_no', 50)->nullable();
            if (!Schema::hasColumn('suppliers', 'bank_branch'))        $t->string('bank_branch', 100)->nullable();
            if (!Schema::hasColumn('suppliers', 'bank_routing_no'))    $t->string('bank_routing_no', 30)->nullable();
            if (!Schema::hasColumn('suppliers', 'supplier_type'))      $t->string('supplier_type', 30)->nullable();
            if (!Schema::hasColumn('suppliers', 'is_lc'))              $t->boolean('is_lc')->default(false);
            if (!Schema::hasColumn('suppliers', 'notes'))              $t->text('notes')->nullable();
            if (!Schema::hasColumn('suppliers', 'branch_id'))          $t->uuid('branch_id')->nullable();
            if (!Schema::hasColumn('suppliers', 'created_by'))         $t->uuid('created_by')->nullable();
            if (!Schema::hasColumn('suppliers', 'updated_at'))         $t->timestamp('updated_at')->useCurrent();
        });

        // ───────── 2. Configuration & meta ─────────
        if (!Schema::hasTable('purchase_types')) Schema::create('purchase_types', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('code', 30)->unique();
            $t->string('name', 120);
            $t->text('description')->nullable();
            $t->boolean('is_lc')->default(false);
            $t->boolean('is_capex')->default(false);
            $t->boolean('is_service')->default(false);
            $t->boolean('requires_grn')->default(true);
            $t->boolean('requires_quality_check')->default(false);
            $t->string('default_approval_flow', 30)->nullable();
            $t->boolean('is_active')->default(true);
            $t->timestamps();
        });

        if (!Schema::hasTable('purchase_settings')) Schema::create('purchase_settings', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->boolean('enable_pr_workflow')->default(true);
            $t->boolean('enable_po_amendment')->default(true);
            $t->boolean('enable_partial_grn')->default(true);
            $t->boolean('enable_3way_match')->default(true);
            $t->decimal('three_way_tolerance_pct', 8, 2)->default(2);
            $t->boolean('enable_landed_cost')->default(true);
            $t->boolean('enable_lc')->default(true);
            $t->boolean('enable_supplier_advance')->default(true);
            $t->boolean('auto_post_grn')->default(true);
            $t->boolean('auto_post_bill')->default(true);
            $t->boolean('auto_post_payment')->default(true);
            $t->decimal('default_vat_pct', 8, 2)->default(15);
            $t->decimal('default_ait_pct', 8, 2)->default(0);
            $t->decimal('default_tds_pct', 8, 2)->default(0);
            $t->string('po_default_currency', 10)->default('BDT');
            $t->boolean('require_pr_for_po')->default(false);
            $t->boolean('require_quote_attachment')->default(false);
            $t->decimal('budget_check_threshold', 15, 2)->default(0);
            $t->timestamps();
        });

        if (!Schema::hasTable('purchase_approval_matrix')) Schema::create('purchase_approval_matrix', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('document_type', 20);
            $t->uuid('purchase_type_id')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->decimal('min_amount', 15, 2)->default(0);
            $t->decimal('max_amount', 15, 2)->nullable();
            $t->integer('step_order')->default(1);
            $t->string('approver_role', 50)->nullable();
            $t->uuid('approver_user_id')->nullable();
            $t->boolean('is_active')->default(true);
            $t->timestamps();
            $t->index(['document_type', 'step_order']);
        });

        if (!Schema::hasTable('purchase_audit_log')) Schema::create('purchase_audit_log', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('document_type', 30);
            $t->uuid('document_id');
            $t->string('document_no', 50)->nullable();
            $t->string('action', 50);
            $t->uuid('performed_by')->nullable();
            $t->string('performed_by_name', 100)->nullable();
            $t->json('old_value')->nullable();
            $t->json('new_value')->nullable();
            $t->text('notes')->nullable();
            $t->string('ip_address', 45)->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->index(['document_type', 'document_id']);
        });

        if (!Schema::hasTable('purchase_approval_history')) Schema::create('purchase_approval_history', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('document_type', 30);
            $t->uuid('document_id');
            $t->string('document_no', 50)->nullable();
            $t->integer('step_order');
            $t->uuid('approver_user_id')->nullable();
            $t->string('approver_name', 100)->nullable();
            $t->string('status', 20);
            $t->text('remarks')->nullable();
            $t->timestamp('action_at')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->index(['document_type', 'document_id']);
        });

        if (!Schema::hasTable('purchase_coa_mapping')) Schema::create('purchase_coa_mapping', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('purchase_type_id')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('inventory_account_id')->nullable();
            $t->uuid('grn_clearing_account_id')->nullable();
            $t->uuid('payable_account_id')->nullable();
            $t->uuid('advance_account_id')->nullable();
            $t->uuid('vat_input_account_id')->nullable();
            $t->uuid('ait_account_id')->nullable();
            $t->uuid('asset_account_id')->nullable();
            $t->uuid('expense_account_id')->nullable();
            $t->uuid('discount_account_id')->nullable();
            $t->uuid('freight_account_id')->nullable();
            $t->uuid('landed_cost_account_id')->nullable();
            $t->uuid('cash_account_id')->nullable();
            $t->uuid('bank_account_id')->nullable();
            $t->boolean('is_active')->default(true);
            $t->timestamps();
        });

        // ───────── 3. Purchase Requisitions ─────────
        if (!Schema::hasTable('purchase_requisitions')) Schema::create('purchase_requisitions', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('pr_no', 50)->unique();
            $t->date('pr_date');
            $t->date('required_by')->nullable();
            $t->uuid('purchase_type_id')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('warehouse_id')->nullable();
            $t->uuid('requested_by')->nullable();
            $t->string('requested_by_name', 100)->nullable();
            $t->string('department', 80)->nullable();
            $t->string('priority', 20)->default('normal');
            $t->string('purpose', 200)->nullable();
            $t->text('notes')->nullable();
            $t->decimal('estimated_total', 15, 2)->default(0);
            $t->string('status', 20)->default('Draft');
            $t->uuid('current_approver_id')->nullable();
            $t->integer('current_step')->default(0);
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->index(['status', 'pr_date']);
        });

        if (!Schema::hasTable('purchase_requisition_items')) Schema::create('purchase_requisition_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('pr_id');
            $t->integer('line_no')->default(1);
            $t->uuid('item_id')->nullable();
            $t->string('item_description', 500);
            $t->uuid('unit_id')->nullable();
            $t->decimal('required_qty', 15, 4)->default(0);
            $t->decimal('estimated_price', 15, 4)->default(0);
            $t->decimal('estimated_total', 15, 2)->default(0);
            $t->date('required_date')->nullable();
            $t->text('remarks')->nullable();
            $t->decimal('po_linked_qty', 15, 4)->default(0);
            $t->timestamp('created_at')->useCurrent();
            $t->index('pr_id');
        });

        // ───────── 4. Purchase Orders v2 ─────────
        if (!Schema::hasTable('purchase_orders_v2')) Schema::create('purchase_orders_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('po_no', 50)->unique();
            $t->date('po_date');
            $t->date('delivery_date')->nullable();
            $t->uuid('purchase_type_id')->nullable();
            $t->uuid('supplier_id');
            $t->uuid('branch_id')->nullable();
            $t->uuid('warehouse_id')->nullable();
            $t->string('currency', 10)->default('BDT');
            $t->decimal('exchange_rate', 15, 6)->default(1);
            $t->string('payment_terms', 60)->nullable();
            $t->string('delivery_terms', 60)->nullable();
            $t->decimal('subtotal', 15, 2)->default(0);
            $t->decimal('discount_amount', 15, 2)->default(0);
            $t->decimal('vat_amount', 15, 2)->default(0);
            $t->decimal('ait_amount', 15, 2)->default(0);
            $t->decimal('freight_amount', 15, 2)->default(0);
            $t->decimal('other_charges', 15, 2)->default(0);
            $t->decimal('grand_total', 15, 2)->default(0);
            $t->decimal('advance_amount', 15, 2)->default(0);
            $t->string('status', 20)->default('Draft');
            $t->uuid('current_approver_id')->nullable();
            $t->integer('current_step')->default(0);
            $t->integer('revision_no')->default(0);
            $t->text('notes')->nullable();
            $t->text('terms_conditions')->nullable();
            $t->uuid('created_by')->nullable();
            $t->uuid('approved_by')->nullable();
            $t->timestamp('approved_at')->nullable();
            $t->timestamp('sent_at')->nullable();
            $t->timestamp('closed_at')->nullable();
            $t->timestamps();
            $t->index(['status', 'po_date']);
            $t->index('supplier_id');
        });

        if (!Schema::hasTable('purchase_order_items_v2')) Schema::create('purchase_order_items_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('po_id');
            $t->integer('line_no')->default(1);
            $t->uuid('item_id')->nullable();
            $t->string('item_description', 500);
            $t->uuid('unit_id')->nullable();
            $t->decimal('quantity', 15, 4)->default(0);
            $t->decimal('unit_price', 15, 4)->default(0);
            $t->decimal('discount_percent', 8, 2)->default(0);
            $t->decimal('vat_percent', 8, 2)->default(0);
            $t->decimal('ait_percent', 8, 2)->default(0);
            $t->decimal('line_total', 15, 2)->default(0);
            $t->decimal('received_qty', 15, 4)->default(0);
            $t->decimal('billed_qty', 15, 4)->default(0);
            $t->date('delivery_date')->nullable();
            $t->text('remarks')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->index('po_id');
        });

        if (!Schema::hasTable('po_pr_links')) Schema::create('po_pr_links', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('po_item_id');
            $t->uuid('pr_item_id');
            $t->decimal('linked_qty', 15, 4)->default(0);
            $t->timestamp('created_at')->useCurrent();
            $t->index(['po_item_id', 'pr_item_id']);
        });

        if (!Schema::hasTable('po_amendments_v2')) Schema::create('po_amendments_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('po_id');
            $t->integer('revision_no');
            $t->uuid('amended_by')->nullable();
            $t->string('amended_by_name', 100)->nullable();
            $t->text('reason');
            $t->json('snapshot');
            $t->timestamp('created_at')->useCurrent();
            $t->index('po_id');
        });

        // ───────── 5. GRN v2 ─────────
        if (!Schema::hasTable('grns_v2')) Schema::create('grns_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('grn_no', 50)->unique();
            $t->date('grn_date');
            $t->uuid('po_id')->nullable();
            $t->uuid('supplier_id');
            $t->uuid('branch_id')->nullable();
            $t->uuid('warehouse_id')->nullable();
            $t->string('challan_no', 60)->nullable();
            $t->date('challan_date')->nullable();
            $t->string('vehicle_no', 30)->nullable();
            $t->string('received_by_name', 100)->nullable();
            $t->string('inspected_by_name', 100)->nullable();
            $t->decimal('subtotal', 15, 2)->default(0);
            $t->decimal('freight_amount', 15, 2)->default(0);
            $t->decimal('other_charges', 15, 2)->default(0);
            $t->decimal('grand_total', 15, 2)->default(0);
            $t->string('status', 20)->default('Draft');
            $t->boolean('auto_post')->default(true);
            $t->uuid('voucher_id')->nullable();
            $t->text('remarks')->nullable();
            $t->uuid('created_by')->nullable();
            $t->uuid('approved_by')->nullable();
            $t->timestamp('approved_at')->nullable();
            $t->timestamps();
            $t->index(['status', 'grn_date']);
            $t->index('po_id');
        });

        if (!Schema::hasTable('grn_items_v2')) Schema::create('grn_items_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('grn_id');
            $t->uuid('po_item_id')->nullable();
            $t->integer('line_no');
            $t->uuid('item_id')->nullable();
            $t->string('item_description', 500);
            $t->uuid('unit_id')->nullable();
            $t->decimal('ordered_qty', 15, 4)->default(0);
            $t->decimal('received_qty', 15, 4)->default(0);
            $t->decimal('accepted_qty', 15, 4)->default(0);
            $t->decimal('rejected_qty', 15, 4)->default(0);
            $t->decimal('unit_cost', 15, 4)->default(0);
            $t->decimal('line_value', 15, 2)->default(0);
            $t->string('batch_no', 60)->nullable();
            $t->date('expiry_date')->nullable();
            $t->text('remarks')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->index('grn_id');
        });

        // ───────── 6. Supplier Bills + Payments + Allocations ─────────
        if (!Schema::hasTable('supplier_bills_v2')) Schema::create('supplier_bills_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('bill_no', 50)->unique();
            $t->string('supplier_invoice_no', 60)->nullable();
            $t->date('bill_date');
            $t->date('due_date')->nullable();
            $t->uuid('supplier_id');
            $t->uuid('branch_id')->nullable();
            $t->uuid('purchase_type_id')->nullable();
            $t->string('currency', 10)->default('BDT');
            $t->decimal('exchange_rate', 15, 6)->default(1);
            $t->decimal('subtotal', 15, 2)->default(0);
            $t->decimal('discount_amount', 15, 2)->default(0);
            $t->decimal('vat_amount', 15, 2)->default(0);
            $t->decimal('ait_amount', 15, 2)->default(0);
            $t->decimal('tds_amount', 15, 2)->default(0);
            $t->decimal('freight_amount', 15, 2)->default(0);
            $t->decimal('other_charges', 15, 2)->default(0);
            $t->decimal('grand_total', 15, 2)->default(0);
            $t->decimal('paid_amount', 15, 2)->default(0);
            $t->decimal('balance_due', 15, 2)->default(0);
            $t->string('status', 20)->default('Draft');
            $t->boolean('auto_post')->default(true);
            $t->uuid('voucher_id')->nullable();
            $t->text('notes')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->index(['status', 'bill_date']);
            $t->index('supplier_id');
        });

        if (!Schema::hasTable('supplier_bill_items_v2')) Schema::create('supplier_bill_items_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('bill_id');
            $t->uuid('grn_item_id')->nullable();
            $t->uuid('po_item_id')->nullable();
            $t->integer('line_no');
            $t->uuid('item_id')->nullable();
            $t->string('item_description', 500);
            $t->uuid('unit_id')->nullable();
            $t->decimal('quantity', 15, 4)->default(0);
            $t->decimal('unit_price', 15, 4)->default(0);
            $t->decimal('discount_percent', 8, 2)->default(0);
            $t->decimal('line_total', 15, 2)->default(0);
            $t->text('remarks')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->index('bill_id');
        });

        if (!Schema::hasTable('supplier_payments_v2')) Schema::create('supplier_payments_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('payment_no', 50)->unique();
            $t->date('payment_date');
            $t->uuid('supplier_id');
            $t->uuid('branch_id')->nullable();
            $t->string('payment_mode', 30)->default('cash');
            $t->uuid('bank_account_id')->nullable();
            $t->string('cheque_no', 50)->nullable();
            $t->date('cheque_date')->nullable();
            $t->string('reference_no', 80)->nullable();
            $t->string('currency', 10)->default('BDT');
            $t->decimal('exchange_rate', 15, 6)->default(1);
            $t->decimal('amount', 15, 2)->default(0);
            $t->decimal('tds_amount', 15, 2)->default(0);
            $t->decimal('net_amount', 15, 2)->default(0);
            $t->string('status', 20)->default('Draft');
            $t->boolean('auto_post')->default(true);
            $t->uuid('voucher_id')->nullable();
            $t->text('notes')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->index(['status', 'payment_date']);
            $t->index('supplier_id');
        });

        if (!Schema::hasTable('supplier_payment_allocations')) Schema::create('supplier_payment_allocations', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('payment_id');
            $t->uuid('bill_id');
            $t->decimal('allocated_amount', 15, 2)->default(0);
            $t->timestamp('created_at')->useCurrent();
            $t->index(['payment_id', 'bill_id']);
        });

        // ───────── 7. LC ─────────
        if (!Schema::hasTable('lc_documents')) Schema::create('lc_documents', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('lc_no', 60)->unique();
            $t->date('lc_date');
            $t->date('expiry_date')->nullable();
            $t->uuid('supplier_id')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->string('bank_name', 100)->nullable();
            $t->uuid('bank_account_id')->nullable();
            $t->string('lc_type', 30)->default('sight');
            $t->string('currency', 10)->default('USD');
            $t->decimal('exchange_rate', 15, 6)->default(1);
            $t->decimal('lc_amount', 15, 2)->default(0);
            $t->decimal('margin_pct', 8, 2)->default(0);
            $t->decimal('margin_amount', 15, 2)->default(0);
            $t->decimal('total_charges', 15, 2)->default(0);
            $t->decimal('landed_cost', 15, 2)->default(0);
            $t->uuid('po_id')->nullable();
            $t->uuid('grn_id')->nullable();
            $t->string('status', 20)->default('opened');
            $t->text('notes')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->index(['status', 'lc_date']);
        });

        if (!Schema::hasTable('lc_charges')) Schema::create('lc_charges', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('lc_id');
            $t->string('charge_type', 50);
            $t->date('charge_date')->nullable();
            $t->text('description')->nullable();
            $t->decimal('amount', 15, 2)->default(0);
            $t->string('currency', 10)->default('BDT');
            $t->uuid('account_id')->nullable();
            $t->string('reference_no', 80)->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->index('lc_id');
        });

        // ───────── 8. Purchase Returns v2 ─────────
        if (!Schema::hasTable('purchase_returns_v2')) Schema::create('purchase_returns_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('return_no', 50)->unique();
            $t->date('return_date');
            $t->uuid('supplier_id');
            $t->uuid('grn_id')->nullable();
            $t->uuid('bill_id')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->uuid('warehouse_id')->nullable();
            $t->string('return_type', 20)->default('damaged');
            $t->decimal('subtotal', 15, 2)->default(0);
            $t->decimal('vat_amount', 15, 2)->default(0);
            $t->decimal('grand_total', 15, 2)->default(0);
            $t->string('status', 20)->default('Draft');
            $t->boolean('auto_post')->default(true);
            $t->uuid('voucher_id')->nullable();
            $t->text('reason')->nullable();
            $t->uuid('created_by')->nullable();
            $t->timestamps();
            $t->index(['status', 'return_date']);
            $t->index('supplier_id');
        });

        if (!Schema::hasTable('purchase_return_items_v2')) Schema::create('purchase_return_items_v2', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->uuid('return_id');
            $t->uuid('grn_item_id')->nullable();
            $t->integer('line_no');
            $t->uuid('item_id')->nullable();
            $t->string('item_description', 500);
            $t->uuid('unit_id')->nullable();
            $t->decimal('quantity', 15, 4)->default(0);
            $t->decimal('unit_price', 15, 4)->default(0);
            $t->decimal('line_total', 15, 2)->default(0);
            $t->text('remarks')->nullable();
            $t->timestamp('created_at')->useCurrent();
            $t->index('return_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_return_items_v2');
        Schema::dropIfExists('purchase_returns_v2');
        Schema::dropIfExists('lc_charges');
        Schema::dropIfExists('lc_documents');
        Schema::dropIfExists('supplier_payment_allocations');
        Schema::dropIfExists('supplier_payments_v2');
        Schema::dropIfExists('supplier_bill_items_v2');
        Schema::dropIfExists('supplier_bills_v2');
        Schema::dropIfExists('grn_items_v2');
        Schema::dropIfExists('grns_v2');
        Schema::dropIfExists('po_amendments_v2');
        Schema::dropIfExists('po_pr_links');
        Schema::dropIfExists('purchase_order_items_v2');
        Schema::dropIfExists('purchase_orders_v2');
        Schema::dropIfExists('purchase_requisition_items');
        Schema::dropIfExists('purchase_requisitions');
        Schema::dropIfExists('purchase_coa_mapping');
        Schema::dropIfExists('purchase_approval_history');
        Schema::dropIfExists('purchase_audit_log');
        Schema::dropIfExists('purchase_approval_matrix');
        Schema::dropIfExists('purchase_settings');
        Schema::dropIfExists('purchase_types');

        // Extended supplier columns (drop in reverse-add order)
        Schema::table('suppliers', function (Blueprint $t) {
            foreach ([
                'code','contact_person','designation','mobile','bin_number','tin_number','tax_id','website',
                'city','state','country','postal_code','currency','payment_terms_days','credit_limit','opening_balance',
                'bank_name','bank_account_no','bank_branch','bank_routing_no','supplier_type','is_lc','notes','branch_id',
                'created_by','updated_at',
            ] as $col) {
                if (Schema::hasColumn('suppliers', $col)) {
                    $t->dropColumn($col);
                }
            }
        });
    }
};
