<?php

namespace App\Http\Middleware;

use App\Services\LicenseService;
use Closure;
use Illuminate\Http\Request;

/**
 * Blocks every authenticated API request once the license is invalid.
 * Registered on the main authenticated route group in routes/api.php —
 * license/status and license/activate must stay outside it, otherwise a
 * blocked deployment could never submit a renewed key to unblock itself.
 */
class LicenseGuard
{
    public function __construct(private LicenseService $license) {}

    public function handle(Request $request, Closure $next)
    {
        $status = $this->license->getEffectiveStatus();
        if ($status['blocked']) {
            return response()->json([
                'success' => false,
                'code' => 'LICENSE_BLOCKED',
                'message' => $status['message'] ?? 'This software license is not valid.',
                'license_status' => $status['status'],
            ], 403);
        }

        return $next($request);
    }
}
