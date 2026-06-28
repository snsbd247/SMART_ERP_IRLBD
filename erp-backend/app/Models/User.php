<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasUuids, SoftDeletes;

    protected $fillable = ['username', 'name', 'email', 'phone', 'password', 'branch_id', 'employee_id', 'status', 'is_online', 'last_seen_at', 'last_login_at'];
    protected $hidden = ['password', 'remember_token'];

    public function branch() { return $this->belongsTo(Branch::class); }
    public function branches() { return $this->belongsToMany(Branch::class, 'user_branches', 'user_id', 'branch_id')->withTimestamps(); }
    public function employee() { return $this->belongsTo(Employee::class); }
    public function roles() { return $this->belongsToMany(CustomRole::class, 'user_custom_roles', 'user_id', 'custom_role_id')->using(UserCustomRole::class); }

    /**
     * All branch IDs this user is allowed to access.
     * Super Admins → empty array (means: no scope restriction).
     * Falls back to the legacy single branch_id when the pivot is empty.
     */
    public function allowedBranchIds(): array
    {
        if ($this->isSuperAdmin()) return [];
        $ids = $this->branches()->pluck('branches.id')->map(fn($v) => (string) $v)->all();
        if (empty($ids) && $this->branch_id) $ids = [(string) $this->branch_id];
        return array_values(array_unique($ids));
    }

    /**
     * Super Admin = user with NO linked employee (employee_id IS NULL),
     * OR a user explicitly granted the legacy `super_admin` role in the
     * `user_roles` table (kept for backwards compatibility with users that
     * were promoted via the Admin > Users UI but still have an employee link).
     * These users bypass ALL permission checks.
     */
    public function isSuperAdmin(): bool
    {
        if (is_null($this->employee_id)) return true;

        try {
            if (!\Illuminate\Support\Facades\Schema::hasTable('user_roles')) return false;
            return \Illuminate\Support\Facades\DB::table('user_roles')
                ->where('user_id', $this->id)
                ->where('role', 'super_admin')
                ->exists();
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Check if user has a specific permission string like "sales.view" or "users.create".
     * Super Admin (employee_id == null) bypasses all checks.
     */
    public function hasPermission(string $permission): bool
    {
        if ($this->isSuperAdmin()) return true;

        // Parse "module.action" format
        $parts = explode('.', $permission, 2);
        if (count($parts) !== 2) return false;

        [$module, $action] = $parts;

        // Map action names to column names
        $columnMap = [
            'view' => 'can_view',
            'create' => 'can_add',
            'add' => 'can_add',
            'edit' => 'can_edit',
            'update' => 'can_edit',
            'delete' => 'can_delete',
            'generate' => 'can_add', // payroll.generate maps to can_add
            'approve' => 'can_edit', // approve maps to can_edit
        ];

        $column = $columnMap[$action] ?? null;
        if (!$column) return false;

        return $this->roles()
            ->join('role_permissions', 'custom_roles.id', '=', 'role_permissions.custom_role_id')
            ->where('role_permissions.module', $module)
            ->where("role_permissions.{$column}", 1)
            ->exists();
    }

    /**
     * Get all permissions as flat array of "module.action" strings.
     */
    public function getAllPermissions(): array
    {
        if ($this->isSuperAdmin()) {
            return ['*']; // Wildcard = full access
        }

        $rolePermissions = $this->roles()
            ->join('role_permissions', 'custom_roles.id', '=', 'role_permissions.custom_role_id')
            ->select('role_permissions.module', 'role_permissions.can_view', 'role_permissions.can_add', 'role_permissions.can_edit', 'role_permissions.can_delete')
            ->get();

        $permissions = [];
        $actionMap = ['can_view' => 'view', 'can_add' => 'create', 'can_edit' => 'edit', 'can_delete' => 'delete'];

        // Merge across roles (OR logic)
        $merged = [];
        foreach ($rolePermissions as $rp) {
            $mod = $rp->module;
            if (!isset($merged[$mod])) {
                $merged[$mod] = ['can_view' => false, 'can_add' => false, 'can_edit' => false, 'can_delete' => false];
            }
            foreach ($actionMap as $col => $action) {
                if ($rp->$col) $merged[$mod][$col] = true;
            }
        }

        foreach ($merged as $module => $flags) {
            foreach ($actionMap as $col => $action) {
                if ($flags[$col]) {
                    $permissions[] = "{$module}.{$action}";
                }
            }
        }

        return $permissions;
    }

    // Legacy compat
    public function hasRole(string $roleName): bool
    {
        return $this->roles()->where('name', $roleName)->exists();
    }
}
