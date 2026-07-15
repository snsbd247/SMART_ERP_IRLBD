<?php

namespace App\Services;

use App\Models\AccVoucher;
use App\Models\VoucherEntry;
use App\Repositories\AccountRepository;
use Illuminate\Support\Facades\DB;

class AccountingService
{
    public function __construct(
        private AccountRepository $accountRepo,
        private NumberSequenceService $seqService,
    ) {}

    /**
     * Create and optionally auto-approve an accounting voucher with balanced entries.
     */
    public function createVoucher(array $data, array $entries, bool $autoApprove = true): AccVoucher
    {
        // Validate balanced
        $totalDebit = collect($entries)->sum('debit');
        $totalCredit = collect($entries)->sum('credit');
        if (abs($totalDebit - $totalCredit) > 0.01) {
            throw new \InvalidArgumentException("Entries not balanced: D={$totalDebit} C={$totalCredit}");
        }
        $this->assertUniqueLedgerAccounts($entries);

        $seqMap = ['journal' => 'journal_voucher', 'payment' => 'payment_voucher', 'receipt' => 'receipt_voucher', 'contra' => 'contra_voucher'];
        $seqId = $seqMap[$data['voucher_type']] ?? throw new \InvalidArgumentException("Unknown type: {$data['voucher_type']}");

        return DB::transaction(function () use ($data, $entries, $autoApprove, $seqId, $totalDebit) {
            $voucherNumber = $this->seqService->next($seqId);

            $voucher = AccVoucher::create([
                'voucher_number' => $voucherNumber,
                'voucher_type' => $data['voucher_type'],
                'voucher_date' => $data['voucher_date'],
                'description' => $data['description'] ?? '',
                'total_amount' => $totalDebit,
                'status' => $autoApprove ? 'approved' : 'draft',
                'branch_id' => $data['branch_id'] ?? null,
                'financial_year_id' => $data['financial_year_id'] ?? null,
                'created_by' => $data['created_by'] ?? null,
                'approved_by' => $autoApprove ? ($data['created_by'] ?? null) : null,
                'approved_at' => $autoApprove ? now() : null,
                'source_module' => $data['source_module'] ?? null,
                'transferred_from_id' => $data['transferred_from_id'] ?? null,
            ]);


            foreach ($entries as $idx => $entry) {
                VoucherEntry::create([
                    'voucher_id' => $voucher->id,
                    'account_id' => $entry['account_id'],
                    'debit' => $entry['debit'] ?? 0,
                    'credit' => $entry['credit'] ?? 0,
                    'narration' => $entry['narration'] ?? '',
                    'sort_order' => $idx,
                ]);
            }

            return $voucher->load('entries');
        });
    }

    /**
     * Auto-post a double-entry voucher from another module (e.g., Sales, Purchase).
     */
    public function autoPost(string $debitAccountName, string $creditAccountName, float $amount, string $description, string $voucherType, array $ctx): ?AccVoucher
    {
        $debitAcct = $this->accountRepo->findByName($debitAccountName);
        $creditAcct = $this->accountRepo->findByName($creditAccountName);

        if (!$debitAcct || !$creditAcct) {
            \Log::warning("Auto-post skipped: account '{$debitAccountName}' or '{$creditAccountName}' not found");
            return null;
        }

        return $this->createVoucher([
            'voucher_type' => $voucherType,
            'voucher_date' => $ctx['date'],
            'description' => $description,
            'branch_id' => $ctx['branch_id'] ?? null,
            'financial_year_id' => $ctx['financial_year_id'] ?? null,
            'created_by' => $ctx['user_id'] ?? null,
            'source_module' => $ctx['source_module'] ?? 'auto',
        ], [
            ['account_id' => $debitAcct->id, 'debit' => $amount, 'credit' => 0, 'narration' => $description],
            ['account_id' => $creditAcct->id, 'debit' => 0, 'credit' => $amount, 'narration' => $description],
        ], true);
    }

