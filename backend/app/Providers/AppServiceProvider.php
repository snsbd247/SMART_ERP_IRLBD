<?php

namespace App\Providers;

use App\Support\AppTimestamps;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Write created_at in APP_TIMEZONE for models without Eloquent
        // timestamps instead of the DB server-time default (see AppTimestamps).
        Event::listen('eloquent.creating: *', function (string $event, array $models) {
            foreach ($models as $model) {
                AppTimestamps::fillCreatedAt($model);
            }
        });
    }
}
