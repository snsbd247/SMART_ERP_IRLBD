<?php

use Illuminate\Support\Facades\Route;

// ─── Installer Routes ────────────
// status is always public so the SPA can decide whether to redirect to /install
Route::get('install/status', [\App\Http\Controllers\InstallController::class, 'status']);
// The rest are blocked after install via InstallGuard
Route::prefix('install')->middleware(\App\Http\Middleware\InstallGuard::class)->group(function () {
    Route::get('check-environment', [\App\Http\Controllers\InstallController::class, 'checkEnvironment']);
    Route::post('test-database', [\App\Http\Controllers\InstallController::class, 'testDatabase']);
    Route::post('run', [\App\Http\Controllers\InstallController::class, 'install']);
});

// Auth (public)
Route::prefix('auth')->group(function () {
    Route::post('login', [\App\Http\Controllers\Auth\AuthController::class, 'login']);
    Route::post('forgot-password', [\App\Http\Controllers\Auth\AuthController::class, 'forgotPassword']);
    Route::post('reset-password', [\App\Http\Controllers\Auth\AuthController::class, 'resetPassword']);
});

// Public branding (read-only) — login page needs it before auth
Route::get('v1/public/branding', [\App\Http\Controllers\Admin\BrandingController::class, 'show']);

// Public employee registration (toggle-gated inside the controller)
Route::get('v1/public/employee-registration/config', [\App\Http\Controllers\PublicEmployeeRegistrationController::class, 'config']);
Route::post('v1/public/employee-registration', [\App\Http\Controllers\PublicEmployeeRegistrationController::class, 'register']);

// Public employee verification (used by /verify/{code} SPA route + QR)
Route::get('v1/public/employee-verify/{code}', function (string $code) {
    $emp = \App\Models\Employee::where('employee_code', $code)->first();
    if (!$emp) {
        return response()->json(['success' => false, 'message' => 'Employee not found'], 404);
    }
    $dept = $emp->department_id ? \App\Models\Department::find($emp->department_id) : null;
    $desig = $emp->designation_id ? \App\Models\Designation::find($emp->designation_id) : null;
    $company = \App\Models\CompanySetting::first();
    return response()->json(['success' => true, 'data' => [
        'first_name' => $emp->first_name,
        'last_name' => $emp->last_name,
        'employee_code' => $emp->employee_code,
        'photo_url' => $emp->photo_url,
        'status' => $emp->status,
        'joining_date' => $emp->joining_date,
        'department_name' => $dept?->name,
        'designation_name' => $desig?->name,
        'company_name' => $company?->company_name,
        'company_logo_url' => $company?->company_logo_url,
        'company_address' => $company?->address,
    ]]);
});

// Public digital signature for the employee verification certificate
// (HMAC proof-of-authenticity shown on the printable certificate + QR result).
Route::get('v1/public/employee-verify/{code}/signature', function (string $code) {
    $emp = \App\Models\Employee::where('employee_code', $code)->first();
    if (!$emp) {
        return response()->json(['success' => false, 'message' => 'Employee not found'], 404);
    }
    $issuedAt = now()->toIso8601String();
    $hash = hash_hmac('sha256', $code . '|' . $issuedAt, config('app.key'));
    return response()->json(['success' => true, 'data' => [
        'hash' => $hash,
        'hash_short' => substr($hash, 0, 12),
        'issued_at' => $issuedAt,
        'algorithm' => 'HMAC-SHA256',
    ]]);
});

// Public Google Drive OAuth callback — Google's browser redirect carries no
// Authorization header, so this must be reachable without auth:sanctum.
// Protected instead by a signed, time-limited `state` param (see
// BackupController::gdriveAuthUrl / gdriveCallback).
Route::get('v1/backups/gdrive/callback', [\App\Http\Controllers\Admin\BackupController::class, 'gdriveCallback']);

// License status/activation — same auth/scope as the main group below,
// same "v1" prefix so the frontend can call it consistently, but
// deliberately NOT behind LicenseGuard (applied only to the main group):
// a blocked deployment must still be able to fetch its own status and
// submit a renewed key to unblock itself.
Route::middleware(['auth:sanctum', \App\Http\Middleware\BranchScope::class, \App\Http\Middleware\UpdateLastSeen::class])->prefix('v1')->group(function () {
    Route::get('license/status', [\App\Http\Controllers\LicenseController::class, 'status']);
    Route::post('license/activate', [\App\Http\Controllers\LicenseController::class, 'activate']);
    Route::post('license/recheck', [\App\Http\Controllers\LicenseController::class, 'recheck']);
});

