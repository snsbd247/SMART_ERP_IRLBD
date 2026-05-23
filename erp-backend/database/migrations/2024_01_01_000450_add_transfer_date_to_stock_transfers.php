<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('stock_transfers', 'transfer_date')) {
            Schema::table('stock_transfers', function (Blueprint $table) {
                $table->date('transfer_date')->nullable()->after('transfer_number');
            });
        }
        if (!Schema::hasColumn('stock_transfers', 'status')) {
            Schema::table('stock_transfers', function (Blueprint $table) {
                $table->string('status', 20)->default('pending')->after('quantity');
            });
        }
    }

    public function down(): void
    {
        Schema::table('stock_transfers', function (Blueprint $table) {
            $table->dropColumn(['transfer_date', 'status']);
        });
    }
};
