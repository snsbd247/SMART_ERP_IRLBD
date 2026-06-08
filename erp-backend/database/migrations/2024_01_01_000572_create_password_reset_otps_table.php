<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('password_reset_otps')) {
            Schema::create('password_reset_otps', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id');
                $table->string('code_hash', 255);     // hashed OTP, never plain
                $table->string('channel', 20)->default('sms'); // sms | email
                $table->timestamp('expires_at');
                $table->timestamp('used_at')->nullable();
                $table->unsignedTinyInteger('attempts')->default(0);
                $table->string('ip_address', 64)->nullable();
                $table->timestamps();

                $table->index('user_id');
                $table->index('expires_at');
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('password_reset_otps');
    }
};
