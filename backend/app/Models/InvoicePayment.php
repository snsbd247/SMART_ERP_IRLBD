<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class InvoicePayment extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['payment_number','invoice_id','payment_date','mode','amount_received','tds_amount','total_settled','bank_account_id','reference','voucher_id','notes','branch_id','financial_year_id','created_by'];
    protected $casts = ['payment_date' => 'date', 'created_at' => 'datetime'];

    public function invoice() { return $this->belongsTo(SalesInvoiceV2::class, 'invoice_id'); }
    public function voucher() { return $this->belongsTo(AccVoucher::class, 'voucher_id'); }
    public function tds() { return $this->hasOne(TdsEntry::class, 'payment_id'); }
}
