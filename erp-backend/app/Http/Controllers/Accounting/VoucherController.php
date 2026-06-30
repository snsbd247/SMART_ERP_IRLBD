<?php

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\BaseController;
use App\Models\AccVoucher;
use App\Models\VoucherEntry;
use App\Repositories\VoucherRepository;
use App\Services\AccountingService;
use App\Services\FinancialPeriodGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class VoucherController extends BaseController
{
    public function __construct(
        private VoucherRepository $repo,
        private AccountingService $service,
        private FinancialPeriodGuard $period,
    ) {}

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
        // Default to a large page size so the UI sees every voucher of the
        // active type instead of just the first 25.
        if (empty($filters['per_page'])) {
            $filters['per_page'] = 10000;
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

        try {
            // Period close lock — return a friendly 422 instead of a generic 500.
            $this->period->assertOpen($request->voucher_date, 'voucher');

            // Resolve financial_year_id from the voucher date when the client did not send one.
            $payload = $request->only('voucher_type', 'voucher_date', 'description', 'branch_id', 'financial_year_id');
            if (empty($payload['financial_year_id'])) {
                $payload['financial_year_id'] = $this->period->resolveId($request->voucher_date);
            }
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

        // Period close lock — both old and new date must be in an open period.
        $this->period->assertOpen($voucher->voucher_date, 'original voucher date');
        $this->period->assertOpen($data['voucher_date'], 'voucher update');

        $totalDebit = collect($data['entries'])->sum('debit');
        $totalCredit = collect($data['entries'])->sum('credit');
        if (abs($totalDebit - $totalCredit) > 0.01) {
            return $this->error('Debit and Credit must be equal', 422);
        }

        return DB::transaction(function () use ($voucher, $data, $totalDebit, $request) {
            $voucher->update([
                'voucher_date' => $data['voucher_date'],
                'branch_id' => $data['branch_id'] ?? null,
                'financial_year_id' => $data['financial_year_id'] ?? null,
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
            return $this->success($this->repo->findWithEntries($voucher->id));
        });
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
        if (!$request->user()->isSuperAdmin()) return $this->error('Only Super Admin can edit approved vouchers', 403);
        $voucher = AccVoucher::findOrFail($id);
        if ($voucher->status !== 'approved') return $this->error('Voucher is not approved', 422);

        $data = $request->validate([
            'description' => 'nullable|string',
            'entries' => 'nullable|array|min:2',
            'entries.*.account_id' => 'required_with:entries|exists:chart_of_accounts,id',
            'entries.*.debit' => 'numeric|min:0',
            'entries.*.credit' => 'numeric|min:0',
            'entries.*.narration' => 'nullable|string',
        ]);

        return DB::transaction(function () use ($voucher, $data) {
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
            return $this->success($this->repo->findWithEntries($voucher->id));
        });
    }

    public function deleteApproved(Request $request, string $id)
    {
        $voucher = AccVoucher::findOrFail($id);
        $user = $request->user();
        // Soft delete is Super-Admin-only across every status, matching the
        // Supabase edge function behaviour (see supabase/functions/voucher-api).
        if (!$user->isSuperAdmin()) {
            return $this->error('Only Super Admin can delete vouchers', 403);
        }
        if ($voucher->deleted_at) {
            return $this->error('Voucher already deleted', 422);
        }
        $voucher->update([
            'prev_status' => $voucher->status,
            'status'      => 'deleted',
            'deleted_at'  => now(),
            'deleted_by'  => $user->id,
        ]);
        return $this->success(['deleted' => true, 'id' => $voucher->id]);
    }

    public function restore(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user->isSuperAdmin()) {
            return $this->error('Only Super Admin can restore vouchers', 403);
        }
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
}
