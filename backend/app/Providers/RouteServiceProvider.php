<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Support\Providers\RouteServiceProvider as ServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

class RouteServiceProvider extends ServiceProvider
{
    public const HOME = '/';

    public function boot(): void
    {
        RateLimiter::for('api', function (Request $request) {
            // Internal single-tenant ERP — generous limit to avoid 429s during
            // normal polling (messaging, dashboards, etc.).
            return Limit::perMinute(1200)->by($request->user()?->id ?: $request->ip());
        });

        // Login / reset-code checks: slows password guessing to a crawl.
        RateLimiter::for('login', fn (Request $request) => [
            Limit::perMinute(10)->by('u:' . strtolower(trim((string) $request->input('username'))) . '|' . $request->ip()),
            Limit::perMinute(30)->by('ip:' . $request->ip()),
        ]);

        // Forgot password sends a paid SMS each time.
        RateLimiter::for('password-reset', fn (Request $request) => [
            Limit::perMinute(3)->by('u:' . strtolower(trim((string) $request->input('username'))) . '|' . $request->ip()),
            Limit::perHour(10)->by('ip:' . $request->ip()),
        ]);

        // Public (no login) endpoints: QR verification, self-registration.
        // (Generous: a whole office may share one IP when opening the login page.)
        RateLimiter::for('public', fn (Request $request) => Limit::perMinute(120)->by($request->ip()));
        RateLimiter::for('public-forms', fn (Request $request) => [
            Limit::perMinute(3)->by($request->ip()),
            Limit::perDay(30)->by($request->ip()),
        ]);

        // Emailing printed documents from the company address.
        RateLimiter::for('document-email', fn (Request $request) => [
            Limit::perMinute(10)->by($request->user()?->id ?: $request->ip()),
            Limit::perDay(200)->by($request->user()?->id ?: $request->ip()),
        ]);

        $this->routes(function () {
            Route::middleware('api')
                ->prefix('api')
                ->group(base_path('routes/api.php'));




            Route::middleware('web')
                ->group(base_path('routes/web.php'));
        });
    }
}
