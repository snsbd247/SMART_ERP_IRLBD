<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('deploy_sync_audit_log', function (Blueprint $table) {
            $table->id();
            $table->string('event', 30); // pull, dry_run, rollback, migrate, test_connection, settings_update
            $table->string('status', 20); // started, success, failed
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('user_name', 150)->nullable();
            $table->string('job_id', 80)->nullable();
            $table->string('backup_id', 50)->nullable();
            $table->string('branch', 100)->nullable();
            $table->text('message')->nullable();
            $table->string('ip_address', 64)->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['event', 'created_at']);
        });
    }
    public function down(): void { Schema::dropIfExists('deploy_sync_audit_log'); }
};
