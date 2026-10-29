<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class VoucherApprovalHistory extends Model
{
    use HasUuids;

    protected $table = 'voucher_approval_history';
    public $timestamps = false;

    protected $fillable = [
        'voucher_id', 'actor_user_id', 'actor_name',
        'action', 'before_status', 'after_status', 'note', 'created_at',
    ];

    protected $casts = [
        'created_at' => 'datetime',
    ];

    public function voucher() { return $this->belongsTo(AccVoucher::class, 'voucher_id'); }
    public function actor() { return $this->belongsTo(User::class, 'actor_user_id'); }
}
