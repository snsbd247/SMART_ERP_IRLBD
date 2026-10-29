# Voucher Permission Mapping Spec

Single source of truth for how voucher-related permissions are evaluated across the
**backend** (Laravel) and **frontend** (React). Both layers MUST behave identically;
otherwise the UI shows a button that the API later refuses with `403`.

## Files

| Layer       | Path                                                  | Symbol                          |
| ----------- | ----------------------------------------------------- | ------------------------------- |
| Backend     | `backend/app/Support/VoucherPermissions.php`      | `App\Support\VoucherPermissions`|
| Frontend    | `src/lib/voucher-permissions.ts`                      | `evaluateVoucherPermission()`   |
| Reconciler  | `php artisan permissions:sync-vouchers [--dry-run]`   | `SyncVoucherPermissions`        |

## Rule (OR semantics)

A user is granted **`<action>`** on **`<voucher_type>`** if **ANY** of these match:

1. Super Admin (`employee_id IS NULL`) — bypasses all checks.
2. **Per-type** permission: `<voucher_type>.<action>`
3. **Umbrella module**: `vouchers.<action>`
4. **Module-wide**: `accounts.<action>`

```
allowed = super_admin
       OR has(`${type}.${action}`)
       OR has(`vouchers.${action}`)
       OR has(`accounts.${action}`)
```

### Voucher types

`journal`, `payment`, `receipt`, `contra`

### Actions

| Action   | `role_permissions` column |
| -------- | ------------------------- |
| `view`   | `can_view`                |
| `create` | `can_add`                 |
| `edit`   | `can_edit`                |
| `delete` | `can_delete`              |

## Worked examples

| User has                                            | Can edit journal? | Why                              |
| --------------------------------------------------- | :---------------: | -------------------------------- |
| `vouchers.edit`                                     | ✅                | Umbrella                         |
| `accounts.edit`                                     | ✅                | Module-wide                      |
| `journal.edit`                                      | ✅                | Per-type                         |
| `payment.edit` only                                 | ❌                | Wrong type, no umbrella          |
| `vouchers.view` only                                | ❌                | View ≠ edit                      |
| Super Admin                                         | ✅                | Bypass                           |

## Status overlay (UI only)

Even when the permission check passes, **approved** vouchers are editable only by
Super Admin. Reason surfaced in tooltip: *"Approved vouchers can only be edited
by Super Admin."*

## Correlation IDs

Every denial — UI tooltip click OR backend `403` — emits a correlation id:

- **Backend**: written to `audit_log` (`module=vouchers`, `action=permission_denied:<action>`) AND returned in the response body as `correlation_id`, with `required_any_of` listing the permission strings that would have granted access.
- **Frontend**: `evaluateVoucherPermission()` returns a `ui-…` cid surfaced in the destructive toast and via `logVoucherPermissionDenial()` to the browser console.

Quote the cid to support; it pinpoints the exact denial in `audit_log`.

## Keeping roles consistent

Admins toggle the **`vouchers`** module in the Roles & Permissions UI, but legacy
role rows may only carry per-type entries. Run:

```bash
php artisan permissions:sync-vouchers --dry-run   # preview
php artisan permissions:sync-vouchers             # apply
```

For each role this OR-merges `can_view/add/edit/delete` across
`vouchers + journal + payment + receipt + contra` and writes the merged flags
back to every one of those modules. Idempotent.

## When changing the rule

If you add a new voucher type or a new umbrella module:

1. Update `VOUCHER_TYPES` / `UMBRELLA_MODULES` in **both** files.
2. Re-run `permissions:sync-vouchers`.
3. Update this doc.