    /**
     * Voucher type change (transfer) — move an existing voucher from one type
     * to another (e.g. Payment → Journal) without losing the original serial.
     *
     * Steps (atomic):
     *   1) Validate: not deleted, not auto-posted (source_module NULL), new type differs.
     *   2) Release old voucher_number to the free-list so the next same-type entry reuses it.
     *   3) Create a new voucher of $newType with identical entries + link back via transferred_from_id.
     *   4) Soft-delete the original voucher, mark status = 'transferred', link forward via transferred_to_id.
     *   5) Record entries in voucher_approval_history + audit_log for full traceability.
     */
    public function changeVoucherType(string $id, string $newType, string $userId, ?string $reason = null): AccVoucher
    {
        $seqMap = ['journal' => 'journal_voucher', 'payment' => 'payment_voucher', 'receipt' => 'receipt_voucher', 'contra' => 'contra_voucher'];
        if (!isset($seqMap[$newType])) {
            throw new \InvalidArgumentException("Invalid target voucher type: {$newType}");
        }

        return DB::transaction(function () use ($id, $newType, $userId, $reason, $seqMap) {
            /** @var AccVoucher $old */
            $old = AccVoucher::with('entries')->lockForUpdate()->findOrFail($id);

            if ($old->deleted_at) {
                throw new \RuntimeException('Deleted vouchers cannot be transferred.');
            }
            if ($old->status === 'transferred') {
                throw new \RuntimeException('Voucher has already been transferred.');
            }
            if (!empty($old->source_module)) {
                throw new \RuntimeException('Auto-posted vouchers (from Sales/Purchase) cannot be transferred.');
            }
            if ($old->voucher_type === $newType) {
                throw new \InvalidArgumentException('Target type is the same as current type.');
            }

            $oldSeqId = $seqMap[$old->voucher_type] ?? null;

            // 1) Release old number so next same-type entry reuses it.
            if ($oldSeqId) {
                $this->seqService->release($oldSeqId, $old->voucher_number, $userId);
            }

            // 2) Create the new voucher with identical entries.
            $entries = $old->entries->map(fn ($e) => [
                'account_id' => $e->account_id,
                'debit'      => (float) $e->debit,
                'credit'     => (float) $e->credit,
                'narration'  => $e->narration,
            ])->all();

            $new = $this->createVoucher([
                'voucher_type'        => $newType,
                'voucher_date'        => $old->voucher_date instanceof \DateTimeInterface ? $old->voucher_date->format('Y-m-d') : (string) $old->voucher_date,
                'description'         => $old->description,
                'branch_id'           => $old->branch_id,
                'financial_year_id'   => $old->financial_year_id,
                'created_by'          => $userId,
                'transferred_from_id' => $old->id,
            ], $entries, in_array($old->status, ['approved', 'posted'], true));

            // 3) Soft-delete original + status='transferred' + forward link.
            $old->update([
                'prev_status'        => $old->status,
                'status'             => 'transferred',
                'deleted_at'         => now(),
                'deleted_by'         => $userId,
                'transferred_to_id'  => $new->id,
                'transfer_reason'    => $reason,
            ]);

            // 4) Audit trail.
            $actor = \App\Models\User::find($userId);
            \App\Models\VoucherApprovalHistory::create([
                'voucher_id'    => $old->id,
                'actor_user_id' => $userId,
                'actor_name'    => $actor?->name,
                'action'        => 'change_type',
                'before_status' => $old->prev_status,
                'after_status'  => 'transferred',
                'note'          => trim(($reason ?? '') . " → new: {$new->voucher_number} ({$newType})"),
                'created_at'    => now(),
            ]);
            \App\Models\AuditLog::create([
                'user_id'   => $userId,
                'user_name' => $actor?->name ?? 'System',
                'module'    => 'accounting_vouchers',
                'action'    => 'voucher_type_changed',
                'record_id' => $old->id,
                'details'   => "Voucher {$old->voucher_number} ({$old->voucher_type}) transferred to {$new->voucher_number} ({$newType}). Reason: " . ($reason ?: '(none)'),
                'old_data'  => ['type' => $old->voucher_type, 'number' => $old->voucher_number, 'status' => $old->prev_status],
                'new_data'  => ['type' => $newType, 'number' => $new->voucher_number, 'transferred_from' => $old->id],
            ]);

            return $new->fresh('entries');
        });
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


    public function approveVoucher(string $id, string $userId, ?string $note = null): AccVoucher
    {
        $voucher = AccVoucher::findOrFail($id);
        if ($voucher->status === 'approved') throw new \RuntimeException('Already approved');
        $before = $voucher->status;
        $voucher->update(['status' => 'approved', 'approved_by' => $userId, 'approved_at' => now()]);
        $this->recordApprovalHistory($voucher, $userId, 'approve', $before, 'approved', $note);
        return $voucher;
    }

    public function rejectVoucher(string $id, ?string $userId = null, ?string $note = null): AccVoucher
    {
        $voucher = AccVoucher::findOrFail($id);
        $before = $voucher->status;
        $voucher->update(['status' => 'rejected']);
        $this->recordApprovalHistory($voucher, $userId, 'reject', $before, 'rejected', $note);
        return $voucher;
    }

    /**
     * Write a row to voucher_approval_history AND mirror to audit_log.
     */
    protected function recordApprovalHistory(AccVoucher $voucher, ?string $userId, string $action, ?string $before, ?string $after, ?string $note): void
    {
        $actor = $userId ? \App\Models\User::find($userId) : null;
        \App\Models\VoucherApprovalHistory::create([
            'voucher_id' => $voucher->id,
            'actor_user_id' => $userId,
            'actor_name' => $actor?->name,
            'action' => $action,
            'before_status' => $before,
            'after_status' => $after,
            'note' => $note,
            'created_at' => now(),
        ]);
        \App\Models\AuditLog::create([
            'user_id' => $userId,
            'user_name' => $actor?->name ?? 'System',
            'module' => 'vouchers',
            'action' => $action,
            'record_id' => $voucher->id,
            'details' => trim(($voucher->voucher_number ?? $voucher->id) . ': ' . $before . ' → ' . $after . ($note ? " ({$note})" : '')),
            'old_data' => ['status' => $before],
            'new_data' => ['status' => $after, 'note' => $note],
        ]);
    }

    /**
     * Trial Balance: sum debits/credits per account for a period.
     */
    public function trialBalance(string $from, string $to, ?string $branchId = null): array
    {
        $query = VoucherEntry::query()
            ->selectRaw('account_id, SUM(debit) as total_debit, SUM(credit) as total_credit')
            ->whereHas('voucher', function ($q) use ($from, $to, $branchId) {
                $q->whereBetween('voucher_date', [$from, $to])->where('status', 'approved');
                if ($branchId) $q->where('branch_id', $branchId);
            })
            ->groupBy('account_id')
            ->with('account');

        return $query->get()->map(fn ($e) => [
            'account_id' => $e->account_id,
            'account_code' => $e->account->account_code,
            'account_name' => $e->account->account_name,
            'account_type' => $e->account->account_type,
            'debit' => round($e->total_debit, 2),
            'credit' => round($e->total_credit, 2),
            'balance' => round($e->total_debit - $e->total_credit, 2),
        ])->toArray();
    }
}
