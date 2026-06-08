<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('user_branches')) {
            Schema::create('user_branches', function (Blueprint $table) {
                $table->id();
                $table->uuid('user_id');
                $table->unsignedBigInteger('branch_id');
                $table->timestamps();
                $table->unique(['user_id', 'branch_id']);
                $table->index('user_id');
                $table->index('branch_id');
            });
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
};
