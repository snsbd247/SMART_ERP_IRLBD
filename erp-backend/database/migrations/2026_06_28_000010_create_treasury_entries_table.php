<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * MySQL `treasury_entries` table for VPS / Laravel-only mode.
 * Standalone record-keeping table — no FK constraints to keep it portable
 * and decoupled from accounting/CoA (per Treasury Information design).
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('treasury_entries')) return;

        Schema::create('treasury_entries', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->date('treasury_date');
            $t->string('treasury_type', 20); // salary_tds | party_tds | vat
            $t->string('party_kind', 20)->nullable(); // employee|customer|supplier|none
            $t->uuid('party_id')->nullable();
            $t->string('party_name_snapshot', 255)->nullable();
            $t->string('challan_no', 100)->nullable();
            $t->date('challan_date')->nullable();
            $t->string('bank_name', 150)->nullable();
            $t->decimal('amount', 18, 2)->default(0);
            $t->string('period_month', 20)->nullable();
            $t->string('mushak_ref', 100)->nullable();
            $t->string('reference_no', 100)->nullable();
            $t->text('notes')->nullable();
            $t->uuid('branch_id')->nullable();
            $t->string('status', 20)->default('active'); // active|cancelled
            $t->uuid('created_by')->nullable();
            $t->timestamps();

            $t->index('treasury_date', 'idx_treasury_entries_date');
            $t->index('treasury_type', 'idx_treasury_entries_type');
            $t->index(['party_kind', 'party_id'], 'idx_treasury_entries_party');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('treasury_entries');
    }
};
