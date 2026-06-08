<?php

namespace App\Http\Controllers;

use App\Models\CompanySetting;
use App\Models\Employee;
use App\Support\PasswordPolicy;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class PublicEmployeeRegistrationController extends BaseController
{
    /** Public: returns whether the form is enabled, plus dropdown options. */
    public function config()
    {
        $settings = CompanySetting::first();
        $enabled = (bool) ($settings->public_employee_registration_enabled ?? false);

        $data = [
            'enabled' => $enabled,
            'company_name' => $settings->company_name ?? 'Company',
            'company_logo_url' => $settings->company_logo_url ?? null,
            'next_employee_code' => $enabled ? $this->nextEmployeeCode() : null,
            'branches' => [],
            'departments' => [],
            'designations' => [],
        ];

        if ($enabled) {
            $data['branches'] = DB::table('branches')->where('status', 'active')->select('id', 'name')->orderBy('name')->get();
            $data['departments'] = DB::table('departments')->where('status', 'active')->select('id', 'name')->orderBy('name')->get();
            $data['designations'] = DB::table('designations')->where('status', 'active')->select('id', 'name')->orderBy('name')->get();
        }

        return $this->success($data);
    }

    /** Public: accept registration. Created as 'inactive' pending admin approval, no login account. */
    public function register(Request $request)
    {
        $settings = CompanySetting::first();
        if (!($settings && $settings->public_employee_registration_enabled)) {
            return $this->error('Public employee registration is disabled', 403);
        }

        $data = $request->validate([
            'first_name' => 'required|string|max:100',
            'last_name' => 'required|string|max:100',
            'email' => 'nullable|email|max:100',
            'mobile' => 'nullable|string|max:30',
            'address' => 'nullable|string',
            'national_id' => 'nullable|string|max:50',
            'department_id' => 'nullable|exists:departments,id',
            'designation_id' => 'nullable|exists:designations,id',
            'branch_id' => 'nullable|exists:branches,id',
            'joining_date' => 'required|date',
            'password' => 'nullable|string|max:100|confirmed',
            'password_confirmation' => 'nullable|string|max:100',
        ]);

        // Enforce strength policy when a password is provided.
        if (!empty($data['password'])) {
            if ($err = PasswordPolicy::validate($data['password'])) {
                throw ValidationException::withMessages(['password' => [$err]]);
            }
        }

        $plainPassword = $data['password'] ?? null;
        unset($data['password']);

        $employee = DB::transaction(function () use ($data, $plainPassword) {
            $code = $this->nextEmployeeCode();
            return Employee::create(array_merge($data, [
                'employee_code' => $code,
                'status' => 'inactive', // not yet active
                'approval_status' => 'pending', // awaiting admin approval
                'employment_type' => 'permanent',
                'salary' => 0,
                'proposed_password' => $plainPassword ? Hash::make($plainPassword) : null,
            ]));
        });

        return $this->success([
            'message' => 'Registration submitted. An administrator will review and activate your account.',
            'employee_code' => $employee->employee_code,
            'username_preview' => $employee->employee_code,
        ]);
    }

    private function nextEmployeeCode(): string
    {
        $last = Employee::where('employee_code', 'LIKE', 'EMP-%')
            ->orderByRaw("CAST(SUBSTRING(employee_code, 5) AS UNSIGNED) DESC")
            ->first();
        $n = 1;
        if ($last && preg_match('/^EMP-(\d+)$/i', $last->employee_code, $m)) {
            $n = (int) $m[1] + 1;
        }
        do {
            $code = 'EMP-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
            $n++;
        } while (Employee::where('employee_code', $code)->exists());
        return $code;
    }
}
