<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Single-row settings table. `last_number` is the last serial issued
        // (or manually set as a starting point, e.g. 69 to continue a
        // physical receipt book) — the next Money Receipt gets last_number+1.
        Schema::create('money_receipt_settings', function (Blueprint $table) {
            $table->string('id', 20)->primary();
            $table->unsignedInteger('last_number')->default(0);
            $table->timestamps();
        });

        DB::table('money_receipt_settings')->insert([
            'id' => 'default',
            'last_number' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('money_receipt_settings');
    }
};
