<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('employees', 'proposed_password')) {
            Schema::table('employees', function (Blueprint $table) {
                // Hashed password chosen by the applicant during public registration.
                // Cleared (set to NULL) once the admin approves and the user account is created.
                $table->string('proposed_password', 255)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('employees', 'proposed_password')) {
            Schema::table('employees', function (Blueprint $table) {
                $table->dropColumn('proposed_password');
            });
        }
    }
};
