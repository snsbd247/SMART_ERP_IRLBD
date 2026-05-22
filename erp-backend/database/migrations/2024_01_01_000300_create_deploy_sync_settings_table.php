<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('deploy_sync_settings', function (Blueprint $table) {
            $table->id();
            $table->string('owner', 100)->default('snsbd247');
            $table->string('repo', 100)->default('smart_accounting');
            $table->string('branch', 100)->default('main');
            $table->text('token_encrypted')->nullable(); // Encrypted GitHub PAT
            $table->boolean('auto_migrate')->default(false);
            $table->timestamp('last_pulled_at')->nullable();
            $table->string('last_backup_id', 50)->nullable();
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('deploy_sync_settings'); }
};
