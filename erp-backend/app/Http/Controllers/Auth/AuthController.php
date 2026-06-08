<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\BaseController;
use App\Models\User;
use App\Models\LoginLog;
use App\Services\UserActivityService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

class AuthController extends BaseController
{
    public function __construct(private UserActivityService $activityService) {}

    public function login(Request $request)
    {
        $request->validate(['username' => 'required', 'password' => 'required']);

        $login = trim((string) $request->username);
        $user = User::where(function ($query) use ($login) {
            $query->where('username', $login)->orWhere('email', $login);
        })->first();
        if (!$user || !Hash::check($request->password, $user->password)) {
            try {
                $this->activityService->log('failed_login', "Failed login for: {$login}", $request, null, [
                    'username' => $login,
                    'status' => 'failed',
                ]);
            } catch (\Throwable) {
                // Login/audit logging must never turn an auth response into a 500.
            }
            return $this->error('Invalid credentials', 401);
        }
        if ($user->status !== 'active') {
            try {
                $this->activityService->log('failed_login', "Disabled account login: {$login}", $request, $user->id, [
                    'username' => $login,
                    'status' => 'disabled',
                ]);
            } catch (\Throwable) {
                // Login/audit logging must never turn an auth response into a 500.
            }
            return $this->error('Account is disabled', 403);
        }

        $token = $user->createToken('api')->plainTextToken;
        try {
            $user->update(['is_online' => true, 'last_seen_at' => now(), 'last_login_at' => now()]);
        } catch (\Throwable) {
            // Keep login working even if optional presence columns are not available yet.
        }
        $roles = $user->roles()->with('permissions')->get();
        $permissions = $user->getAllPermissions();

        try {
            LoginLog::create([
                'user_id' => $user->id,
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'login_time' => now(),
            ]);
            $this->activityService->logLogin($user->id, $request, true);
            Log::info("User logged in: {$user->username}, Super Admin: " . ($user->isSuperAdmin() ? 'YES' : 'NO') . ", Permissions: " . json_encode($permissions));
        } catch (\Throwable) {
            // Login/audit logging must never turn a successful auth into a 500.
        }

        return $this->success([
            'token' => $token,
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'name' => $user->name,
                'email' => $user->email,
                'phone' => $user->phone,
                'branch_id' => $user->branch_id,
                'employee_id' => $user->employee_id,
                'is_super_admin' => $user->isSuperAdmin(),
                'roles' => $roles,
                'permissions' => $permissions,
            ],
        ]);
    }

    public function logout(Request $request)
    {
        $user = $request->user();
        $user->update(['is_online' => false, 'last_seen_at' => now()]);

        // Update the latest login log with logout time
        $latestLog = LoginLog::where('user_id', $user->id)
            ->whereNull('logout_time')
            ->orderBy('login_time', 'desc')
            ->first();
        if ($latestLog) {
            $latestLog->update(['logout_time' => now()]);
        }

        $this->activityService->logLogout($user->id, $request);
        $user->currentAccessToken()->delete();
        return $this->success(null, 'Logged out');
    }

    public function me(Request $request)
    {
        $user = $request->user()->load('roles.permissions', 'branch');
        return $this->success([
            'user' => $user,
            'is_super_admin' => $user->isSuperAdmin(),
            'permissions' => $user->getAllPermissions(),
        ]);
    }

    public function updateProfile(Request $request)
    {
        $user = $request->user();

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'username' => 'required|string|max:255|unique:users,username,' . $user->id,
            'email' => 'required|email|max:255|unique:users,email,' . $user->id,
            'phone' => 'nullable|string|max:50',
        ]);

        $user->update($validated);
        $this->activityService->log('profile_update', 'Profile updated', $request, $user->id);

        return $this->success(['user' => $user->fresh()->load('roles.permissions', 'branch')], 'Profile updated');
    }

    public function changePassword(Request $request)
    {
        $request->validate([
            'current_password' => 'nullable',
            'new_password' => 'required|string|min:8|max:100|confirmed',
        ]);

        if ($err = \App\Support\PasswordPolicy::validate($request->new_password)) {
            return $this->error($err, 422);
        }

        $user = $request->user();
        if ($request->filled('current_password') && !Hash::check($request->current_password, $user->password)) {
            return $this->error('Current password is incorrect', 422);
        }

        $user->update(['password' => Hash::make($request->new_password)]);
        $this->activityService->log('password_change', 'Password changed', $request, $user->id);

        return $this->success(null, 'Password changed');
    }

    /**
     * Public: request a password-reset OTP. Sent to user's phone (employee accounts use mobile).
     * Always returns success to avoid leaking which usernames exist.
     */
    public function forgotPassword(Request $request)
    {
        $request->validate(['username' => 'required|string|max:100']);
        $login = trim((string) $request->username);

        $user = User::where('username', $login)->orWhere('email', $login)->first();
        if ($user && !empty($user->phone)) {
            // Invalidate previous unused OTPs
            \DB::table('password_reset_otps')
                ->where('user_id', $user->id)->whereNull('used_at')
                ->update(['used_at' => now()]);

            $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            \DB::table('password_reset_otps')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'user_id' => $user->id,
                'code_hash' => Hash::make($code),
                'channel' => 'sms',
                'expires_at' => now()->addMinutes(15),
                'ip_address' => $request->ip(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            try {
                app(\App\Services\SmsService::class)->sendSMS(
                    $user->phone,
                    "Your password reset code is: {$code}. It expires in 15 minutes. If you did not request this, ignore this message.",
                    'password_reset',
                    (string) $user->id
                );
            } catch (\Throwable $e) {
                Log::warning('Password reset SMS failed: ' . $e->getMessage());
            }
        }

        return $this->success(null, 'If the account exists, a reset code has been sent to the registered mobile number.');
    }

    /**
     * Public: verify OTP + set a new password.
     */
    public function resetPassword(Request $request)
    {
        $request->validate([
            'username' => 'required|string|max:100',
            'code' => 'required|string|size:6',
            'new_password' => 'required|string|min:8|max:100|confirmed',
        ]);

        if ($err = \App\Support\PasswordPolicy::validate($request->new_password)) {
            return $this->error($err, 422);
        }

        $user = User::where('username', $request->username)->orWhere('email', $request->username)->first();
        if (!$user) return $this->error('Invalid code or username', 422);

        $otp = \DB::table('password_reset_otps')
            ->where('user_id', $user->id)
            ->whereNull('used_at')
            ->where('expires_at', '>', now())
            ->orderBy('created_at', 'desc')
            ->first();

        if (!$otp) return $this->error('Invalid or expired code', 422);
        if ($otp->attempts >= 5) return $this->error('Too many attempts. Request a new code.', 429);

        if (!Hash::check($request->code, $otp->code_hash)) {
            \DB::table('password_reset_otps')->where('id', $otp->id)->increment('attempts');
            return $this->error('Invalid or expired code', 422);
        }

        \DB::transaction(function () use ($user, $otp, $request) {
            $user->update(['password' => Hash::make($request->new_password)]);
            \DB::table('password_reset_otps')->where('id', $otp->id)->update(['used_at' => now()]);
            // Invalidate any other outstanding tokens for this user
            \DB::table('password_reset_otps')
                ->where('user_id', $user->id)->whereNull('used_at')
                ->update(['used_at' => now()]);
        });

        $this->activityService->log('password_reset', 'Password reset via OTP', $request, $user->id);
        return $this->success(null, 'Password has been reset. You can now log in.');
    }
}
