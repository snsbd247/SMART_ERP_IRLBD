<?php

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\BaseController;
use App\Models\AccVoucher;
use App\Models\VoucherEntry;
use App\Repositories\VoucherRepository;
use App\Services\AccountingService;
use App\Services\AuditService;
use App\Services\FinancialPeriodGuard;
use App\Support\VoucherPermissions;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class VoucherController extends BaseController
{
    public function __construct(
        private VoucherRepository $repo,
        private AccountingService $service,
        private FinancialPeriodGuard $period,
        private AuditService $audit,
    ) {}


    private function normalizeVoucherDateInput(Request $request): void
    {
        $raw = $request->input('voucher_date');
        if (!is_string($raw) || trim($raw) === '') return;

        $raw = trim($raw);
        try {
            if (preg_match('/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/', $raw, $m)) {
                $request->merge(['voucher_date' => sprintf('%04d-%02d-%02d', (int) $m[3], (int) $m[2], (int) $m[1])]);
            } else {
                $request->merge(['voucher_date' => Carbon::parse($raw)->toDateString()]);
            }
        } catch (\Throwable) {
            // Let Laravel's validator return a clear voucher_date error.
        }
    }

    private function assertUniqueLedgerAccounts(array $entries): void
    {
        $accountIds = collect($entries)
            ->filter(fn ($entry) => !empty($entry['account_id']) && (((float) ($entry['debit'] ?? 0)) > 0 || ((float) ($entry['credit'] ?? 0)) > 0))
            ->pluck('account_id');

        if ($accountIds->duplicates()->isNotEmpty()) {
            throw new \InvalidArgumentException('Duplicate ledger account detected. Use each ledger account only once per voucher.');
        }
    }

    private function auditVoucherDateChange(AccVoucher $voucher, ?string $oldDate, string $newDate, Request $request, ?string $financialYearId): void
    {
        if (!$oldDate || $oldDate === $newDate || !Schema::hasTable('audit_log')) return;

        try {
            $row = [
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'user_id' => $request->user()?->id,
                'user_name' => $request->user()?->name ?? $request->user()?->username ?? 'System',
                'module' => 'accounting_vouchers',
                'action' => 'voucher_date_changed',
                'record_id' => $voucher->id,
                'details' => "Voucher {$voucher->voucher_number} date changed from {$oldDate} to {$newDate}",
                'ip_address' => $request->ip(),
                'created_at' => now(),
            ];

            if (Schema::hasColumn('audit_log', 'old_data')) {
                $row['old_data'] = json_encode(['voucher_date' => $oldDate]);
            }
            if (Schema::hasColumn('audit_log', 'new_data')) {
                $row['new_data'] = json_encode(['voucher_date' => $newDate, 'financial_year_id' => $financialYearId]);
            }
            if (Schema::hasColumn('audit_log', 'user_agent')) {
                $row['user_agent'] = substr((string) $request->userAgent(), 0, 1000);
            }

            DB::table('audit_log')->insert($row);
        } catch (\Throwable $e) {
            \Log::warning('Voucher date audit log insert failed', [
                'voucher_id' => $voucher->id,
                'old_date' => $oldDate,
                'new_date' => $newDate,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function index(Request $request)
    {
        $filters = $request->all();
        $type = collect(explode('/', trim($request->path(), '/')))->last();
        if (in_array($type, ['journal', 'payment', 'receipt', 'contra'], true)) {
            $filters['voucher_type'] = $type;
        }
        // Branch scoping — BranchScope middleware injects allowed_branch_ids
        // for non Super Admin users. Forward it to the repository so the
        // listing only contains vouchers from branches the user can access.
        $allowed = $request->input('allowed_branch_ids');
        if (is_array($allowed) && count($allowed) > 0) {
            $filters['allowed_branch_ids'] = $allowed;
        }
        // Reasonable default page size; UI can override per_page for "all" view.
        if (empty($filters['per_page'])) {
            $filters['per_page'] = 50;
        }
        $paginator = $this->repo->all($filters);
        $paginator->getCollection()->transform(function ($voucher) {
            $voucher->ledger_accounts = $voucher->entries
                ->map(fn ($entry) => optional($entry->account)->account_name)
                ->filter()
                ->unique()
                ->values()
                ->all();
            return $voucher;
        });
        return $this->paginated($paginator);
    }

    public function store(Request $request)
    {
        // Correlation id so client + server logs can be tied together for fast root-cause.
        $cid = (string) \Illuminate\Support\Str::uuid();
        $this->normalizeVoucherDateInput($request);

        // Infer voucher_type from URL when the client omits it (e.g. POST /vouchers/journal).
        if (!$request->filled('voucher_type')) {
            $segments = collect(explode('/', trim($request->path(), '/')));
            $last = $segments->last();
            if (in_array($last, ['journal', 'payment', 'receipt', 'contra'], true)) {
                $request->merge(['voucher_type' => $last]);
            }
        }

        // Drop empty/sentinel branch_id at the request level so validation + payload both see null.
        $branchIn = $request->input('branch_id');
        if ($branchIn === '' || $branchIn === 'null' || $branchIn === 'undefined') {
            $request->request->remove('branch_id');
            $request->offsetUnset('branch_id');
        }

        // Normalise entries: coerce numeric strings, default missing debit/credit to 0,
        // drop blank rows (no account, or both sides zero), and ensure narration is a string.
        $rawEntries = $request->input('entries', []);
        if (is_array($rawEntries)) {
            $normalised = [];
            foreach ($rawEntries as $row) {
                if (!is_array($row)) continue;
                $accountId = $row['account_id'] ?? null;
                if (!$accountId) continue;
                $debit = (float) ($row['debit'] ?? 0);
                $credit = (float) ($row['credit'] ?? 0);
                if ($debit == 0.0 && $credit == 0.0) continue;
                $normalised[] = [
                    'account_id' => $accountId,
                    'debit' => $debit,
                    'credit' => $credit,
                    'narration' => (string) ($row['narration'] ?? ''),
                ];
            }
            $request->merge(['entries' => $normalised]);
        }

        $request->validate([
            'voucher_type' => 'required|in:journal,payment,receipt,contra',
            'voucher_date' => 'required|date',
            'branch_id' => 'nullable|exists:branches,id',
            'entries' => 'required|array|min:2',
            'entries.*.account_id' => 'required|exists:chart_of_accounts,id',
            'entries.*.debit' => 'numeric|min:0',
            'entries.*.credit' => 'numeric|min:0',
        ]);
        $this->assertUniqueLedgerAccounts($request->input('entries', []));

        try {
            // Reject if the client explicitly picked an inactive Financial Year.
            $requestedFyId = $request->input('financial_year_id');
            if ($requestedFyId) {
                $requestedFy = DB::table('financial_years')->where('id', $requestedFyId)->first();
                if ($requestedFy && (int) $requestedFy->is_active !== 1) {
                    $this->audit->log(
                        'accounting', 'reject_inactive_fy', null,
                        "Blocked voucher post: FY {$requestedFy->name} is inactive",
                        $request, null,
                        ['financial_year_id' => $requestedFyId, 'financial_year_name' => $requestedFy->name, 'voucher_type' => $request->input('voucher_type'), 'voucher_date' => $request->input('voucher_date')]
                    );
                    throw new \RuntimeException("Selected Financial Year '{$requestedFy->name}' is inactive. Activate it in Settings → Financial Years or pick an active one.");
                }
            }

            // Resolve financial_year_id from the voucher date every time. This
            // prevents stale UI selections (for example FY 2025-2026 with a
            // 2026-07-02 voucher date) from causing hidden DB/server errors.
            $payload = $request->only('voucher_type', 'voucher_date', 'description', 'branch_id', 'financial_year_id');
            $payload['financial_year_id'] = $this->period->resolveOrCreateId($request->voucher_date);
            if (array_key_exists('branch_id', $payload) && ($payload['branch_id'] === '' || $payload['branch_id'] === null)) {
                unset($payload['branch_id']);
            }
            $payload['created_by'] = $request->user()?->id;


            $voucher = $this->service->createVoucher(
                $payload,
                $request->entries,
                true // approval system removed — auto-post directly to accounts
            );

            return $this->created($voucher);
        } catch (\InvalidArgumentException | \RuntimeException $e) {
            \Log::warning('Voucher store rejected', [
                'cid' => $cid,
                'voucher_type' => $request->input('voucher_type'),
                'user_id' => optional($request->user())->id,
                'reason' => $e->getMessage(),
            ]);
            return $this->error($e->getMessage(), 422, ['correlation_id' => $cid]);
        } catch (\Illuminate\Database\QueryException $e) {
            \Log::error('Voucher store DB error', [
                'cid' => $cid,
                'voucher_type' => $request->input('voucher_type'),
                'user_id' => optional($request->user())->id,
                'sql_state' => $e->getCode(),
                'error' => $e->getMessage(),
            ]);
            // FK / not-null / unique → user-actionable 422 with correlation id.
            return $this->error('Could not save voucher (data error). Ref: ' . $cid, 422, ['correlation_id' => $cid]);
        } catch (\Throwable $e) {
            \Log::error('Voucher store failed', [
                'cid' => $cid,
                'voucher_type' => $request->input('voucher_type'),
                'user_id' => optional($request->user())->id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            return $this->error('Could not save voucher. Ref: ' . $cid, 500, ['correlation_id' => $cid]);
        }
    }

    public function show(string $id) { return $this->success($this->repo->findWithEntries($id)); }

    public function update(Request $request, string $id)
    {
        $cid = (string) \Illuminate\Support\Str::uuid();
        $this->normalizeVoucherDateInput($request);
        $voucher = AccVoucher::findOrFail($id);
        $user = $request->user();
        $auth = \App\Support\VoucherPermissions::authorize($user, $voucher->voucher_type, 'edit', $voucher->id, $request);
        if (!$auth['allowed']) {
            return $this->error(
                'You do not have permission to edit this voucher.',
                403,
                ['correlation_id' => $auth['correlation_id'], 'required_any_of' => $auth['candidates']]
            );
        }
        // Approval system removed — vouchers are always editable by users with accounts.edit.

        // Concurrent edit guard: client must echo back the row's last `updated_at`.
        $expected = $request->input('expected_updated_at');
        if ($expected && (string) $voucher->updated_at !== (string) $expected) {
            return $this->error(
                'This voucher was modified by another user. Refresh and try again.',
                409
            );
        }

        try {
            $data = $request->validate([
                'voucher_date' => 'required|date',
                'branch_id' => 'nullable|exists:branches,id',
                'financial_year_id' => 'nullable|exists:financial_years,id',
                'description' => 'nullable|string',
                'submit' => 'boolean',
                'entries' => 'required|array|min:2',
                'entries.*.account_id' => 'required|exists:chart_of_accounts,id',
                'entries.*.debit' => 'numeric|min:0',
                'entries.*.credit' => 'numeric|min:0',
                'entries.*.narration' => 'nullable|string',
            ]);
            $this->assertUniqueLedgerAccounts($data['entries']);

            // Always resolve from the submitted voucher_date. If the next FY
            // does not exist yet, create it once; if it exists but is inactive,
            // return a clear 422 instead of silently keeping the old date.
            $resolvedFinancialYearId = $this->period->resolveOrCreateId($data['voucher_date']);

            $totalDebit = collect($data['entries'])->sum('debit');
            $totalCredit = collect($data['entries'])->sum('credit');
            if (abs($totalDebit - $totalCredit) > 0.01) {
                return $this->error('Debit and Credit must be equal', 422, ['correlation_id' => $cid]);
            }

            return DB::transaction(function () use ($voucher, $data, $totalDebit, $request, $resolvedFinancialYearId) {
                $oldDate = $voucher->voucher_date instanceof \DateTimeInterface ? $voucher->voucher_date->format('Y-m-d') : (string) $voucher->voucher_date;
                $voucher->update([
                    'voucher_date' => $data['voucher_date'],
                    'branch_id' => $data['branch_id'] ?? null,
                    'financial_year_id' => $resolvedFinancialYearId,
                    'description' => $data['description'] ?? '',
                    'total_amount' => $totalDebit,
                    'status' => 'approved',
                    'approved_by' => $voucher->approved_by ?? $request->user()->id,
                    'approved_at' => $voucher->approved_at ?? now(),
                ]);
                VoucherEntry::where('voucher_id', $voucher->id)->delete();
                foreach ($data['entries'] as $i => $entry) {
                    VoucherEntry::create([
                        'voucher_id' => $voucher->id,
                        'account_id' => $entry['account_id'],
                        'debit' => $entry['debit'] ?? 0,
                        'credit' => $entry['credit'] ?? 0,
                        'narration' => $entry['narration'] ?? '',
                        'sort_order' => $i,
                    ]);
                }
                $this->auditVoucherDateChange($voucher, $oldDate, $data['voucher_date'], $request, $resolvedFinancialYearId);
                return $this->success($this->repo->findWithEntries($voucher->id));
            });
        } catch (\Illuminate\Validation\ValidationException $e) {
            throw $e;
        } catch (\InvalidArgumentException | \RuntimeException $e) {
            \Log::warning('Voucher update rejected', ['cid' => $cid, 'voucher_id' => $id, 'user_id' => optional($request->user())->id, 'reason' => $e->getMessage()]);
            return $this->error($e->getMessage(), 422, ['correlation_id' => $cid]);
        } catch (\Throwable $e) {
            \Log::error('Voucher update failed', ['cid' => $cid, 'voucher_id' => $id, 'user_id' => optional($request->user())->id, 'error' => $e->getMessage()]);
            return $this->error('Could not update voucher. Ref: ' . $cid, 500, ['correlation_id' => $cid]);
        }
    }

    public function approve(Request $request, string $id)
    {
        $note = $request->input('note');
        return $this->success($this->service->approveVoucher($id, $request->user()->id, $note));
    }

    public function reject(Request $request, string $id)
    {
        $note = $request->input('note');
        return $this->success($this->service->rejectVoucher($id, $request->user()?->id, $note));
    }

    /**
     * GET /v1/vouchers/pending — vouchers awaiting approval.
     */
    public function pending(Request $request)
    {
        $q = AccVoucher::where('status', 'pending');
        if ($type = $request->input('voucher_type')) $q->where('voucher_type', $type);
        if ($branch = $request->input('branch_id')) $q->where('branch_id', $branch);
        $rows = $q->orderBy('voucher_date', 'desc')->paginate($request->input('per_page', 50));
        return $this->paginated($rows);
    }

    /**
     * GET /v1/vouchers/{id}/approval-history
     */
    public function approvalHistory(string $id)
    {
        $rows = \App\Models\VoucherApprovalHistory::where('voucher_id', $id)
            ->orderBy('created_at', 'desc')->get();
        return $this->success($rows);
    }

    public function editApproved(Request $request, string $id)
    {
        $cid = (string) \Illuminate\Support\Str::uuid();
        $this->normalizeVoucherDateInput($request);
        if (!$request->user()->isSuperAdmin()) return $this->error('Only Super Admin can edit approved vouchers', 403);
        $voucher = AccVoucher::findOrFail($id);
        if ($voucher->status !== 'approved') return $this->error('Voucher is not approved', 422);

        $data = $request->validate([
            'voucher_date' => 'nullable|date',
            'branch_id' => 'nullable|exists:branches,id',
            'financial_year_id' => 'nullable|exists:financial_years,id',
            'description' => 'nullable|string',
            'entries' => 'nullable|array|min:2',
            'entries.*.account_id' => 'required_with:entries|exists:chart_of_accounts,id',
            'entries.*.debit' => 'numeric|min:0',
            'entries.*.credit' => 'numeric|min:0',
            'entries.*.narration' => 'nullable|string',
        ]);

        try {
            if (!empty($data['entries'])) {
                $this->assertUniqueLedgerAccounts($data['entries']);
            }
            $resolvedFinancialYearId = null;
            if (!empty($data['voucher_date'])) {
                $resolvedFinancialYearId = $this->period->resolveOrCreateId($data['voucher_date']);
            }

        return DB::transaction(function () use ($voucher, $data, $resolvedFinancialYearId, $request) {
            $oldDate = $voucher->voucher_date instanceof \DateTimeInterface ? $voucher->voucher_date->format('Y-m-d') : (string) $voucher->voucher_date;
            if (array_key_exists('voucher_date', $data)) $voucher->voucher_date = $data['voucher_date'];
            if (array_key_exists('branch_id', $data)) $voucher->branch_id = $data['branch_id'] ?: null;
            if (array_key_exists('voucher_date', $data)) $voucher->financial_year_id = $resolvedFinancialYearId;
            elseif (array_key_exists('financial_year_id', $data)) $voucher->financial_year_id = $data['financial_year_id'] ?: null;
            if (array_key_exists('description', $data)) $voucher->description = $data['description'] ?? '';
            if (!empty($data['entries'])) {
                $totalDebit = collect($data['entries'])->sum('debit');
                $totalCredit = collect($data['entries'])->sum('credit');
                if (abs($totalDebit - $totalCredit) > 0.01) return $this->error('Debit and Credit must be equal', 422);
                $voucher->total_amount = $totalDebit;
                VoucherEntry::where('voucher_id', $voucher->id)->delete();
                foreach ($data['entries'] as $i => $entry) {
                    VoucherEntry::create([
                        'voucher_id' => $voucher->id,
                        'account_id' => $entry['account_id'],
                        'debit' => $entry['debit'] ?? 0,
                        'credit' => $entry['credit'] ?? 0,
                        'narration' => $entry['narration'] ?? '',
                        'sort_order' => $i,
                    ]);
                }
            }
            $voucher->save();
            if (array_key_exists('voucher_date', $data)) {
                $this->auditVoucherDateChange($voucher, $oldDate, $data['voucher_date'], $request, $resolvedFinancialYearId);
            }
            return $this->success($this->repo->findWithEntries($voucher->id));
        });
        } catch (\InvalidArgumentException | \RuntimeException $e) {
            \Log::warning('Approved voucher edit rejected', ['cid' => $cid, 'voucher_id' => $id, 'user_id' => optional($request->user())->id, 'reason' => $e->getMessage()]);
            return $this->error($e->getMessage(), 422, ['correlation_id' => $cid]);
        } catch (\Throwable $e) {
            \Log::error('Approved voucher edit failed', ['cid' => $cid, 'voucher_id' => $id, 'user_id' => optional($request->user())->id, 'error' => $e->getMessage()]);
            return $this->error('Could not update approved voucher. Ref: ' . $cid, 500, ['correlation_id' => $cid]);
        }
    }

    public function deleteApproved(Request $request, string $id)
    {
        $voucher = AccVoucher::findOrFail($id);
        $user = $request->user();
        // Route middleware can only check broad OR candidates because the
        // voucher type is not known until this controller loads the row.
        // Re-check the exact voucher type here so `journal.delete` cannot
        // accidentally delete a payment/receipt/contra voucher, while
        // `accounts.delete` / `vouchers.delete` still work as umbrella grants.
        $auth = VoucherPermissions::authorize($user, $voucher->voucher_type, 'delete', $voucher->id, $request);
        if (!$auth['allowed']) {
            return $this->error('You do not have permission to delete this voucher.', 403, [
                'correlation_id' => $auth['correlation_id'],
                'required_any_of' => $auth['candidates'],
            ]);
        }
        if ($voucher->deleted_at) {
            return $this->error('Voucher already deleted', 422);
        }
        $actorRoles = VoucherPermissions::actorRoleNames($user);
        $deletedAt = now();
        $oldData = [
            'voucher_id' => $voucher->id,
            'voucher_number' => $voucher->voucher_number,
            'voucher_type' => $voucher->voucher_type,
            'voucher_date' => (string) $voucher->voucher_date,
            'total_amount' => (float) $voucher->total_amount,
            'status' => $voucher->status,
            'deleted_at' => $voucher->deleted_at,
        ];
        $voucher->update([
            'prev_status' => $voucher->status,
            'status'      => 'deleted',
            'deleted_at'  => $deletedAt,
            'deleted_by'  => $user->id,
        ]);

        $this->audit->log(
            'accounting_vouchers',
            'voucher_soft_deleted',
            $voucher->id,
            'Voucher deleted by ' . ($user->name ?? $user->email ?? $user->id) .
                ' with roles [' . implode(', ', $actorRoles) . '] at ' . $deletedAt->toIso8601String() .
                '. Affected voucher: ' . $voucher->voucher_number . ' (' . $voucher->voucher_type . '), amount ' . $voucher->total_amount .
                '. Reason: ' . ($request->input('reason') ?: 'No reason provided'),
            $request,
            $oldData,
            [
                'voucher_id' => $voucher->id,
                'voucher_number' => $voucher->voucher_number,
                'voucher_type' => $voucher->voucher_type,
                'status' => 'deleted',
                'prev_status' => $oldData['status'],
                'deleted_at' => $deletedAt->toIso8601String(),
                'deleted_by' => $user->id,
                'actor_roles' => $actorRoles,
                'reason' => $request->input('reason') ?: null,
            ]
        );
        return $this->success(['deleted' => true, 'id' => $voucher->id]);
    }

    public function restore(Request $request, string $id)
    {
        $user = $request->user();
        // Permission enforced by route middleware (permission:accounts.edit).
        $voucher = AccVoucher::findOrFail($id);
        if (!$voucher->deleted_at) {
            return $this->error('Voucher is not deleted', 422);
        }
        $restored = $voucher->prev_status ?: 'draft';
        $voucher->update([
            'status'      => $restored,
            'prev_status' => null,
            'deleted_at'  => null,
            'deleted_by'  => null,
        ]);
        return $this->success(['restored' => true, 'status' => $restored]);
    }

    public function reopen(Request $request, string $id)
    {
        if (!$request->user()->isSuperAdmin()) return $this->error('Only Super Admin can reopen vouchers', 403);
        $voucher = AccVoucher::findOrFail($id);
        if (!in_array($voucher->status, ['approved', 'rejected'], true)) return $this->error('Only approved or rejected vouchers can be reopened', 422);
        $voucher->update(['status' => 'draft', 'approved_by' => null, 'approved_at' => null]);
        return $this->success($voucher->fresh());
    }

    public function reverse(Request $request, string $id)
    {
        if (!$request->user()->isSuperAdmin()) return $this->error('Only Super Admin can reverse vouchers', 403);
        $voucher = $this->repo->findWithEntries($id);
        if ($voucher->status !== 'approved') return $this->error('Only approved vouchers can be reversed', 422);
        $reversal = $this->service->createVoucher([
            'voucher_type' => $voucher->voucher_type,
            'voucher_date' => now()->toDateString(),
            'description' => 'Reversal of ' . $voucher->voucher_number . ': ' . ($request->input('reason') ?? ''),
            'branch_id' => $voucher->branch_id,
            'financial_year_id' => $voucher->financial_year_id,
            'created_by' => $request->user()->id,
        ], $voucher->entries->map(fn ($entry) => [
            'account_id' => $entry->account_id,
            'debit' => $entry->credit,
            'credit' => $entry->debit,
            'narration' => 'Reversal: ' . ($entry->narration ?? ''),
        ])->all(), true);
        return $this->success($reversal->load('entries'));
    }

    /** Permanently delete a soft-deleted voucher (Super Admin only). */
    public function purge(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user->isSuperAdmin()) {
            return $this->error('Only Super Admin can permanently delete vouchers', 403);
        }
        $voucher = AccVoucher::findOrFail($id);
        if (!$voucher->deleted_at) {
            return $this->error('Only soft-deleted vouchers can be permanently deleted', 422);
        }
        return \DB::transaction(function () use ($voucher) {
            $voucher->entries()->delete();
            $vid = $voucher->id;
            $voucher->delete();
            return $this->success(['purged' => true, 'id' => $vid]);
        });
    }

    /**
     * Change the type of an existing voucher (e.g. Payment → Journal).
     * The old voucher is soft-deleted with status='transferred', its serial
     * is released to the free-list, and a brand-new voucher of the target
     * type is created with the same entries. Auto-posted vouchers (from
     * Sales/Purchase modules) are blocked.
     */
    public function changeType(Request $request, string $id)
    {
        $data = $request->validate([
            'new_type' => 'required|in:journal,payment,receipt,contra',
            'reason'   => 'nullable|string|max:1000',
        ]);

        $voucher = AccVoucher::findOrFail($id);
        $user    = $request->user();

        // Require edit on source type AND create on target type.
        $srcAuth = \App\Support\VoucherPermissions::authorize($user, $voucher->voucher_type, 'edit', $voucher->id, $request);
        if (!$srcAuth['allowed']) {
            return $this->error('You do not have permission to change this voucher.', 403, [
                'correlation_id' => $srcAuth['correlation_id'],
                'required_any_of' => $srcAuth['candidates'],
            ]);
        }
        $dstAuth = \App\Support\VoucherPermissions::authorize($user, $data['new_type'], 'create', null, $request);
        if (!$dstAuth['allowed']) {
            return $this->error('You do not have permission to create the target voucher type.', 403, [
                'correlation_id' => $dstAuth['correlation_id'],
                'required_any_of' => $dstAuth['candidates'],
            ]);
        }

        // Period lock applies to both original and new (same) date.
        try {
            $this->period->assertOpen($voucher->voucher_date, 'voucher transfer');
        } catch (\Throwable $e) {
            return $this->error($e->getMessage(), 422);
        }

        try {
            $new = $this->service->changeVoucherType($id, $data['new_type'], $user->id, $data['reason'] ?? null);
            return $this->success([
                'new_voucher'      => $new,
                'released_number'  => $voucher->voucher_number,
                'released_type'    => $voucher->voucher_type,
            ]);
        } catch (\InvalidArgumentException | \RuntimeException $e) {
            return $this->error($e->getMessage(), 422);
        }
    }
}

