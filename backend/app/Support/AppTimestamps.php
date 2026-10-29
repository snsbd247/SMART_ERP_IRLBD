<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

/**
 * Many tables take created_at from the column default CURRENT_TIMESTAMP,
 * which MySQL evaluates in the *server's* time zone (US Eastern on the
 * cPanel host), not APP_TIMEZONE (Asia/Dhaka) — those rows ended up 10-11h
 * behind. For models that opt out of Eloquent timestamps, fill created_at
 * from the app clock on insert so the DB default is never relied on.
 */
class AppTimestamps
{
    /** @var array<string, bool> table => has created_at */
    private static array $hasCreatedAt = [];

    public static function fillCreatedAt(Model $model): void
    {
        if ($model->usesTimestamps() || $model->getAttribute('created_at') !== null) {
            return;
        }

        $table = $model->getTable();
        $key = $model->getConnectionName() . ':' . $table;
        if (!array_key_exists($key, self::$hasCreatedAt)) {
            self::$hasCreatedAt[$key] = Schema::connection($model->getConnectionName())->hasColumn($table, 'created_at');
        }

        if (self::$hasCreatedAt[$key]) {
            // setAttribute() bypasses $fillable, which created_at is not on
            // most of these models.
            $model->setAttribute('created_at', now());
        }
    }
}
