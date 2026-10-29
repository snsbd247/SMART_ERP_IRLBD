<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        if (Schema::hasTable('user_branches')) {
            $columns = DB::select("SHOW COLUMNS FROM `user_branches` WHERE Field IN ('user_id', 'branch_id')");
            $types = collect($columns)->pluck('Type', 'Field')->map(fn ($type) => strtolower((string) $type));

            if (!str_starts_with($types->get('user_id', ''), 'char') || !str_starts_with($types->get('branch_id', ''), 'char')) {
                // A previous failed deploy may have created this new pivot table with integer IDs.
                // It cannot store UUID branch/user IDs, so rebuild it before backfilling.
                Schema::dropIfExists('user_branches');
            }
        }

        if (!Schema::hasTable('user_branches')) {
            $this->createUserBranchesTable();
        }

        // Backfill from users.branch_id (single-branch legacy) so existing access stays intact
        $rows = DB::table('users')->whereNotNull('branch_id')->get(['id', 'branch_id']);
        foreach ($rows as $r) {
            DB::table('user_branches')->updateOrInsert(
                ['user_id' => $r->id, 'branch_id' => $r->branch_id],
                ['created_at' => now(), 'updated_at' => now()]
            );
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_branches');
    }

    private function createUserBranchesTable(): void
    {
        Schema::create('user_branches', function (Blueprint $table) {
            $table->id();
            $table->char('user_id', 36);
            $table->char('branch_id', 36);
            $table->timestamps();
            $table->unique(['user_id', 'branch_id']);
            $table->index('user_id');
            $table->index('branch_id');
        });
    }
};
