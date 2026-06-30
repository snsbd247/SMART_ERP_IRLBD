<?php

namespace App\Repositories;

use App\Models\AccVoucher;
use Illuminate\Database\Eloquent\Builder;

class VoucherRepository extends BaseRepository
{
    public function __construct(AccVoucher $model) { parent::__construct($model); }

    public function all(array $filters = [], int $perPage = 25)
    {
        $query = $this->model->newQuery()->with('entries.account');
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
        $term = '%' . str_replace(['%', '_'], ['\\%', '\\_'], trim($search)) . '%';
        return $query->where(function (Builder $q) use ($term) {
            $q->where('voucher_number', 'like', $term)
              ->orWhere('description', 'like', $term);
        });
    }

    public function findWithEntries(string $id)
    {
        return AccVoucher::with(['entries.account', 'branch', 'creator', 'approver'])->findOrFail($id);
    }
}
