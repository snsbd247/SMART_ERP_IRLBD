<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('employees', 'approval_status')) {
            Schema::table('employees', function (Blueprint $table) {
                // pending | approved | rejected
                $table->string('approval_status', 20)->default('approved');
                $table->timestamp('approved_at')->nullable();
                $table->uuid('approved_by')->nullable();
                $table->text('rejection_reason')->nullable();
                $table->index('approval_status');
            });

            // Backfill: all existing rows considered approved
            DB::table('employees')->update(['approval_status' => 'approved']);
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('employees', 'approval_status')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->dropIndex(['approval_status']);
                $table->dropColumn(['approval_status', 'approved_at', 'approved_by', 'rejection_reason']);
            });
        }
    }
};
