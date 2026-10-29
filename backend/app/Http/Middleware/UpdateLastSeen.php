<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Carbon;

class UpdateLastSeen
{
    public function handle(Request $request, Closure $next)
    {
        $user = auth()->user();

        if ($user) {
            $lastSeenAt = $user->last_seen_at ? Carbon::parse($user->last_seen_at) : null;
            $recentlyUpdated = $user->is_online && $lastSeenAt && $lastSeenAt->gt(now()->subMinutes(5));

            if (!$recentlyUpdated) {
                try {
                    Cache::lock('user-last-seen:' . $user->id, 1)->get(function () use ($user) {
                        DB::table('users')
                            ->where('id', $user->id)
                            ->where(function ($query) {
                                $query->whereNull('last_seen_at')
                                    ->orWhere('last_seen_at', '<', now()->subMinutes(5))
                                    ->orWhere('is_online', false);
                            })
                            ->update([
                                'is_online' => true,
                                'last_seen_at' => now(),
                                'updated_at' => now(),
                            ]);
                    });
                } catch (QueryException $e) {
                    Log::warning('Skipped last_seen update due to database lock.', [
                        'user_id' => $user->id,
                        'error_code' => $e->getCode(),
                    ]);
                } catch (\Throwable $e) {
                    Log::warning('Skipped last_seen update.', [
                        'user_id' => $user->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        }

        return $next($request);
    }
}
