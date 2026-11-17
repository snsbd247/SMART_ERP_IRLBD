<?php

use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| All web routes serve the React SPA via the .htaccess fallback.
| This file is kept minimal as the API handles all backend logic.
|
*/

Route::get('/', function () {
    // The SPA's index.html lives in the web root (public_html/erp.irlbd.com), which
    // .htaccess normally serves directly; erp_app/public has no copy of it.
    $index = realpath($_SERVER['DOCUMENT_ROOT'] ?? '') ? rtrim($_SERVER['DOCUMENT_ROOT'], '/') . '/index.html' : public_path('index.html');
    if (!is_file($index)) $index = public_path('index.html');
    abort_unless(is_file($index), 404);
    return response()->file($index, ['Content-Type' => 'text/html; charset=UTF-8', 'Cache-Control' => 'no-cache, no-store, must-revalidate']);
});
