<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class TdsEntry extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $table = 'tds_entries';
    protected $fillable = ['invoice_id','payment_id','tds_pct','tds_amount','certificate_no','certificate_date','voucher_id','notes','created_by'];
    protected $casts = ['certificate_date' => 'date', 'created_at' => 'datetime'];

    public function invoice() { return $this->belongsTo(SalesInvoiceV2::class, 'invoice_id'); }
    public function payment() { return $this->belongsTo(InvoicePayment::class, 'payment_id'); }
    public function voucher() { return $this->belongsTo(AccVoucher::class, 'voucher_id'); }
}
