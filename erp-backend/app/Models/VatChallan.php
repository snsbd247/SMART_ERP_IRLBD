<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class VatChallan extends Model
{
    use HasUuids, SoftDeletes;
    protected $fillable = ['challan_number','challan_date','customer_id','dispatch_id','vehicle_no','driver_name','subtotal','vat_amount','grand_total','source','status','attachment_url','notes','branch_id','financial_year_id','created_by'];
    protected $casts = ['challan_date' => 'date'];

    public function items() { return $this->hasMany(VatChallanItem::class); }
    public function dispatch() { return $this->belongsTo(Dispatch::class); }
    public function customer() { return $this->belongsTo(Customer::class); }
    public function deliveryChallans() { return $this->hasMany(DeliveryChallan::class); }
}
