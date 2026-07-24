<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Http\Request;
use Throwable;

class Handler extends ExceptionHandler
{
    protected $dontFlash = [
        'current_password',
        'password',
        'password_confirmation',
    ];

    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            //
        });
    }

    /**
     * This is an API-only backend (no web "login" route exists), so every
     * /api/* request should get a JSON error response — including a clean
     * 401 instead of a 500 "Route [login] not defined" when a client omits
     * an `Accept: application/json` header (the frontend always sends one,
     * but external tools/tests may not).
     */
    protected function shouldReturnJson($request, Throwable $e)
    {
        if ($request->is('api/*')) {
            return true;
        }

        return parent::shouldReturnJson($request, $e);
    }
}
