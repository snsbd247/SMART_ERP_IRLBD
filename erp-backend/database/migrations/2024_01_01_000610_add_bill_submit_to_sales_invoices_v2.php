<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('sales_invoices_v2', function (Blueprint $t) {
            if (!Schema::hasColumn('sales_invoices_v2', 'bill_submitted_at')) {
                $t->date('bill_submitted_at')->nullable()->after('status');
            }
            if (!Schema::hasColumn('sales_invoices_v2', 'bill_due_date')) {
                $t->date('bill_due_date')->nullable()->after('bill_submitted_at');
            }
            if (!Schema::hasColumn('sales_invoices_v2', 'bill_submission_ref')) {
                $t->string('bill_submission_ref', 100)->nullable()->after('bill_due_date');
            }
            if (!Schema::hasColumn('sales_invoices_v2', 'payment_terms_days')) {
                $t->integer('payment_terms_days')->default(30)->after('bill_submission_ref');
            }
        });

        // MySQL-compatible index creation
        try { \DB::statement('CREATE INDEX idx_sales_invoices_v2_bill_due ON sales_invoices_v2(bill_due_date)'); } catch (\Throwable $e) {}
        try { \DB::statement('CREATE INDEX idx_sales_invoices_v2_bill_submitted ON sales_invoices_v2(bill_submitted_at)'); } catch (\Throwable $e) {}
    }

    public function down(): void
    {
        Schema::table('sales_invoices_v2', function (Blueprint $t) {
            foreach (['bill_submitted_at','bill_due_date','bill_submission_ref','payment_terms_days'] as $c) {
                if (Schema::hasColumn('sales_invoices_v2', $c)) $t->dropColumn($c);
            }
        });
    }
};
