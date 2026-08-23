<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class AccVoucher extends Model
{
    use HasUuids;
    protected $fillable = [
        'voucher_number', 'voucher_type', 'voucher_date', 'description',
        'total_amount', 'status', 'branch_id', 'financial_year_id',
        'created_by', 'approved_by', 'approved_at',
        'deleted_at', 'deleted_by', 'prev_status',
        'source_module', 'transferred_to_id', 'transferred_from_id', 'transfer_reason',
        'linked_voucher_id',
    ];

    protected $casts = [
        'voucher_date' => 'date',
        'approved_at' => 'datetime',
        'deleted_at' => 'datetime',
    ];

    public function entries() { return $this->hasMany(VoucherEntry::class, 'voucher_id'); }
    public function branch() { return $this->belongsTo(Branch::class); }
    public function financialYear() { return $this->belongsTo(FinancialYear::class); }
    public function creator() { return $this->belongsTo(User::class, 'created_by'); }
    public function approver() { return $this->belongsTo(User::class, 'approved_by'); }
}
