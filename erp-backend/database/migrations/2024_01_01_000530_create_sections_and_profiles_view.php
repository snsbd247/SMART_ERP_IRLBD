<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Add the two legacy tables the frontend still references:
 *   - sections  (HRM organizational sections under branches)
 *   - profiles  (read-only view over users for legacy dataClient.from("profiles"))
 */
return new class extends Migration {
    public function up(): void
    {
        // 1. sections table
        if (!Schema::hasTable('sections')) {
            Schema::create('sections', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('name', 100);
                $table->uuid('branch_id')->nullable();
                $table->text('description')->nullable();
                $table->string('status', 20)->default('active');
                $table->timestamps();
                $table->index('branch_id');
            });
        }

        // 2. profiles view (maps to users so existing dataClient.from("profiles") works)
        // Drop first in case of an older table/view definition.
        DB::statement("DROP VIEW IF EXISTS profiles");
        // Note: cannot create view if a table with same name exists.
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

    public function down(): void
    {
        DB::statement("DROP VIEW IF EXISTS profiles");
        Schema::dropIfExists('sections');
    }
};
