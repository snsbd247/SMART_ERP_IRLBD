<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Recreate the `profiles` view (read-only alias over `users`) to include
 * the `phone` column so the frontend's Add/Edit User dialog and the users
 * list can display the phone number in Laravel mode.
 */
return new class extends Migration {
    public function up(): void
    {
        DB::statement("DROP VIEW IF EXISTS profiles");
        if (!Schema::hasTable('profiles')) {
            DB::statement("
                CREATE VIEW profiles AS
                SELECT
                    id,
                    name,
                    email,
                    username,
                    phone,
                    employee_id,
                    branch_id,
                    status,
                    created_at,
                    updated_at,
                    deleted_at
                FROM users
            ");
        }
    }

    public function down(): void
    {
        DB::statement("DROP VIEW IF EXISTS profiles");
        if (!Schema::hasTable('profiles')) {
            DB::statement("
                CREATE VIEW profiles AS
                SELECT
                    id,
                    name,
                    email,
                    username,
                    employee_id,
                    branch_id,
                    status,
                    created_at,
                    updated_at,
                    deleted_at
                FROM users
            ");
        }
    }
};