// Protected routes
Route::middleware(['auth:sanctum', \App\Http\Middleware\BranchScope::class, \App\Http\Middleware\UpdateLastSeen::class, \App\Http\Middleware\LicenseGuard::class])->group(function () {

    // Auth
    Route::prefix('auth')->group(function () {
        Route::post('logout', [\App\Http\Controllers\Auth\AuthController::class, 'logout']);
        Route::get('me', [\App\Http\Controllers\Auth\AuthController::class, 'me']);
        Route::put('profile', [\App\Http\Controllers\Auth\AuthController::class, 'updateProfile']);
        Route::post('change-password', [\App\Http\Controllers\Auth\AuthController::class, 'changePassword']);
    });

    // Legacy Admin > Users API aliases. Some VPS builds may still call
    // /api/users/... (without /v1); keep these routes available so delete and
    // transfer-delete do not fail with "route could not be found" after deploy.
    Route::middleware('permission:users.view')->group(function () {
        Route::get('users', [\App\Http\Controllers\Admin\UserController::class, 'index']);
        Route::get('users/{id}', [\App\Http\Controllers\Admin\UserController::class, 'show']);
        Route::get('users/{id}/check-related', [\App\Http\Controllers\Admin\UserController::class, 'checkRelated']);
    });
    Route::middleware('permission:users.create')->post('users', [\App\Http\Controllers\Admin\UserController::class, 'store']);
    Route::middleware('permission:users.edit')->put('users/{id}', [\App\Http\Controllers\Admin\UserController::class, 'update']);
    Route::middleware('permission:users.delete')->group(function () {
        Route::delete('users/{id}', [\App\Http\Controllers\Admin\UserController::class, 'destroy']);
        Route::post('users/{id}/transfer-delete', [\App\Http\Controllers\Admin\UserController::class, 'transferAndDelete']);
    });

    Route::prefix('v1')->group(function () {

        // ─── Dashboard summary ──────────────────────────────────
        Route::get('dashboard/summary', [\App\Http\Controllers\DashboardController::class, 'summary']);

        // ─── Accounting ─────────────────────────────────────────
        // Chart of Accounts
        Route::middleware('permission:accounts.view')->group(function () {
            Route::get('accounts/tree', [\App\Http\Controllers\Accounting\AccountController::class, 'tree']);
            Route::get('accounts/{id}/ledger', [\App\Http\Controllers\Accounting\AccountController::class, 'ledger']);
            Route::get('accounts', [\App\Http\Controllers\Accounting\AccountController::class, 'index']);
            Route::get('accounts/{id}', [\App\Http\Controllers\Accounting\AccountController::class, 'show']);
        });
        Route::middleware('permission:accounts.create')->post('accounts', [\App\Http\Controllers\Accounting\AccountController::class, 'store']);
        Route::middleware('permission:accounts.edit')->put('accounts/{id}', [\App\Http\Controllers\Accounting\AccountController::class, 'update']);
        Route::middleware('permission:accounts.delete')->delete('accounts/{id}', [\App\Http\Controllers\Accounting\AccountController::class, 'destroy']);

        // Vouchers — per-type permissions
        Route::middleware('permission:journal.view')->get('vouchers/journal', [\App\Http\Controllers\Accounting\VoucherController::class, 'index']);
        Route::middleware('permission:payment.view')->get('vouchers/payment', [\App\Http\Controllers\Accounting\VoucherController::class, 'index']);
        Route::middleware('permission:receipt.view')->get('vouchers/receipt', [\App\Http\Controllers\Accounting\VoucherController::class, 'index']);
        Route::middleware('permission:contra.view')->get('vouchers/contra', [\App\Http\Controllers\Accounting\VoucherController::class, 'index']);
        Route::middleware('permission:journal.view')->get('admin/vouchers/journal', [\App\Http\Controllers\Accounting\VoucherController::class, 'index']);
        Route::middleware('permission:payment.view')->get('admin/vouchers/payment', [\App\Http\Controllers\Accounting\VoucherController::class, 'index']);
        Route::middleware('permission:receipt.view')->get('admin/vouchers/receipt', [\App\Http\Controllers\Accounting\VoucherController::class, 'index']);
        Route::middleware('permission:contra.view')->get('admin/vouchers/contra', [\App\Http\Controllers\Accounting\VoucherController::class, 'index']);
        Route::middleware('permission:journal.view|payment.view|receipt.view|contra.view')->get('vouchers/creators', [\App\Http\Controllers\Accounting\VoucherController::class, 'creators']);
        Route::middleware('permission:accounts.view')->get('vouchers/pending', [\App\Http\Controllers\Accounting\VoucherController::class, 'pending']);
        Route::middleware('permission:accounts.view')->get('vouchers/{id}', [\App\Http\Controllers\Accounting\VoucherController::class, 'show'])->whereUuid('id');
        Route::middleware('permission:accounts.view')->get('admin/vouchers/{id}', [\App\Http\Controllers\Accounting\VoucherController::class, 'show'])->whereUuid('id');
        Route::middleware('permission:accounts.edit')->put('vouchers/{id}', [\App\Http\Controllers\Accounting\VoucherController::class, 'update'])->whereUuid('id');
        Route::middleware('permission:accounts.edit')->put('admin/vouchers/{id}', [\App\Http\Controllers\Accounting\VoucherController::class, 'update'])->whereUuid('id');

        Route::middleware('permission:journal.create')->post('vouchers/journal', [\App\Http\Controllers\Accounting\VoucherController::class, 'store']);
        Route::middleware('permission:payment.create')->post('vouchers/payment', [\App\Http\Controllers\Accounting\VoucherController::class, 'store']);
        Route::middleware('permission:receipt.create')->post('vouchers/receipt', [\App\Http\Controllers\Accounting\VoucherController::class, 'store']);
        Route::middleware('permission:contra.create')->post('vouchers/contra', [\App\Http\Controllers\Accounting\VoucherController::class, 'store']);
        Route::middleware('permission:journal.create')->post('admin/vouchers/journal', [\App\Http\Controllers\Accounting\VoucherController::class, 'store']);
        Route::middleware('permission:payment.create')->post('admin/vouchers/payment', [\App\Http\Controllers\Accounting\VoucherController::class, 'store']);
        Route::middleware('permission:receipt.create')->post('admin/vouchers/receipt', [\App\Http\Controllers\Accounting\VoucherController::class, 'store']);
        Route::middleware('permission:contra.create')->post('admin/vouchers/contra', [\App\Http\Controllers\Accounting\VoucherController::class, 'store']);

        Route::middleware('permission:accounts.edit')->group(function () {
            Route::post('vouchers/{id}/approve', [\App\Http\Controllers\Accounting\VoucherController::class, 'approve'])->whereUuid('id');
            Route::post('vouchers/{id}/reject', [\App\Http\Controllers\Accounting\VoucherController::class, 'reject'])->whereUuid('id');
            Route::post('admin/vouchers/{id}/approve', [\App\Http\Controllers\Accounting\VoucherController::class, 'approve'])->whereUuid('id');
            Route::post('admin/vouchers/{id}/reject', [\App\Http\Controllers\Accounting\VoucherController::class, 'reject'])->whereUuid('id');
            Route::post('vouchers/{id}/edit-approved', [\App\Http\Controllers\Accounting\VoucherController::class, 'editApproved'])->whereUuid('id');
            Route::post('vouchers/{id}/reopen', [\App\Http\Controllers\Accounting\VoucherController::class, 'reopen'])->whereUuid('id');
            Route::post('vouchers/{id}/reverse', [\App\Http\Controllers\Accounting\VoucherController::class, 'reverse'])->whereUuid('id');
        });
        // Approval dashboard endpoints
        Route::middleware('permission:accounts.view')->group(function () {
            Route::get('vouchers/{id}/approval-history', [\App\Http\Controllers\Accounting\VoucherController::class, 'approvalHistory'])->whereUuid('id');
        });
        Route::middleware('permission:accounts.delete|vouchers.delete|journal.delete|payment.delete|receipt.delete|contra.delete')->post('vouchers/{id}/delete-approved', [\App\Http\Controllers\Accounting\VoucherController::class, 'deleteApproved'])->whereUuid('id');
        Route::middleware('permission:accounts.edit|vouchers.edit')->post('vouchers/{id}/restore', [\App\Http\Controllers\Accounting\VoucherController::class, 'restore'])->whereUuid('id');
        Route::middleware('permission:accounts.delete|vouchers.delete')->post('vouchers/{id}/purge', [\App\Http\Controllers\Accounting\VoucherController::class, 'purge'])->whereUuid('id');
        Route::middleware('permission:accounts.edit')->post('vouchers/{id}/change-type', [\App\Http\Controllers\Accounting\VoucherController::class, 'changeType'])->whereUuid('id');


        // ─── Generic Super-Admin soft delete / restore (sales, purchases, payments) ──
        Route::middleware('permission:accounts.delete')->post('soft-delete/{table}/{id}', [\App\Http\Controllers\SoftDeleteController::class, 'delete']);
        Route::middleware('permission:accounts.edit')->post('soft-delete/{table}/{id}/restore', [\App\Http\Controllers\SoftDeleteController::class, 'restore']);

        // ─── Reports ────────────────────────────────────────────
        Route::middleware('permission:reports.view')->prefix('reports')->group(function () {
            Route::get('trial-balance', [\App\Http\Controllers\Accounting\ReportController::class, 'trialBalance']);
            Route::get('profit-loss', [\App\Http\Controllers\Accounting\ReportController::class, 'profitLoss']);
            Route::get('balance-sheet', [\App\Http\Controllers\Accounting\ReportController::class, 'balanceSheet']);
            Route::get('account-opening-sum', [\App\Http\Controllers\Accounting\ReportController::class, 'accountOpeningSum']);
            Route::get('account-ledger-entries', [\App\Http\Controllers\Accounting\ReportController::class, 'accountLedgerEntries']);
            Route::get('account-balances', [\App\Http\Controllers\Accounting\ReportController::class, 'accountBalances']);
            Route::get('voucher-creators', [\App\Http\Controllers\Accounting\ReportController::class, 'voucherCreators']);
        });

        // ─── Sales ──────────────────────────────────────────────
        Route::middleware('permission:sales.view')->group(function () {
            Route::get('sales-invoices', [\App\Http\Controllers\Sales\SalesInvoiceController::class, 'index']);
            Route::get('sales-invoices/{id}', [\App\Http\Controllers\Sales\SalesInvoiceController::class, 'show']);
        });
        Route::middleware('permission:sales.create')->group(function () {
            Route::post('sales-invoices', [\App\Http\Controllers\Sales\SalesInvoiceController::class, 'store']);
        });
        Route::middleware('permission:sales.edit')->put('sales-invoices/{id}', [\App\Http\Controllers\Sales\SalesInvoiceController::class, 'update']);
        Route::middleware('permission:sales.delete')->delete('sales-invoices/{id}', [\App\Http\Controllers\Sales\SalesInvoiceController::class, 'destroy']);
        Route::middleware('permission:sales.edit')->post('sales-invoices/{id}/approve', [\App\Http\Controllers\Sales\SalesInvoiceController::class, 'approve']);
        Route::middleware('permission:sales.edit')->post('sales-invoices/{id}/cancel', [\App\Http\Controllers\Sales\SalesInvoiceController::class, 'cancel']);
        Route::middleware('permission:sales.edit')->post('sales-invoices/{id}/edit-approved', [\App\Http\Controllers\Sales\SalesInvoiceController::class, 'editApproved']);
        Route::middleware('permission:sales.delete')->post('sales-invoices/{id}/delete-approved', [\App\Http\Controllers\Sales\SalesInvoiceController::class, 'deleteApproved']);

        // Sales Returns
        Route::middleware('permission:sales_returns.view')->group(function () {
            Route::get('sales-returns', [\App\Http\Controllers\Sales\SalesReturnController::class, 'index']);
            Route::get('sales-returns/{id}', [\App\Http\Controllers\Sales\SalesReturnController::class, 'show']);
        });
        Route::middleware('permission:sales_returns.create')->post('sales-returns', [\App\Http\Controllers\Sales\SalesReturnController::class, 'store']);
        Route::middleware('permission:sales_returns.edit')->put('sales-returns/{id}', [\App\Http\Controllers\Sales\SalesReturnController::class, 'update']);
        Route::middleware('permission:sales_returns.edit')->post('sales-returns/{id}/approve', [\App\Http\Controllers\Sales\SalesReturnController::class, 'approve']);
        Route::middleware('permission:sales_returns.edit')->post('sales-returns/{id}/cancel', [\App\Http\Controllers\Sales\SalesReturnController::class, 'cancel']);
        Route::middleware('permission:sales_returns.edit')->post('sales-returns/{id}/edit-approved', [\App\Http\Controllers\Sales\SalesReturnController::class, 'editApproved']);
        Route::middleware('permission:sales_returns.delete')->delete('sales-returns/{id}', [\App\Http\Controllers\Sales\SalesReturnController::class, 'destroy']);
        Route::middleware('permission:sales_returns.delete')->post('sales-returns/{id}/delete-approved', [\App\Http\Controllers\Sales\SalesReturnController::class, 'deleteApproved']);

        // Purchase Returns
        Route::middleware('permission:purchase_returns.view')->group(function () {
            Route::get('purchase-returns', [\App\Http\Controllers\Purchase\PurchaseReturnController::class, 'index']);
            Route::get('purchase-returns/{id}', [\App\Http\Controllers\Purchase\PurchaseReturnController::class, 'show']);
        });
        Route::middleware('permission:purchase_returns.create')->post('purchase-returns', [\App\Http\Controllers\Purchase\PurchaseReturnController::class, 'store']);
        Route::middleware('permission:purchase_returns.edit')->put('purchase-returns/{id}', [\App\Http\Controllers\Purchase\PurchaseReturnController::class, 'update']);
        Route::middleware('permission:purchase_returns.edit')->post('purchase-returns/{id}/approve', [\App\Http\Controllers\Purchase\PurchaseReturnController::class, 'approve']);
        Route::middleware('permission:purchase_returns.delete')->delete('purchase-returns/{id}', [\App\Http\Controllers\Purchase\PurchaseReturnController::class, 'destroy']);



        // Stock Adjustments
        Route::middleware('permission:stock_adjustments.view')->group(function () {
            Route::get('stock-adjustments', [\App\Http\Controllers\Inventory\StockAdjustmentController::class, 'index']);
            Route::get('stock-adjustments/{id}', [\App\Http\Controllers\Inventory\StockAdjustmentController::class, 'show']);
        });
        Route::middleware('permission:stock_adjustments.create')->post('stock-adjustments', [\App\Http\Controllers\Inventory\StockAdjustmentController::class, 'store']);
        Route::middleware('permission:stock_adjustments.edit')->post('stock-adjustments/{id}/approve', [\App\Http\Controllers\Inventory\StockAdjustmentController::class, 'approve']);
        Route::middleware('permission:stock_adjustments.delete')->delete('stock-adjustments/{id}', [\App\Http\Controllers\Inventory\StockAdjustmentController::class, 'destroy']);

        // Stock Transfers (Inter-warehouse)
        Route::middleware('permission:inventory.view')->group(function () {
            Route::get('stock-transfers', [\App\Http\Controllers\Inventory\StockTransferController::class, 'index']);
            Route::get('stock-transfers/{id}', [\App\Http\Controllers\Inventory\StockTransferController::class, 'show']);
        });
        Route::middleware('permission:inventory.create')->post('stock-transfers', [\App\Http\Controllers\Inventory\StockTransferController::class, 'store']);
        Route::middleware('permission:inventory.edit')->post('stock-transfers/{id}/approve', [\App\Http\Controllers\Inventory\StockTransferController::class, 'approve']);
        Route::middleware('permission:inventory.edit')->post('stock-transfers/{id}/cancel', [\App\Http\Controllers\Inventory\StockTransferController::class, 'cancel']);
        Route::middleware('permission:inventory.edit')->post('stock-transfers/{id}/edit-approved', [\App\Http\Controllers\Inventory\StockTransferController::class, 'editApproved']);
        Route::middleware('permission:inventory.delete')->delete('stock-transfers/{id}', [\App\Http\Controllers\Inventory\StockTransferController::class, 'destroy']);
        Route::middleware('permission:inventory.delete')->post('stock-transfers/{id}/delete-approved', [\App\Http\Controllers\Inventory\StockTransferController::class, 'deleteApproved']);

        // ─── Customers (separate permission key) ────────────────
        Route::middleware('permission:customers.view')->group(function () {
            Route::get('customers', [\App\Http\Controllers\Sales\CustomerController::class, 'index']);
            Route::get('customers/{id}', [\App\Http\Controllers\Sales\CustomerController::class, 'show']);
        });
        Route::middleware('permission:customers.create')->post('customers', [\App\Http\Controllers\Sales\CustomerController::class, 'store']);
        Route::middleware('permission:customers.edit')->put('customers/{id}', [\App\Http\Controllers\Sales\CustomerController::class, 'update']);
        Route::middleware('permission:customers.delete')->delete('customers/{id}', [\App\Http\Controllers\Sales\CustomerController::class, 'destroy']);

        // ─── Purchase / Suppliers — removed with Purchase module ───


        // ─── Inventory ──────────────────────────────────────────
        Route::middleware('permission:inventory.view')->group(function () {
            Route::get('items', [\App\Http\Controllers\Inventory\ItemController::class, 'index']);
            Route::get('items/{id}', [\App\Http\Controllers\Inventory\ItemController::class, 'show']);
            Route::get('warehouses', [\App\Http\Controllers\Inventory\WarehouseController::class, 'index']);
            Route::get('warehouses/{id}', [\App\Http\Controllers\Inventory\WarehouseController::class, 'show']);
            Route::get('item-categories', [\App\Http\Controllers\Inventory\ItemCategoryController::class, 'index']);
            Route::get('item-categories/{id}', [\App\Http\Controllers\Inventory\ItemCategoryController::class, 'show']);
            Route::get('units', [\App\Http\Controllers\Inventory\UnitController::class, 'index']);
            Route::get('units/{id}', [\App\Http\Controllers\Inventory\UnitController::class, 'show']);
        });
        Route::middleware('permission:inventory.create')->group(function () {
            Route::post('items', [\App\Http\Controllers\Inventory\ItemController::class, 'store']);
            Route::post('warehouses', [\App\Http\Controllers\Inventory\WarehouseController::class, 'store']);
            Route::post('item-categories', [\App\Http\Controllers\Inventory\ItemCategoryController::class, 'store']);
            Route::post('units', [\App\Http\Controllers\Inventory\UnitController::class, 'store']);
        });
        Route::middleware('permission:inventory.edit')->group(function () {
            Route::put('items/{id}', [\App\Http\Controllers\Inventory\ItemController::class, 'update']);
            Route::put('warehouses/{id}', [\App\Http\Controllers\Inventory\WarehouseController::class, 'update']);
            Route::put('item-categories/{id}', [\App\Http\Controllers\Inventory\ItemCategoryController::class, 'update']);
            Route::put('units/{id}', [\App\Http\Controllers\Inventory\UnitController::class, 'update']);
        });
        Route::middleware('permission:inventory.delete')->group(function () {
            Route::delete('items/{id}', [\App\Http\Controllers\Inventory\ItemController::class, 'destroy']);
            Route::delete('warehouses/{id}', [\App\Http\Controllers\Inventory\WarehouseController::class, 'destroy']);
            Route::delete('item-categories/{id}', [\App\Http\Controllers\Inventory\ItemCategoryController::class, 'destroy']);
            Route::delete('units/{id}', [\App\Http\Controllers\Inventory\UnitController::class, 'destroy']);
        });


        // ─── Manufacturing ──────────────────────────────────────
        Route::middleware('permission:manufacturing.view')->group(function () {
            Route::get('bom', [\App\Http\Controllers\Manufacturing\BomController::class, 'index']);
            Route::get('bom/{id}', [\App\Http\Controllers\Manufacturing\BomController::class, 'show']);
            Route::get('production', [\App\Http\Controllers\Manufacturing\ProductionController::class, 'index']);
            Route::get('production/{id}', [\App\Http\Controllers\Manufacturing\ProductionController::class, 'show']);
        });
        Route::middleware('permission:manufacturing.create')->group(function () {
            Route::post('bom', [\App\Http\Controllers\Manufacturing\BomController::class, 'store']);
            Route::post('production', [\App\Http\Controllers\Manufacturing\ProductionController::class, 'store']);
        });
        Route::middleware('permission:manufacturing.edit')->group(function () {
            Route::put('bom/{id}', [\App\Http\Controllers\Manufacturing\BomController::class, 'update']);
            Route::post('production/{id}/complete', [\App\Http\Controllers\Manufacturing\ProductionController::class, 'complete']);
            Route::post('production/{id}/cancel', [\App\Http\Controllers\Manufacturing\ProductionController::class, 'cancel']);
            Route::post('production/{id}/edit-approved', [\App\Http\Controllers\Manufacturing\ProductionController::class, 'editApproved']);
        });
        Route::middleware('permission:manufacturing.delete')->group(function () {
            Route::delete('bom/{id}', [\App\Http\Controllers\Manufacturing\BomController::class, 'destroy']);
            Route::delete('production/{id}', [\App\Http\Controllers\Manufacturing\ProductionController::class, 'destroy']);
            Route::post('production/{id}/delete-approved', [\App\Http\Controllers\Manufacturing\ProductionController::class, 'deleteApproved']);
        });

        // ─── HRM ────────────────────────────────────────────────
        Route::middleware('permission:hrm.view')->group(function () {
            Route::get('hr-dashboard', [\App\Http\Controllers\HRM\HrDashboardController::class, 'index']);
            Route::get('employees', [\App\Http\Controllers\HRM\EmployeeController::class, 'index']);
            Route::get('employees/pending-approvals', [\App\Http\Controllers\HRM\EmployeeController::class, 'pendingApprovals']);
            Route::get('employees/{id}', [\App\Http\Controllers\HRM\EmployeeController::class, 'show']);
            Route::get('employees/{id}/bank-info', fn($id) => response()->json(['success' => true, 'data' => \App\Models\EmployeeBankInfo::where('employee_id', $id)->first()]));
            Route::get('employees/{id}/education', fn($id) => response()->json(['success' => true, 'data' => \App\Models\EmployeeEducation::where('employee_id', $id)->get()]));
            Route::get('employees/{id}/experience', fn($id) => response()->json(['success' => true, 'data' => \App\Models\EmployeeExperience::where('employee_id', $id)->get()]));
            Route::get('employees/{id}/emergency-contacts', fn($id) => response()->json(['success' => true, 'data' => \App\Models\EmployeeEmergencyContact::where('employee_id', $id)->get()]));
            Route::get('employees/{id}/linked-user', [\App\Http\Controllers\HRM\EmployeeController::class, 'getLinkedUser']);
            Route::get('attendance', [\App\Http\Controllers\HRM\AttendanceController::class, 'index']);
            Route::get('departments', [\App\Http\Controllers\HRM\DepartmentController::class, 'index']);
            Route::get('departments/{id}', [\App\Http\Controllers\HRM\DepartmentController::class, 'show']);
            Route::get('designations', [\App\Http\Controllers\HRM\DesignationController::class, 'index']);
            Route::get('designations/{id}', [\App\Http\Controllers\HRM\DesignationController::class, 'show']);
            Route::get('shifts', [\App\Http\Controllers\HRM\ShiftController::class, 'index']);
            Route::get('shifts/{id}', [\App\Http\Controllers\HRM\ShiftController::class, 'show']);
            Route::get('leave-types', [\App\Http\Controllers\HRM\LeaveTypeController::class, 'index']);
            Route::get('leave-types/{id}', [\App\Http\Controllers\HRM\LeaveTypeController::class, 'show']);
            Route::get('leave-requests', [\App\Http\Controllers\HRM\LeaveRequestController::class, 'index']);
            Route::get('leave-requests/{id}', [\App\Http\Controllers\HRM\LeaveRequestController::class, 'show']);
            Route::get('overtime', [\App\Http\Controllers\HRM\OvertimeController::class, 'index']);
            Route::get('payroll', [\App\Http\Controllers\Payroll\PayrollController::class, 'index']);
            Route::get('payroll/{id}', [\App\Http\Controllers\Payroll\PayrollController::class, 'show']);
            Route::get('salary-structures', [\App\Http\Controllers\Payroll\SalaryStructureController::class, 'index']);
            Route::get('salary-structures/{id}', [\App\Http\Controllers\Payroll\SalaryStructureController::class, 'show']);
            // Funds (PF & Savings)
            Route::get('fund-settings', [\App\Http\Controllers\HRM\FundController::class, 'settingsIndex']);
            Route::get('fund-transactions', [\App\Http\Controllers\HRM\FundController::class, 'transactionsIndex']);
            Route::get('fund-balance/{employeeId}', [\App\Http\Controllers\HRM\FundController::class, 'balance']);
            Route::get('fund-contribution/{employeeId}', [\App\Http\Controllers\HRM\FundController::class, 'calculateContribution']);
        });
        Route::middleware('permission:hrm.create')->group(function () {
            Route::post('employees', [\App\Http\Controllers\HRM\EmployeeController::class, 'store']);
            Route::post('employees/{id}/upload-photo', [\App\Http\Controllers\HRM\EmployeeController::class, 'uploadPhoto']);
            Route::post('attendance', [\App\Http\Controllers\HRM\AttendanceController::class, 'store']);
            Route::post('attendance/bulk', [\App\Http\Controllers\HRM\AttendanceController::class, 'bulkStore']);
            Route::post('departments', [\App\Http\Controllers\HRM\DepartmentController::class, 'store']);
            Route::post('designations', [\App\Http\Controllers\HRM\DesignationController::class, 'store']);
            Route::post('shifts', [\App\Http\Controllers\HRM\ShiftController::class, 'store']);
            Route::post('leave-types', [\App\Http\Controllers\HRM\LeaveTypeController::class, 'store']);
            Route::post('leave-requests', [\App\Http\Controllers\HRM\LeaveRequestController::class, 'store']);
            Route::post('overtime', [\App\Http\Controllers\HRM\OvertimeController::class, 'store']);
            Route::post('payroll/process', [\App\Http\Controllers\Payroll\PayrollController::class, 'process']);
            Route::post('salary-structures', [\App\Http\Controllers\Payroll\SalaryStructureController::class, 'store']);
            // Funds
            Route::post('fund-settings', [\App\Http\Controllers\HRM\FundController::class, 'settingsStore']);
            Route::post('fund-transactions', [\App\Http\Controllers\HRM\FundController::class, 'transactionsStore']);
        });
        Route::middleware('permission:hrm.edit')->group(function () {
            Route::put('employees/{id}', [\App\Http\Controllers\HRM\EmployeeController::class, 'update']);
            Route::post('employees/{id}/approve', [\App\Http\Controllers\HRM\EmployeeController::class, 'approveRegistration']);
            Route::post('employees/{id}/reject', [\App\Http\Controllers\HRM\EmployeeController::class, 'rejectRegistration']);
            Route::post('employees/{id}/resend-approval-sms', [\App\Http\Controllers\HRM\EmployeeController::class, 'resendApprovalSms']);
            Route::put('attendance/{id}', [\App\Http\Controllers\HRM\AttendanceController::class, 'update']);
            Route::put('departments/{id}', [\App\Http\Controllers\HRM\DepartmentController::class, 'update']);
            Route::put('designations/{id}', [\App\Http\Controllers\HRM\DesignationController::class, 'update']);
            Route::put('shifts/{id}', [\App\Http\Controllers\HRM\ShiftController::class, 'update']);
            Route::put('leave-types/{id}', [\App\Http\Controllers\HRM\LeaveTypeController::class, 'update']);
            Route::put('leave-requests/{id}', [\App\Http\Controllers\HRM\LeaveRequestController::class, 'update']);
            Route::put('overtime/{id}', [\App\Http\Controllers\HRM\OvertimeController::class, 'update']);
            Route::post('overtime/{id}/approve', [\App\Http\Controllers\HRM\OvertimeController::class, 'approve']);
            Route::post('payroll/{id}/approve', [\App\Http\Controllers\Payroll\PayrollController::class, 'approve']);
            Route::post('payroll/approve-all', [\App\Http\Controllers\Payroll\PayrollController::class, 'approveAll']);
            Route::put('salary-structures/{id}', [\App\Http\Controllers\Payroll\SalaryStructureController::class, 'update']);
            // Funds
            Route::put('fund-settings/{id}', [\App\Http\Controllers\HRM\FundController::class, 'settingsUpdate']);
        });
        Route::middleware('permission:hrm.delete')->group(function () {
            Route::delete('employees/{id}', [\App\Http\Controllers\HRM\EmployeeController::class, 'destroy']);
            Route::delete('departments/{id}', [\App\Http\Controllers\HRM\DepartmentController::class, 'destroy']);
            Route::delete('designations/{id}', [\App\Http\Controllers\HRM\DesignationController::class, 'destroy']);
            Route::delete('shifts/{id}', [\App\Http\Controllers\HRM\ShiftController::class, 'destroy']);
            Route::delete('leave-types/{id}', [\App\Http\Controllers\HRM\LeaveTypeController::class, 'destroy']);
            Route::delete('leave-requests/{id}', [\App\Http\Controllers\HRM\LeaveRequestController::class, 'destroy']);
            Route::delete('overtime/{id}', [\App\Http\Controllers\HRM\OvertimeController::class, 'destroy']);
            Route::delete('salary-structures/{id}', [\App\Http\Controllers\Payroll\SalaryStructureController::class, 'destroy']);
            Route::delete('fund-settings/{id}', [\App\Http\Controllers\HRM\FundController::class, 'settingsDestroy']);
        });

        // ─── Portal self-service (no hrm permission required) ────
        Route::post('portal/attendance/self', [\App\Http\Controllers\HRM\AttendanceController::class, 'selfCheckIn']);
        Route::get('portal/attendance/today', [\App\Http\Controllers\HRM\AttendanceController::class, 'selfToday']);
        Route::post('portal/attendance/geo-permission', [\App\Http\Controllers\HRM\AttendanceController::class, 'logGeoPermission']);


        // ─── Administration ─────────────────────────────────────
        // Branches
        Route::middleware('permission:branches.view')->group(function () {
            Route::get('branches', [\App\Http\Controllers\Admin\BranchController::class, 'index']);
            Route::get('branches/{id}', [\App\Http\Controllers\Admin\BranchController::class, 'show']);
        });
        Route::middleware('permission:branches.create')->post('branches', [\App\Http\Controllers\Admin\BranchController::class, 'store']);
        Route::middleware('permission:branches.edit')->put('branches/{id}', [\App\Http\Controllers\Admin\BranchController::class, 'update']);
        Route::middleware('permission:branches.delete')->delete('branches/{id}', [\App\Http\Controllers\Admin\BranchController::class, 'destroy']);

        // Users
        Route::middleware('permission:users.view')->group(function () {
            Route::get('users', [\App\Http\Controllers\Admin\UserController::class, 'index']);
            Route::get('users/{id}', [\App\Http\Controllers\Admin\UserController::class, 'show']);
            Route::get('users/{id}/check-related', [\App\Http\Controllers\Admin\UserController::class, 'checkRelated']);
        });
        Route::middleware('permission:users.create')->post('users', [\App\Http\Controllers\Admin\UserController::class, 'store']);
        Route::middleware('permission:users.edit')->put('users/{id}', [\App\Http\Controllers\Admin\UserController::class, 'update']);
        Route::middleware('permission:users.delete')->group(function () {
            Route::delete('users/{id}', [\App\Http\Controllers\Admin\UserController::class, 'destroy']);
            Route::post('users/{id}/transfer-delete', [\App\Http\Controllers\Admin\UserController::class, 'transferAndDelete']);
        });
        Route::middleware('permission:users.view')->get('admin/users', [\App\Http\Controllers\Admin\UserController::class, 'index']);
        Route::middleware('permission:users.create')->post('admin/users', [\App\Http\Controllers\Admin\UserController::class, 'store']);
        Route::middleware('permission:users.edit')->put('admin/users/{id}', [\App\Http\Controllers\Admin\UserController::class, 'update']);

        // Roles
        Route::middleware('permission:roles.view')->group(function () {
            Route::get('roles', [\App\Http\Controllers\Admin\RoleController::class, 'index']);
            Route::get('roles/{id}', [\App\Http\Controllers\Admin\RoleController::class, 'show']);
        });
        Route::middleware('permission:roles.create')->post('roles', [\App\Http\Controllers\Admin\RoleController::class, 'store']);
        Route::middleware('permission:roles.edit')->put('roles/{id}', [\App\Http\Controllers\Admin\RoleController::class, 'update']);
        Route::middleware('permission:roles.delete')->delete('roles/{id}', [\App\Http\Controllers\Admin\RoleController::class, 'destroy']);

        // Financial Years
        Route::middleware('permission:financial_years.view')->group(function () {
            Route::get('financial-years', [\App\Http\Controllers\Admin\FinancialYearController::class, 'index']);
            Route::get('financial-years/{id}', [\App\Http\Controllers\Admin\FinancialYearController::class, 'show']);
        });
        Route::middleware('permission:financial_years.create')->post('financial-years', [\App\Http\Controllers\Admin\FinancialYearController::class, 'store']);
        Route::middleware('permission:financial_years.edit')->group(function () {
            Route::put('financial-years/{id}', [\App\Http\Controllers\Admin\FinancialYearController::class, 'update']);
        });
        Route::middleware('permission:financial_years.delete')->delete('financial-years/{id}', [\App\Http\Controllers\Admin\FinancialYearController::class, 'destroy']);

        // Settings — company profile is read by every authenticated user
        // (currency, branding, app-wide context). Edit stays permission-gated.
        Route::get('settings/company', [\App\Http\Controllers\Admin\SettingsController::class, 'show']);
        Route::middleware('permission:settings.edit')->put('settings/company', [\App\Http\Controllers\Admin\SettingsController::class, 'update']);

        // ─── Backup & Restore (Super Admin only) ─────────────────
        Route::prefix('backups')->group(function () {
            Route::get('/', [\App\Http\Controllers\Admin\BackupController::class, 'index']);
            Route::post('create', [\App\Http\Controllers\Admin\BackupController::class, 'create']);
            Route::get('{id}/download', [\App\Http\Controllers\Admin\BackupController::class, 'download']);
            Route::post('{id}/gdrive-upload', [\App\Http\Controllers\Admin\BackupController::class, 'gdriveUpload']);
            Route::post('restore', [\App\Http\Controllers\Admin\BackupController::class, 'restore']);
            Route::delete('{id}', [\App\Http\Controllers\Admin\BackupController::class, 'destroy']);
            Route::get('settings', [\App\Http\Controllers\Admin\BackupController::class, 'settings']);
            Route::put('settings', [\App\Http\Controllers\Admin\BackupController::class, 'settings']);
            Route::post('gdrive/test', [\App\Http\Controllers\Admin\BackupController::class, 'gdriveTest']);
            Route::get('gdrive/auth-url', [\App\Http\Controllers\Admin\BackupController::class, 'gdriveAuthUrl']);
            Route::get('gdrive/folders', [\App\Http\Controllers\Admin\BackupController::class, 'gdriveFolders']);
            Route::post('gdrive/folders', [\App\Http\Controllers\Admin\BackupController::class, 'gdriveCreateFolder']);
            Route::post('gdrive/select-folder', [\App\Http\Controllers\Admin\BackupController::class, 'gdriveSelectFolder']);
            Route::post('gdrive/disconnect', [\App\Http\Controllers\Admin\BackupController::class, 'gdriveDisconnect']);
        });

        // ─── VAT Software Data Import (Super Admin only) ──────────
        Route::prefix('vat-import')->group(function () {
            Route::get('sales', [\App\Http\Controllers\Admin\VatImportController::class, 'salesIndex']);
            Route::get('sales/{id}/items', [\App\Http\Controllers\Admin\VatImportController::class, 'salesItems']);
            Route::post('sales/import', [\App\Http\Controllers\Admin\VatImportController::class, 'importSales']);
            Route::get('purchase', [\App\Http\Controllers\Admin\VatImportController::class, 'purchaseIndex']);
            Route::get('purchase/{id}/items', [\App\Http\Controllers\Admin\VatImportController::class, 'purchaseItems']);
            Route::post('purchase/import', [\App\Http\Controllers\Admin\VatImportController::class, 'importPurchase']);
            Route::get('vat-challans', [\App\Http\Controllers\Admin\VatImportController::class, 'vatChallansIndex']);
            Route::post('vat-challans/import', [\App\Http\Controllers\Admin\VatImportController::class, 'importVatChallans']);
        });

        // ─── SMS (Super Admin only) ──────────────────────────────
        Route::post('sms/send', [\App\Http\Controllers\Admin\SmsController::class, 'send']);

        // ─── Demo Data Seeder (Super Admin only) ─────────────────
        Route::post('admin/demo/seed', [\App\Http\Controllers\Admin\DemoSeedController::class, 'run']);
        Route::get ('admin/demo/audit-tables', [\App\Http\Controllers\Admin\DemoSeedController::class, 'auditTables']);
        Route::get ('admin/demo/audit-log/export', [\App\Http\Controllers\Admin\DemoSeedController::class, 'auditExport']);
        Route::post('admin/demo/import-config', [\App\Http\Controllers\Admin\DemoConfigImportController::class, 'import']);

        // ─── Branding & White-Label (Super Admin only) ───────────
        Route::get('admin/branding', [\App\Http\Controllers\Admin\BrandingController::class, 'show']);
        Route::put('admin/branding', [\App\Http\Controllers\Admin\BrandingController::class, 'update']);
        Route::post('admin/branding/logo', [\App\Http\Controllers\Admin\BrandingController::class, 'uploadLogo']);

        // ─── Generic CRUD bridge (used by frontend Supabase-compat layer) ────
        // Keeps every page that calls supabase.from(...) functional on VPS
        // without needing per-table controllers. Auth is enforced by the
        // outer auth:sanctum middleware; per-table security lives in the
        // denylist inside GenericTableController.
        Route::get('db/{table}',          [\App\Http\Controllers\GenericTableController::class, 'index']);
        Route::get('db/{table}/{id}',     [\App\Http\Controllers\GenericTableController::class, 'show']);
        Route::post('db/{table}',         [\App\Http\Controllers\GenericTableController::class, 'store']);
        Route::patch('db/{table}',        [\App\Http\Controllers\GenericTableController::class, 'update']);
        Route::put('db/{table}',          [\App\Http\Controllers\GenericTableController::class, 'upsert']);
        Route::delete('db/{table}',       [\App\Http\Controllers\GenericTableController::class, 'destroy']);

        // ─── Generic storage bridge ──────────────────────────────────────────
        Route::post('storage/{bucket}',          [\App\Http\Controllers\GenericStorageController::class, 'upload']);
        Route::delete('storage/{bucket}/{path}', [\App\Http\Controllers\GenericStorageController::class, 'destroy'])->where('path', '.*');
        Route::get('storage/{bucket}/{path}',    [\App\Http\Controllers\GenericStorageController::class, 'publicUrl'])->where('path', '.*');





        // ─── Audit Log (read-only) ──────────────────────────────
        Route::middleware('permission:audit_log.view')->group(function () {
            Route::get('audit-log', function (\Illuminate\Http\Request $request) {
                $query = \App\Models\AuditLog::query();
                if ($request->module) $query->where('module', $request->module);
                if ($request->action) $query->where('action', $request->action);
                if ($request->user_id) $query->where('user_id', $request->user_id);
                if ($request->from) $query->where('created_at', '>=', $request->from);
                if ($request->to) $query->where('created_at', '<=', $request->to);
                return response()->json([
                    'success' => true,
                    'data' => $query->orderByDesc('created_at')->paginate($request->per_page ?? 50)->items(),
                ]);
            });

            Route::get('user-activities', function (\Illuminate\Http\Request $request) {
                $query = \App\Models\UserActivity::query();
                if ($request->user_id) $query->where('user_id', $request->user_id);
                if ($request->activity_type) $query->where('activity_type', $request->activity_type);
                if ($request->from) $query->where('created_at', '>=', $request->from);
                if ($request->to) $query->where('created_at', '<=', $request->to);
                return response()->json([
                    'success' => true,
                    'data' => $query->orderByDesc('created_at')->paginate($request->per_page ?? 50)->items(),
                ]);
            });
        });

        // ─── Print & PDF ────────────────────────────────────────
        Route::prefix('print')->group(function () {
            Route::get('invoices/{id}', [\App\Http\Controllers\Print\PrintController::class, 'invoicePrint']);
            Route::get('invoices/{id}/pdf', [\App\Http\Controllers\Print\PrintController::class, 'invoicePdf']);
            Route::get('purchases/{id}', [\App\Http\Controllers\Print\PrintController::class, 'purchasePrint']);
            Route::get('purchases/{id}/pdf', [\App\Http\Controllers\Print\PrintController::class, 'purchasePdf']);
            Route::get('ledger', [\App\Http\Controllers\Print\PrintController::class, 'ledgerPrint']);
            Route::get('ledger/pdf', [\App\Http\Controllers\Print\PrintController::class, 'ledgerPdf']);
            Route::get('payments/{id}', [\App\Http\Controllers\Print\PrintController::class, 'paymentPrint']);
            Route::get('payments/{id}/pdf', [\App\Http\Controllers\Print\PrintController::class, 'paymentPdf']);
            Route::get('statement', [\App\Http\Controllers\Print\PrintController::class, 'statementPrint']);
            Route::get('statement/pdf', [\App\Http\Controllers\Print\PrintController::class, 'statementPdf']);
        });

        // ─── Document Email (printed documents sent via PrintLayout) ────
        Route::post('documents/email', [\App\Http\Controllers\DocumentMailController::class, 'send']);

        // ─── Payments & Ledger ──────────────────────────────────
        Route::prefix('payments')->group(function () {
            Route::middleware('permission:sales.view')->group(function () {
                Route::get('/', [\App\Http\Controllers\Payment\PaymentController::class, 'index']);
                Route::get('ledger', [\App\Http\Controllers\Payment\PaymentController::class, 'ledger']);
                Route::get('invoice-dues', [\App\Http\Controllers\Payment\PaymentController::class, 'invoiceDues']);
                Route::get('summary', [\App\Http\Controllers\Payment\PaymentController::class, 'summary']);
                Route::get('aging', [\App\Http\Controllers\Payment\PaymentController::class, 'aging']);
                Route::get('notes', [\App\Http\Controllers\Payment\PaymentController::class, 'notes']);
            });
            Route::middleware('permission:sales.create')->group(function () {
                Route::post('/', [\App\Http\Controllers\Payment\PaymentController::class, 'store']);
                Route::post('{id}/auto-allocate', [\App\Http\Controllers\Payment\PaymentController::class, 'autoAllocate']);
                Route::post('notes', [\App\Http\Controllers\Payment\PaymentController::class, 'addNote']);
            });
            Route::middleware('permission:sales.delete')->group(function () {
                Route::delete('{id}', [\App\Http\Controllers\Payment\PaymentController::class, 'destroy']);
                Route::delete('notes/{id}', [\App\Http\Controllers\Payment\PaymentController::class, 'deleteNote']);
            });
        });

        // ─── Internal Messaging ─────────────────────────────────
        Route::middleware('permission:messaging.view')->prefix('messaging')->group(function () {
            Route::get('conversations', [\App\Http\Controllers\Messaging\MessageController::class, 'conversations']);
            Route::get('conversations/{id}/messages', [\App\Http\Controllers\Messaging\MessageController::class, 'messages']);
            Route::post('messages/{id}/read', [\App\Http\Controllers\Messaging\MessageController::class, 'markRead']);
            Route::get('unread-count', [\App\Http\Controllers\Messaging\MessageController::class, 'unreadCount']);
        });
        Route::middleware('permission:messaging.create')->prefix('messaging')->group(function () {
            Route::post('conversations', [\App\Http\Controllers\Messaging\MessageController::class, 'createConversation']);
            Route::post('conversations/{id}/messages', [\App\Http\Controllers\Messaging\MessageController::class, 'sendMessage']);
        });

        // ─── Bangladesh VAT Sales Workflow ──────────────────────
        // Purchase Orders
        Route::middleware('permission:purchase_orders.view')->group(function () {
            Route::get('purchase-orders', [\App\Http\Controllers\SalesWorkflow\PurchaseOrderController::class, 'index']);
            Route::get('purchase-orders/{id}', [\App\Http\Controllers\SalesWorkflow\PurchaseOrderController::class, 'show']);
        });
        Route::middleware('permission:purchase_orders.create')->post('purchase-orders', [\App\Http\Controllers\SalesWorkflow\PurchaseOrderController::class, 'store']);
        Route::middleware('permission:purchase_orders.edit')->put('purchase-orders/{id}', [\App\Http\Controllers\SalesWorkflow\PurchaseOrderController::class, 'update']);
        Route::middleware('permission:purchase_orders.delete')->delete('purchase-orders/{id}', [\App\Http\Controllers\SalesWorkflow\PurchaseOrderController::class, 'destroy']);

        // VAT Challan
        Route::middleware('permission:vat_challans.view')->group(function () {
            Route::get('vat-challans', [\App\Http\Controllers\SalesWorkflow\VatChallanController::class, 'index']);
            Route::get('vat-challans/po-availability/{poId}', [\App\Http\Controllers\SalesWorkflow\VatChallanController::class, 'poAvailability']);
            Route::get('vat-challans/{id}', [\App\Http\Controllers\SalesWorkflow\VatChallanController::class, 'show']);
        });
        Route::middleware('permission:vat_challans.create')->post('vat-challans', [\App\Http\Controllers\SalesWorkflow\VatChallanController::class, 'store']);
        Route::middleware('permission:vat_challans.delete')->delete('vat-challans/{id}', [\App\Http\Controllers\SalesWorkflow\VatChallanController::class, 'destroy']);

        // Delivery Challan + receive workflow
        Route::middleware('permission:delivery_challans.view')->group(function () {
            Route::get('delivery-challans', [\App\Http\Controllers\SalesWorkflow\DeliveryChallanController::class, 'index']);
            Route::get('delivery-challans/{id}', [\App\Http\Controllers\SalesWorkflow\DeliveryChallanController::class, 'show']);
        });
        Route::middleware('permission:customer_receive.create')->post('delivery-challans/{id}/customer-receive', [\App\Http\Controllers\SalesWorkflow\DeliveryChallanController::class, 'customerReceive']);
        Route::middleware('permission:ho_receive.create')->post('delivery-challans/{id}/ho-receive', [\App\Http\Controllers\SalesWorkflow\DeliveryChallanController::class, 'hoReceive']);
        Route::middleware('permission:delivery_challans.edit')->post('delivery-challans/{id}/status', [\App\Http\Controllers\SalesWorkflow\DeliveryChallanController::class, 'setStatus']);
        Route::middleware('permission:delivery_challans.delete')->delete('delivery-challans/{id}', [\App\Http\Controllers\SalesWorkflow\DeliveryChallanController::class, 'destroy']);

        // Invoice Processing + Payment + TDS
        Route::middleware('permission:invoice_processing.view')->group(function () {
            Route::get('invoices-v2', [\App\Http\Controllers\SalesWorkflow\InvoiceV2Controller::class, 'index']);
            Route::get('invoices-v2/eligible', [\App\Http\Controllers\SalesWorkflow\InvoiceV2Controller::class, 'eligible']);
            Route::get('invoices-v2/{id}', [\App\Http\Controllers\SalesWorkflow\InvoiceV2Controller::class, 'show']);
        });
        Route::middleware('permission:invoice_processing.create')->post('invoices-v2', [\App\Http\Controllers\SalesWorkflow\InvoiceV2Controller::class, 'store']);
        Route::middleware('permission:invoice_payment.create')->post('invoices-v2/{id}/payments', [\App\Http\Controllers\SalesWorkflow\InvoiceV2Controller::class, 'payment']);
        Route::middleware('permission:invoice_processing.edit')->post('invoices-v2/{id}/submit-bill', [\App\Http\Controllers\SalesWorkflow\InvoiceV2Controller::class, 'submitBill']);
        Route::middleware('permission:invoice_processing.delete')->delete('invoices-v2/{id}', [\App\Http\Controllers\SalesWorkflow\InvoiceV2Controller::class, 'destroy']);

        // GitHub Deploy Sync — Super Admin only (enforced inside controller).
        Route::prefix('admin/deploy')->group(function () {
            Route::post('pull',     [\App\Http\Controllers\Admin\DeployController::class, 'pull']);
            Route::get ('status',   [\App\Http\Controllers\Admin\DeployController::class, 'status']);
            Route::post('rollback', [\App\Http\Controllers\Admin\DeployController::class, 'rollback']);
        });
    });
});

