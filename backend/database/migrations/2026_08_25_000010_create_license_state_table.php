<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Single-row cache of this deployment's license state, verified against
 * the central license server (see App\Services\LicenseService). Never
 * trust this table's status alone without a matching signature — it only
 * gets written when the server's response passes RSA signature
 * verification, so editing this row by hand does not produce a value
 * LicenseService will accept.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('license_state', function (Blueprint $table) {
            $table->string('id')->primary(); // always 'default' — singleton row
            $table->string('license_key')->nullable();
            $table->string('status', 20)->default('unconfigured');
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('last_checked_at')->nullable();
            $table->boolean('last_check_ok')->default(false);
            $table->text('message')->nullable();
            $table->text('signature')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('license_state');
    }
};
