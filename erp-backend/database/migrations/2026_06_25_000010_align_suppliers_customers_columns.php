<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * Bring MySQL `suppliers` and `customers` tables in sync with the original
 * schema the frontend writes against. Without these columns, edits to
 * `is_active` and `payable_account_id` / `receivable_account_id` are silently
 * dropped by GenericTableController (column-intersect against Schema listing),
 * so toggling Active or selecting a Payable/Receivable Ledger never persists
 * on VPS / Laravel mode.
 *
 * Safe Extension Only: all columns are nullable / default-safe and added with
 * `hasColumn` guards. Existing rows and other modules are unaffected.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('suppliers')) {
            Schema::table('suppliers', function (Blueprint $t) {
                if (!Schema::hasColumn('suppliers', 'code'))                 $t->string('code', 50)->nullable()->after('id');
                if (!Schema::hasColumn('suppliers', 'supplier_type'))        $t->string('supplier_type', 30)->default('local');
                if (!Schema::hasColumn('suppliers', 'contact_person'))       $t->string('contact_person', 150)->nullable();
                if (!Schema::hasColumn('suppliers', 'currency'))             $t->string('currency', 10)->nullable()->default('BDT');
                if (!Schema::hasColumn('suppliers', 'vat_reg_no'))           $t->string('vat_reg_no', 50)->nullable();
                if (!Schema::hasColumn('suppliers', 'bin_no'))               $t->string('bin_no', 50)->nullable();
                if (!Schema::hasColumn('suppliers', 'credit_limit'))         $t->decimal('credit_limit', 15, 2)->nullable()->default(0);
                if (!Schema::hasColumn('suppliers', 'credit_days'))          $t->integer('credit_days')->nullable()->default(0);
                if (!Schema::hasColumn('suppliers', 'branch_id'))            $t->uuid('branch_id')->nullable();
                if (!Schema::hasColumn('suppliers', 'payable_account_id'))   $t->uuid('payable_account_id')->nullable();
                if (!Schema::hasColumn('suppliers', 'advance_account_id'))   $t->uuid('advance_account_id')->nullable();
                if (!Schema::hasColumn('suppliers', 'is_active'))            $t->boolean('is_active')->default(true);
                if (!Schema::hasColumn('suppliers', 'opening_balance'))      $t->decimal('opening_balance', 15, 2)->nullable()->default(0);
                if (!Schema::hasColumn('suppliers', 'opening_balance_date')) $t->date('opening_balance_date')->nullable();
                if (!Schema::hasColumn('suppliers', 'legal_name'))           $t->string('legal_name', 200)->nullable();
                if (!Schema::hasColumn('suppliers', 'city'))                 $t->string('city', 100)->nullable();
                if (!Schema::hasColumn('suppliers', 'country'))              $t->string('country', 100)->nullable();
                if (!Schema::hasColumn('suppliers', 'tax_id'))               $t->string('tax_id', 50)->nullable();
                if (!Schema::hasColumn('suppliers', 'bank_name'))            $t->string('bank_name', 150)->nullable();
                if (!Schema::hasColumn('suppliers', 'bank_branch'))          $t->string('bank_branch', 150)->nullable();
                if (!Schema::hasColumn('suppliers', 'bank_account'))         $t->string('bank_account', 50)->nullable();
                if (!Schema::hasColumn('suppliers', 'swift_code'))           $t->string('swift_code', 50)->nullable();
                if (!Schema::hasColumn('suppliers', 'payment_terms'))        $t->string('payment_terms', 100)->nullable();
                if (!Schema::hasColumn('suppliers', 'notes'))                $t->text('notes')->nullable();
                if (!Schema::hasColumn('suppliers', 'updated_at'))           $t->timestamp('updated_at')->nullable();
            });

            // Backfill is_active from legacy `status` column if present.
            if (Schema::hasColumn('suppliers', 'status') && Schema::hasColumn('suppliers', 'is_active')) {
                DB::statement("UPDATE suppliers SET is_active = CASE WHEN LOWER(status) = 'inactive' THEN 0 ELSE 1 END WHERE is_active IS NULL");
            }
        }

        if (Schema::hasTable('customers')) {
            Schema::table('customers', function (Blueprint $t) {
                if (!Schema::hasColumn('customers', 'code'))                  $t->string('code', 50)->nullable()->after('id');
                if (!Schema::hasColumn('customers', 'contact_person'))        $t->string('contact_person', 150)->nullable();
                if (!Schema::hasColumn('customers', 'currency'))              $t->string('currency', 10)->nullable()->default('BDT');
                if (!Schema::hasColumn('customers', 'credit_limit'))          $t->decimal('credit_limit', 15, 2)->nullable()->default(0);
                if (!Schema::hasColumn('customers', 'credit_days'))           $t->integer('credit_days')->nullable()->default(0);
                if (!Schema::hasColumn('customers', 'branch_id'))             $t->uuid('branch_id')->nullable();
                if (!Schema::hasColumn('customers', 'receivable_account_id')) $t->uuid('receivable_account_id')->nullable();
                if (!Schema::hasColumn('customers', 'advance_account_id'))    $t->uuid('advance_account_id')->nullable();
                if (!Schema::hasColumn('customers', 'is_active'))             $t->boolean('is_active')->default(true);
                if (!Schema::hasColumn('customers', 'opening_balance'))       $t->decimal('opening_balance', 15, 2)->nullable()->default(0);
                if (!Schema::hasColumn('customers', 'opening_balance_date'))  $t->date('opening_balance_date')->nullable();
                if (!Schema::hasColumn('customers', 'notes'))                 $t->text('notes')->nullable();
                if (!Schema::hasColumn('customers', 'updated_at'))            $t->timestamp('updated_at')->nullable();
            });

            if (Schema::hasColumn('customers', 'status') && Schema::hasColumn('customers', 'is_active')) {
                DB::statement("UPDATE customers SET is_active = CASE WHEN LOWER(status) = 'inactive' THEN 0 ELSE 1 END WHERE is_active IS NULL");
            }
        }
    }

    public function down(): void
    {
        // No-op: dropping these columns would risk data loss on systems that
        // have started using them. Safe Extension Only — never reverse.
    }
};
