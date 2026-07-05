<?php

namespace App\Http\Controllers\HRM;

use App\Http\Controllers\BaseController;
use App\Models\Attendance;
use App\Models\Branch;
use App\Models\Employee;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AttendanceController extends BaseController
{
    public function index(Request $request)
    {
        $query = Attendance::with('employee');
        if ($request->employee_id) $query->where('employee_id', $request->employee_id);
        if ($request->date) $query->where('date', $request->date);
        if ($request->status) $query->where('status', $request->status);
        if ($request->branch_id) {
            $query->whereHas('employee', fn($q) => $q->where('branch_id', $request->branch_id));
        }
        if ($request->month && $request->year) {
            $query->whereMonth('date', $request->month)->whereYear('date', $request->year);
        }
        return $this->paginated($query->orderByDesc('date')->paginate($request->per_page ?? 50));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'employee_id' => 'required|exists:employees,id',
            'date' => 'required|date',
            'status' => 'required|in:present,absent,late,half_day,leave',
            'check_in' => 'nullable',
            'check_out' => 'nullable',
            'notes' => 'nullable',
        ]);
        return $this->created(Attendance::updateOrCreate(
            ['employee_id' => $data['employee_id'], 'date' => $data['date']],
            $data
        ));
    }

    /**
     * Bulk attendance entry for a date.
     */
    public function bulkStore(Request $request)
    {
        $request->validate([
            'date' => 'required|date',
            'records' => 'required|array|min:1',
            'records.*.employee_id' => 'required|exists:employees,id',
            'records.*.status' => 'required|in:present,absent,late,half_day,leave',
        ]);

        $results = [];
        DB::transaction(function () use ($request, &$results) {
            foreach ($request->records as $record) {
                $results[] = Attendance::updateOrCreate(
                    ['employee_id' => $record['employee_id'], 'date' => $request->date],
                    [
                        'status' => $record['status'],
                        'check_in' => $record['check_in'] ?? null,
                        'check_out' => $record['check_out'] ?? null,
                        'notes' => $record['notes'] ?? null,
                    ]
                );
            }
        });

        return $this->created($results, count($results) . ' attendance records saved');
    }

    public function update(Request $request, string $id)
    {
        $att = Attendance::findOrFail($id);
        $att->update($request->only('status', 'check_in', 'check_out', 'notes'));
        return $this->success($att);
    }

    /**
     * Self check-in/out from portal. Enforces branch geofence.
     */
    /**
     * Resolve the geo-fence branch for a user. Returns [Branch|null, source].
     * Fallback order: employee → user → single-configured.
     */
    private function resolveGeoBranchWithSource($user): array
    {
        $employee = $user->employee_id ? Employee::with('branch')->find($user->employee_id) : null;

        $candidate = $employee?->branch;
        if ($candidate && $candidate->latitude !== null && $candidate->longitude !== null) {
            return [$candidate, 'employee'];
        }

        if ($user->branch_id) {
            $b = Branch::find($user->branch_id);
            if ($b && $b->latitude !== null && $b->longitude !== null) return [$b, 'user'];
        }

        $configured = Branch::whereNotNull('latitude')->whereNotNull('longitude')->get();
        if ($configured->count() === 1) return [$configured->first(), 'single'];

        return [$candidate, 'none'];
    }

    private function resolveGeoBranch($user): ?Branch
    {
        [$b] = $this->resolveGeoBranchWithSource($user);
        return $b;
    }

    private function writeAudit(Request $request, string $action, array $details): void
    {
        try {
            \App\Models\AuditLog::create([
                'user_id' => optional($request->user())->id,
                'user_name' => optional($request->user())->name,
                'module' => 'hrm.attendance',
                'action' => $action,
                'details' => json_encode($details),
                'ip_address' => $request->ip(),
                'user_agent' => substr((string) $request->userAgent(), 0, 255),
            ]);
        } catch (\Throwable) { /* audit is best-effort */ }
    }

    /**
     * Portal endpoint: log a geolocation permission event (granted / denied / timeout / unavailable).
     */
    public function logGeoPermission(Request $request)
    {
        $data = $request->validate([
            'status' => 'required|in:granted,denied,timeout,unavailable,error',
            'context' => 'nullable|string|max:50',
            'message' => 'nullable|string|max:255',
        ]);
        $this->writeAudit($request, 'geo_permission.' . $data['status'], [
            'context' => $data['context'] ?? 'check_in',
            'message' => $data['message'] ?? null,
        ]);
        return response()->json(['success' => true]);
    }

    public function selfCheckIn(Request $request)
    {
        $data = $request->validate([
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
            'action' => 'required|in:check_in,check_out',
        ]);

        $user = $request->user();
        if (!$user || !$user->employee_id) {
            return response()->json(['success' => false, 'message' => 'No employee profile linked to this account.'], 403);
        }

        $employee = Employee::find($user->employee_id);
        if (!$employee) {
            return response()->json(['success' => false, 'message' => 'Employee not found.'], 404);
        }

        [$branch, $source] = $this->resolveGeoBranchWithSource($user);
        if (!$branch || $branch->latitude === null || $branch->longitude === null) {
            return response()->json(['success' => false, 'message' => 'Branch location not configured. Contact admin.'], 422);
        }

        $radius = (int) ($branch->geofence_radius_m ?? 10);
        $distance = $this->haversineMeters(
            (float) $branch->latitude, (float) $branch->longitude,
            (float) $data['latitude'], (float) $data['longitude']
        );

        if ($distance > $radius) {
            $this->writeAudit($request, 'check_in.out_of_range', [
                'branch_id' => $branch->id, 'branch_source' => $source,
                'distance_m' => round($distance, 2), 'allowed_radius_m' => $radius,
            ]);
            return response()->json([
                'success' => false,
                'message' => "You are " . round($distance) . "m away from branch. Must be within {$radius}m.",
                'distance_m' => round($distance, 2),
                'allowed_radius_m' => $radius,
            ], 422);
        }

        $today = Carbon::today()->toDateString();
        $now = Carbon::now()->format('H:i:s');

        $att = Attendance::firstOrNew(['employee_id' => $employee->id, 'date' => $today]);

        if ($data['action'] === 'check_in') {
            if ($att->check_in) {
                return response()->json(['success' => false, 'message' => 'Already checked in today at ' . $att->check_in], 422);
            }
            $att->check_in = $now;
            $att->check_in_lat = $data['latitude'];
            $att->check_in_lng = $data['longitude'];
            $att->status = $att->status ?: 'present';
            $att->source = 'portal_geo';
        } else {
            if (!$att->check_in) {
                return response()->json(['success' => false, 'message' => 'Please check in first.'], 422);
            }
            if ($att->check_out) {
                return response()->json(['success' => false, 'message' => 'Already checked out today at ' . $att->check_out], 422);
            }
            $att->check_out = $now;
            $att->check_out_lat = $data['latitude'];
            $att->check_out_lng = $data['longitude'];
        }

        $att->save();

        $this->writeAudit($request, $data['action'] . '.success', [
            'branch_id' => $branch->id,
            'branch_source' => $source,
            'distance_m' => round($distance, 2),
        ]);

        return response()->json([
            'success' => true,
            'data' => $att,
            'distance_m' => round($distance, 2),
            'branch_source' => $source,
        ]);
    }

    public function selfToday(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->employee_id) {
            return response()->json(['success' => true, 'data' => null]);
        }
        $today = Carbon::today()->toDateString();
        $att = Attendance::where('employee_id', $user->employee_id)->where('date', $today)->first();
        [$branch, $source] = $this->resolveGeoBranchWithSource($user);
        return response()->json([
            'success' => true,
            'data' => $att,
            'branch_source' => $source,
            'branch' => $branch ? [
                'id' => $branch->id,
                'name' => $branch->name,
                'latitude' => $branch->latitude,
                'longitude' => $branch->longitude,
                'geofence_radius_m' => $branch->geofence_radius_m ?? 10,
                'source' => $source,
            ] : null,
        ]);
    }

    private function haversineMeters(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $earth = 6371000.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
        return $earth * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
