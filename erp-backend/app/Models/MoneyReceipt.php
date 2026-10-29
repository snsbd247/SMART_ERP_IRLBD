<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class MoneyReceipt extends Model
{
    use HasUuids, SoftDeletes;

    protected $fillable = [
        'receipt_no', 'receipt_voucher_id', 'customer_id', 'received_from', 'address',
        'on_account_of', 'on_account_ledger_id', 'payment_mode', 'payment_ref_no', 'receipt_date',
        'against_bill_no', 'against_bill_date', 'amount', 'amount_in_words', 'branch_id',
        'verify_code', 'created_by',
    ];

    protected $casts = [
        'receipt_date' => 'date',
        'against_bill_date' => 'date',
        'amount' => 'decimal:2',
        'deleted_at' => 'datetime',
    ];

    public function receiptVoucher() { return $this->belongsTo(AccVoucher::class, 'receipt_voucher_id'); }
    public function customer() { return $this->belongsTo(Customer::class); }
    public function onAccountLedger() { return $this->belongsTo(ChartOfAccount::class, 'on_account_ledger_id'); }
    public function branch() { return $this->belongsTo(Branch::class); }
    public function creator() { return $this->belongsTo(User::class, 'created_by'); }
}
