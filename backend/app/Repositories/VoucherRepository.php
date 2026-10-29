<?php

namespace App\Repositories;

use App\Models\AccVoucher;
use Illuminate\Database\Eloquent\Builder;

class VoucherRepository extends BaseRepository
{
    public function __construct(AccVoucher $model) { parent::__construct($model); }

    public function all(array $filters = [], int $perPage = 25)
    {
        // Eager-load creator so voucher lists can show "Entered By" without
        // an N+1 fan-out. Guard against missing users table columns by
        // selecting a minimal, stable subset.
        $query = $this->model->newQuery()->with(['entries.account', 'creator:id,name,username']);
        $query = $this->applyFilters($query, $filters);
        return $query->orderBy($filters['sort'] ?? 'created_at', $filters['order'] ?? 'desc')
            ->paginate($filters['per_page'] ?? $perPage);
    }

    protected function applyFilters(Builder $query, array $filters): Builder
    {
        $query = parent::applyFilters($query, $filters);
        if (!empty($filters['voucher_type'])) {
            $query->where('voucher_type', $filters['voucher_type']);
        }
        if (!empty($filters['from'])) {
            $query->where('voucher_date', '>=', $filters['from']);
        }
        if (!empty($filters['to'])) {
            $query->where('voucher_date', '<=', $filters['to']);
        }
        if (!empty($filters['created_by'])) {
            $query->where('created_by', $filters['created_by']);
        }
        // Branch scoping — restrict to user's allowed branches when present.
        if (!empty($filters['allowed_branch_ids']) && is_array($filters['allowed_branch_ids'])) {
            $query->whereIn('branch_id', $filters['allowed_branch_ids']);
        }
        // Soft-deleted vouchers are hidden by default. Pass include_deleted=1
        // (or only_deleted=1 for the trash view) to retrieve them.
        if (!empty($filters['only_deleted'])) {
            $query->whereNotNull('deleted_at');
        } elseif (empty($filters['include_deleted'])) {
            $query->whereNull('deleted_at');
        }
        return $query;
    }

    protected function applySearch(Builder $query, string $search): Builder
    {
        $raw = trim($search);
        $term = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $raw) . '%';
        // Extract a numeric amount if the search string looks like a number
        // (supports "1,000.50" and "1000.5"). Matches against total_amount.
        $numeric = null;
        $numClean = str_replace(',', '', $raw);
        if (is_numeric($numClean)) {
            $numeric = (float) $numClean;
        }
        return $query->where(function (Builder $q) use ($term, $numeric) {
            $q->where('voucher_number', 'like', $term)
              ->orWhere('description', 'like', $term)
              // Ledger name / code via voucher_entries → chart_of_accounts
              ->orWhereHas('entries.account', function (Builder $a) use ($term) {
                  $a->where('account_name', 'like', $term)
                    ->orWhere('account_code', 'like', $term);
              });
            if ($numeric !== null) {
                // Exact amount match, plus per-entry debit/credit amount match.
                $q->orWhere('total_amount', $numeric)
                  ->orWhereHas('entries', function (Builder $e) use ($numeric) {
                      $e->where('debit', $numeric)->orWhere('credit', $numeric);
                  });
            }
        });
    }

    public function findWithEntries(string $id)
    {
        return AccVoucher::with(['entries.account', 'branch', 'creator', 'approver'])->findOrFail($id);
    }
}
