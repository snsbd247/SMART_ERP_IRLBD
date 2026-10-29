<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class VatChallan extends Model
{
    use HasUuids, SoftDeletes;
    protected $fillable = ['challan_number','challan_date','customer_id','purchase_order_id','vehicle_no','driver_name','subtotal','vat_amount','grand_total','source','status','attachment_url','notes','branch_id','financial_year_id','created_by'];

    public function purchaseOrder() { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    protected $casts = ['challan_date' => 'date'];

    public function items() { return $this->hasMany(VatChallanItem::class); }
    public function customer() { return $this->belongsTo(Customer::class); }
    public function deliveryChallans() { return $this->hasMany(DeliveryChallan::class); }
}
