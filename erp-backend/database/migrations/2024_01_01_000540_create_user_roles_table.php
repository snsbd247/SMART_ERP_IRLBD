<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Legacy `user_roles` table — referenced by Admin > Users page and
 * Diagnostics. Stores app_role enum-style values: super_admin / admin / staff.
 */
return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('user_roles')) return;

        Schema::create('user_roles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id')->index();
            $table->string('role', 30); // super_admin | admin | staff | ...
            $table->timestamps();
            $table->unique(['user_id', 'role']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_roles');
    }
};
