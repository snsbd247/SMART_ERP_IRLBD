<?php

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\BaseController;
use App\Models\AccVoucher;
use App\Models\VoucherEntry;
use App\Repositories\VoucherRepository;
use App\Services\AccountingService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class VoucherController extends BaseController
{
    public function __construct(
        private VoucherRepository $repo,
        private AccountingService $service,
    ) {}

    public function index(Request $request)
    {
        $filters = $request->all();
        $type = collect(explode('/', trim($request->path(), '/')))->last();
        if (in_array($type, ['journal', 'payment', 'receipt', 'contra'], true)) {
            $filters['voucher_type'] = $type;
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
        $request->validate([
            'voucher_type' => 'required|in:journal,payment,receipt,contra',
            'voucher_date' => 'required|date',
            'entries' => 'required|array|min:2',
            'entries.*.account_id' => 'required|exists:chart_of_accounts,id',
            'entries.*.debit' => 'numeric|min:0',
            'entries.*.credit' => 'numeric|min:0',
        ]);

        $voucher = $this->service->createVoucher(
            array_merge($request->only('voucher_type', 'voucher_date', 'description', 'branch_id', 'financial_year_id'), ['created_by' => $request->user()->id]),
            $request->entries
        );
        if ($request->boolean('submit')) {
            $voucher->update(['status' => 'pending']);
            $voucher->refresh();
        }

        return $this->created($voucher);
    }

    public function show(string $id) { return $this->success($this->repo->findWithEntries($id)); }

    public function update(Request $request, string $id)
    {
        $voucher = AccVoucher::findOrFail($id);
        $user = $request->user();
        if (!$user->isSuperAdmin() && !$user->hasPermission($voucher->voucher_type . '.edit')) {
            return $this->error('Forbidden', 403);
        }
        if ($voucher->status === 'approved') {
            return $this->error('Approved vouchers require Super Admin override.', 422);
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

        $totalDebit = collect($data['entries'])->sum('debit');
        $totalCredit = collect($data['entries'])->sum('credit');
        if (abs($totalDebit - $totalCredit) > 0.01) {
            return $this->error('Debit and Credit must be equal', 422);
        }

        return DB::transaction(function () use ($voucher, $data, $totalDebit) {
            $voucher->update([
                'voucher_date' => $data['voucher_date'],
                'branch_id' => $data['branch_id'] ?? null,
                'financial_year_id' => $data['financial_year_id'] ?? null,
                'description' => $data['description'] ?? '',
                'total_amount' => $totalDebit,
                'status' => !empty($data['submit']) ? 'pending' : 'draft',
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
        return $this->success($this->service->approveVoucher($id, $request->user()->id));
    }

    public function reject(string $id)
    {
        return $this->success($this->service->rejectVoucher($id));
    }
}
