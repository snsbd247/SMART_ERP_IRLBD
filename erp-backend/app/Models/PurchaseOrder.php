<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class PurchaseOrder extends Model
{
    use HasUuids, SoftDeletes;
    protected $fillable = ['po_number','po_date','customer_id','delivery_date','status','subtotal','vat_amount','grand_total','notes','attachment_url','branch_id','financial_year_id','created_by'];
    protected $casts = ['po_date' => 'date', 'delivery_date' => 'date'];

    public function items() { return $this->hasMany(PurchaseOrderItem::class, 'po_id'); }
    public function customer() { return $this->belongsTo(Customer::class); }
    public function amendments() { return $this->hasMany(PoAmendment::class, 'po_id'); }
}
