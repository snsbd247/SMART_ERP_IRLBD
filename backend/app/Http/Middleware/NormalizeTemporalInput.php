<?php

namespace App\Http\Middleware;

use Carbon\Carbon;
use Closure;
use Illuminate\Http\Request;

class NormalizeTemporalInput
{
    public function handle(Request $request, Closure $next)
    {
        if ($request->isJson()) {
            $request->json()->replace($this->normalizeArray($request->json()->all()));
        }

        if ($request->request->count() > 0) {
            $request->request->replace($this->normalizeArray($request->request->all()));
        }

        return $next($request);
    }

    private function normalizeArray(array $data): array
    {
        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $data[$key] = $this->normalizeArray($value);
                continue;
            }

            if (!is_string($value)) continue;
            if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})$/', $value)) continue;

            try {
                $data[$key] = Carbon::parse($value)->utc()->format('Y-m-d H:i:s');
            } catch (\Throwable $e) {
                $data[$key] = substr(str_replace('T', ' ', $value), 0, 19);
            }
        }

        return $data;
    }
}