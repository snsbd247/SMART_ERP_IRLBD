<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            if (!Schema::hasColumn('branches', 'latitude')) {
                $table->decimal('latitude', 10, 7)->nullable()->after('address');
            }
            if (!Schema::hasColumn('branches', 'longitude')) {
                $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
            }
            if (!Schema::hasColumn('branches', 'geofence_radius_m')) {
                $table->unsignedInteger('geofence_radius_m')->default(10)->after('longitude');
            }
        });

        Schema::table('attendance', function (Blueprint $table) {
            if (!Schema::hasColumn('attendance', 'check_in_lat')) {
                $table->decimal('check_in_lat', 10, 7)->nullable();
            }
            if (!Schema::hasColumn('attendance', 'check_in_lng')) {
                $table->decimal('check_in_lng', 10, 7)->nullable();
            }
            if (!Schema::hasColumn('attendance', 'check_out_lat')) {
                $table->decimal('check_out_lat', 10, 7)->nullable();
            }
            if (!Schema::hasColumn('attendance', 'check_out_lng')) {
                $table->decimal('check_out_lng', 10, 7)->nullable();
            }
            if (!Schema::hasColumn('attendance', 'source')) {
                $table->string('source', 20)->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn(['latitude', 'longitude', 'geofence_radius_m']);
        });
        Schema::table('attendance', function (Blueprint $table) {
            $table->dropColumn(['check_in_lat', 'check_in_lng', 'check_out_lat', 'check_out_lng', 'source']);
        });
    }
};
