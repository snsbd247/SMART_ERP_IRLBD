<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class BranchScope
{
    /**
     * Scope queries to the user's allowed branches.
     * - Super Admin (employee_id NULL) → no restriction.
     * - Single allowed branch → force branch_id to that value.
     * - Multiple allowed branches → expose `allowed_branch_ids` to controllers;
     *   if request->branch_id is given, it must be one of the allowed ones,
     *   otherwise it is dropped so list endpoints fall back to whereIn(allowed_branch_ids).
     */
    public function handle(Request $request, Closure $next)
    {
        $user = $request->user();
        if (!$user || $user->isSuperAdmin()) {
            return $next($request);
        }

        $allowed = $user->allowedBranchIds();
        if (empty($allowed)) {
            return $next($request);
        }

        $request->merge(['allowed_branch_ids' => $allowed]);

        if (count($allowed) === 1) {
            // Lock to the single permitted branch (legacy behaviour)
            $request->merge(['branch_id' => $allowed[0]]);
        } else {
            $requested = $request->input('branch_id');
            if ($requested !== null && $requested !== '' && !in_array((string) $requested, $allowed, true)) {
                // Strip disallowed branch filter so controllers fall back to allowed list
                $request->request->remove('branch_id');
                $request->query->remove('branch_id');
            }
        }

        return $next($request);
    }
}
