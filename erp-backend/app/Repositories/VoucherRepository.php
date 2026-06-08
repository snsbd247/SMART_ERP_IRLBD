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
        return $query;
    }

    public function findWithEntries(string $id)
    {
        return AccVoucher::with(['entries.account', 'branch', 'creator', 'approver'])->findOrFail($id);
    }
}
