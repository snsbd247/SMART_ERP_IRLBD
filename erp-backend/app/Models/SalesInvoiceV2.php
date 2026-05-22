<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class SalesInvoiceV2 extends Model
{
    use HasUuids, SoftDeletes;
    protected $table = 'sales_invoices_v2';
    protected $fillable = ['invoice_number','invoice_date','customer_id','mode','subtotal','vat_total','grand_total','paid_amount','tds_amount','due_amount','status','voucher_id','notes','branch_id','financial_year_id','created_by'];
    protected $casts = ['invoice_date' => 'date'];

    public function items() { return $this->hasMany(SalesInvoiceItemV2::class, 'invoice_id'); }
    public function challans() { return $this->belongsToMany(VatChallan::class, 'invoice_challans', 'invoice_id', 'vat_challan_id'); }
    public function payments() { return $this->hasMany(InvoicePayment::class, 'invoice_id'); }
    public function tdsEntries() { return $this->hasMany(TdsEntry::class, 'invoice_id'); }
    public function customer() { return $this->belongsTo(Customer::class); }
    public function voucher() { return $this->belongsTo(AccVoucher::class, 'voucher_id'); }
    public function statusLogs() { return $this->hasMany(InvoiceStatusLog::class, 'invoice_id'); }
}
