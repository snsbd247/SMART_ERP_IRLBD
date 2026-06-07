<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ifrs_account_mapping', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('account_id');
            $table->string('ifrs_line', 150);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->unique('account_id');
            $table->foreign('account_id')->references('id')->on('chart_of_accounts')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ifrs_account_mapping');
    }
};
