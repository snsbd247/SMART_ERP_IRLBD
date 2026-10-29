<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('page_shortcuts')) {
            Schema::create('page_shortcuts', function (Blueprint $table) {
                $table->char('id', 36)->primary();
                $table->string('shortcut_code', 32)->unique();
                $table->string('page_name');
                $table->string('page_url');
                $table->string('module_name', 64);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('user_favorite_pages')) {
            Schema::create('user_favorite_pages', function (Blueprint $table) {
                $table->char('id', 36)->primary();
                $table->string('user_id', 64)->index();
                $table->string('page_url');
                $table->timestamp('created_at')->useCurrent();
                $table->unique(['user_id', 'page_url']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_favorite_pages');
        Schema::dropIfExists('page_shortcuts');
    }
};
