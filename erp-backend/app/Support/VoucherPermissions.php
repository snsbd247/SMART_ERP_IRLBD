<?php

namespace App\Support;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Single source of truth for evaluating voucher-related permissions.
 *
 * Granted if ANY of the following match (OR semantics):
 *   - Super Admin (employee_id IS NULL)
 *   - per-type permission        e.g. "journal.edit", "payment.edit"
 *   - generic vouchers module    e.g. "vouchers.edit"
 *   - accounts module-wide       e.g. "accounts.edit"
 *
 * Actions accepted: view | create | edit | delete (aliases handled by User::hasPermission).
 */
class VoucherPermissions
{
    /** Voucher types that share the same permission surface. */
    public const TYPES = ['journal', 'payment', 'receipt', 'contra'];

    /** Umbrella modules that grant access across every voucher type. */
    public const UMBRELLA_MODULES = ['vouchers', 'accounts'];

    /**
     * Returns the ordered list of permission strings that would grant $action on $voucherType.
     * Used by the controller AND surfaced to the UI so it can mirror the same rules.
     */
    public static function candidatesFor(string $voucherType, string $action): array
    {
        $candidates = [];
        if (in_array($voucherType, self::TYPES, true)) {
            $candidates[] = "{$voucherType}.{$action}";
        }
        foreach (self::UMBRELLA_MODULES as $mod) {
            $candidates[] = "{$mod}.{$action}";
        }
        return $candidates;
    }

    public static function allows(User $user, string $voucherType, string $action): bool
    {
        if ($user->isSuperAdmin()) return true;
        foreach (self::candidatesFor($voucherType, $action) as $perm) {
            if ($user->hasPermission($perm)) return true;
        }
        return false;
    }

    /**
     * Evaluate and audit-log every denial with a correlation id so the
     * frontend can surface it and ops can trace it later.
     *
     * @return array{allowed:bool, correlation_id:string, candidates:array}
     */
    public static function authorize(
        User $user,
        string $voucherType,
        string $action,
        ?string $voucherId = null,
        ?Request $request = null
    ): array {
        $cid = (string) Str::uuid();
        $candidates = self::candidatesFor($voucherType, $action);
        $allowed = self::allows($user, $voucherType, $action);

        if (!$allowed) {
            try {
                AuditLog::create([
                    'user_id'    => $user->id,
                    'user_name'  => $user->name ?? $user->email ?? 'unknown',
                    'module'     => 'vouchers',
                    'action'     => "permission_denied:{$action}",
                    'record_id'  => $voucherId,
                    'details'    => "Denied {$action} on {$voucherType} voucher. cid={$cid}; tried=" . implode(',', $candidates),
                    'ip_address' => $request?->ip(),
                    'user_agent' => $request?->userAgent(),
                ]);
            } catch (\Throwable $e) {
                \Log::warning('Failed to write permission_denied audit row: ' . $e->getMessage());
            }
        }

        return ['allowed' => $allowed, 'correlation_id' => $cid, 'candidates' => $candidates];
    }
}
