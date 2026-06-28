<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use App\Models\Employee;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

class UserController extends BaseController
{
    public function __construct(private AuditService $auditService) {}

    public function index(Request $request)
    {
        $query = User::with('roles', 'branch')
            ->whereNull('deleted_at')
            ->where('status', '!=', 'deleted');

        // Hide Super Admin users (employee_id IS NULL) from non-Super Admin viewers
        $currentUser = $request->user();
        if ($currentUser && $currentUser->employee_id !== null) {
            $query->whereNotNull('employee_id');
        }

        return $this->paginated(
            $query->orderByDesc('created_at')
                ->paginate($request->per_page ?? 25)
        );
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'username' => 'required|unique:users',
            'name' => 'required|max:100',
            'email' => 'nullable|email|max:100',
            'phone' => 'nullable|string|max:30',
            'password' => 'required|min:6',
            'branch_id' => 'nullable|exists:branches,id',
            'employee_id' => 'nullable|exists:employees,id',
            'status' => 'nullable|in:active,inactive',
            'system_role' => 'nullable|in:user,super_admin',
            'branch_ids' => 'array',
            'branch_ids.*' => 'exists:branches,id',
            'role_ids' => 'array',
            'role_ids.*' => 'exists:custom_roles,id',
        ]);
        $systemRole = $data['system_role'] ?? 'user';
        if ($systemRole === 'super_admin' && !$request->user()?->isSuperAdmin()) {
            return $this->error('Only Super Admin can create another Super Admin user.', 403);
        }

        return DB::transaction(function () use ($data, $request, $systemRole) {
            $branchIds = $data['branch_ids'] ?? [];
            if (empty($data['branch_id']) && !empty($branchIds)) {
                $data['branch_id'] = $branchIds[0];
            }

            $employeeId = $data['employee_id'] ?? null;
            if ($systemRole !== 'super_admin' && empty($employeeId)) {
                $employee = $this->createEmployeeForUser($data, $request);
                $employeeId = $employee->id;
            }

            $user = User::create([
                'username' => $data['username'],
                'name' => $data['name'],
                'email' => $data['email'] ?? null,
                'phone' => $data['phone'] ?? null,
                'password' => Hash::make($data['password']),
                'branch_id' => $data['branch_id'] ?? null,
                'employee_id' => $systemRole === 'super_admin' ? null : $employeeId,
                'status' => $data['status'] ?? 'active',
            ]);

            if ($employeeId) {
                Employee::where('id', $employeeId)->update(['user_id' => $user->id]);
            }
            $user->roles()->sync($data['role_ids'] ?? []);
            $user->branches()->sync($branchIds ?: (!empty($data['branch_id']) ? [$data['branch_id']] : []));

            $this->auditService->logCreate('users', $user->id, $user->toArray(), $request);

            return $this->created($user->load('roles', 'branches', 'employee'));
        });
    }

    public function show(string $id)
    {
        return $this->success(User::with('roles.permissions', 'branch', 'branches')->findOrFail($id));
    }

    private function createEmployeeForUser(array $data, Request $request): Employee
    {
        $parts = preg_split('/\s+/', trim($data['name']), 2);
        $employeeData = [
            'employee_code' => $this->nextEmployeeCode(),
            'first_name' => substr($parts[0] ?: $data['username'], 0, 100),
            'last_name' => substr($parts[1] ?? '-', 0, 100),
            'email' => $data['email'] ?? null,
            'mobile' => $data['phone'] ?? null,
            'branch_id' => $data['branch_id'] ?? null,
            'joining_date' => now()->toDateString(),
            'employment_type' => 'permanent',
            'status' => $data['status'] ?? 'active',
        ];
        if (Schema::hasColumn('employees', 'approval_status')) {
            $employeeData['approval_status'] = 'approved';
            $employeeData['approved_at'] = now();
            $employeeData['approved_by'] = $request->user()?->id;
        }

        return Employee::create($employeeData);
    }

    private function nextEmployeeCode(): string
    {
        do {
            $next = ((int) Employee::where('employee_code', 'like', 'EMP-%')
                ->selectRaw("MAX(CAST(SUBSTRING(employee_code, 5) AS UNSIGNED)) as max_no")
                ->value('max_no')) + 1;
            $code = 'EMP-' . str_pad((string) $next, 4, '0', STR_PAD_LEFT);
        } while (Employee::where('employee_code', $code)->exists());

        return $code;
    }

    public function update(Request $request, string $id)
    {
        $user = User::findOrFail($id);
        $oldData = $user->toArray();

        $data = $request->only('name', 'email', 'phone', 'branch_id', 'status');
        if ($request->password) $data['password'] = Hash::make($request->password);
        $user->update($data);
        if ($request->has('role_ids')) $user->roles()->sync($request->role_ids ?? []);
        if ($request->has('branch_ids')) {
            $ids = $request->input('branch_ids') ?: [];
            $user->branches()->sync($ids);
            // Keep primary branch_id consistent: if current branch_id not in list, switch to first
            if (!empty($ids) && !in_array((string) $user->branch_id, array_map('strval', $ids), true)) {
                $user->update(['branch_id' => $ids[0]]);
            }
        }

        // Sync legacy `user_roles` table when system_role is provided.
        // Super Admin promotion/demotion is restricted to existing Super Admins.
        if ($request->has('system_role')) {
            $systemRole = $request->input('system_role') ?: 'user';
            if (in_array($systemRole, ['super_admin', 'user'], true)) {
                $actor = $request->user();
                $isSuperAdminActor = $actor && $actor->isSuperAdmin();
                if ($systemRole === 'super_admin' && !$isSuperAdminActor) {
                    return $this->error('Only Super Admin can promote another user to Super Admin.', 403);
                }
                if ($systemRole !== 'super_admin' && $user->isSuperAdmin() && !$isSuperAdminActor) {
                    return $this->error('Only Super Admin can demote a Super Admin user.', 403);
                }
                if (\Illuminate\Support\Facades\Schema::hasTable('user_roles')) {
                    \Illuminate\Support\Facades\DB::table('user_roles')
                        ->where('user_id', $user->id)
                        ->where('role', 'super_admin')
                        ->delete();
                    if ($systemRole === 'super_admin') {
                        \Illuminate\Support\Facades\DB::table('user_roles')->insert([
                            'id' => (string) \Illuminate\Support\Str::uuid(),
                            'user_id' => $user->id,
                            'role' => 'super_admin',
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    }
                }
            }
        }

        $this->auditService->logUpdate('users', $user->id, $oldData, $user->fresh()->toArray(), $request);

        return $this->success($user->load('roles', 'branches'));
    }

    /**
     * Check if user has related data before deletion.
     */
    public function checkRelated(string $id)
    {
        $tables = [
            ['table' => 'sales_invoices', 'column' => 'created_by'],
            ['table' => 'purchases', 'column' => 'created_by'],
            ['table' => 'acc_vouchers', 'column' => 'created_by'],
            ['table' => 'acc_vouchers', 'column' => 'approved_by'],
            ['table' => 'production_entries', 'column' => 'created_by'],
            ['table' => 'purchase_returns', 'column' => 'created_by'],
            ['table' => 'sales_returns', 'column' => 'created_by'],
            ['table' => 'employee_documents', 'column' => 'generated_by'],
        ];

        $related = [];
        foreach ($tables as $t) {
            $count = DB::table($t['table'])->where($t['column'], $id)->count();
            if ($count > 0) {
                $related[] = ['table' => $t['table'], 'column' => $t['column'], 'count' => $count];
            }
        }

        // Check employees
        $empCount = DB::table('employees')->where('user_id', $id)->count();
        if ($empCount > 0) {
            $related[] = ['table' => 'employees', 'column' => 'user_id', 'count' => $empCount];
        }

        return $this->success([
            'has_related_data' => count($related) > 0,
            'related_tables' => $related,
        ]);
    }

    /**
     * Transfer data from one user to another then soft-delete.
     */
    public function transferAndDelete(Request $request, string $id)
    {
        $request->validate(['transfer_to_user_id' => 'required|exists:users,id']);
        $transferTo = $request->transfer_to_user_id;

        if ($id === $transferTo) {
            return $this->error('Cannot transfer data to the same user', 400);
        }
        if ($id === $request->user()->id) {
            return $this->error('Cannot delete your own account', 400);
        }

        $transferableTables = [
            ['table' => 'sales_invoices', 'column' => 'created_by'],
            ['table' => 'purchases', 'column' => 'created_by'],
            ['table' => 'acc_vouchers', 'column' => 'created_by'],
            ['table' => 'acc_vouchers', 'column' => 'approved_by'],
            ['table' => 'production_entries', 'column' => 'created_by'],
            ['table' => 'purchase_returns', 'column' => 'created_by'],
            ['table' => 'sales_returns', 'column' => 'created_by'],
            ['table' => 'employee_documents', 'column' => 'generated_by'],
        ];

        $transfers = [];
        $targetSnapshot = User::find($id)?->only(['id', 'name', 'email', 'username']);
        DB::transaction(function () use ($id, $transferTo, $transferableTables, &$transfers) {
            foreach ($transferableTables as $t) {
                $updated = DB::table($t['table'])
                    ->where($t['column'], $id)
                    ->update([$t['column'] => $transferTo]);
                $transfers[] = ['table' => $t['table'], 'column' => $t['column'], 'updated' => $updated];
            }

            // Unlink employees
            DB::table('employees')->where('user_id', $id)->update(['user_id' => null]);

            // Soft delete user
            $user = User::findOrFail($id);
            $user->update(['status' => 'deleted', 'deleted_at' => now()]);

            // Remove roles
            DB::table('user_custom_roles')->where('user_id', $id)->delete();
        });

        $this->auditService->log('users', 'Data Transfer & Delete', $id,
            json_encode([
                'actor_id' => $request->user()?->id,
                'actor_name' => $request->user()?->name,
                'target_user' => $targetSnapshot,
                'transfer_to' => $transferTo,
                'transfers' => $transfers,
            ]),
            $request
        );

        return $this->success(['transfers' => $transfers], 'Data transferred and user deleted');
    }

    /**
     * Soft delete user (only if no related data).
     */
    public function destroy(Request $request, string $id)
    {
        if ($id === $request->user()->id) {
            return $this->error('Cannot delete your own account', 400);
        }

        // Check for related data
        $tables = [
            ['table' => 'sales_invoices', 'column' => 'created_by'],
            ['table' => 'purchases', 'column' => 'created_by'],
            ['table' => 'acc_vouchers', 'column' => 'created_by'],
            ['table' => 'production_entries', 'column' => 'created_by'],
            ['table' => 'employees', 'column' => 'user_id'],
        ];

        $relatedChecks = [];
        foreach ($tables as $t) {
            $count = DB::table($t['table'])->where($t['column'], $id)->count();
            $relatedChecks[] = ['table' => $t['table'], 'column' => $t['column'], 'count' => $count];
            if ($count > 0) {
                return $this->error('User has existing data. Please transfer data before deletion.', 400);
            }
        }

        $user = User::findOrFail($id);
        $oldData = $user->toArray();
        $user->update(['status' => 'deleted', 'deleted_at' => now()]);

        // Remove roles
        DB::table('user_custom_roles')->where('user_id', $id)->delete();

        $this->auditService->logDelete('users', $id, array_merge($oldData, [
            'actor_id' => $request->user()?->id,
            'actor_name' => $request->user()?->name,
            'related_checks' => $relatedChecks,
        ]), $request);

        return $this->success(null, 'User deleted successfully');
    }
}
