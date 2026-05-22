<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DeliveryChallan extends Model
{
    use HasUuids;
    protected $fillable = ['dc_number','dc_date','vat_challan_id','vat_challan_item_id','product_id','qty','customer_id','status','attachment_url','branch_id','created_by'];
    protected $casts = ['dc_date' => 'date'];

    public function vatChallan() { return $this->belongsTo(VatChallan::class); }
    public function vatChallanItem() { return $this->belongsTo(VatChallanItem::class, 'vat_challan_item_id'); }
    public function product() { return $this->belongsTo(ItemMaster::class, 'product_id'); }
    public function customer() { return $this->belongsTo(Customer::class); }
    public function customerReceives() { return $this->hasMany(CustomerReceive::class); }
    public function hoReceives() { return $this->hasMany(HoReceive::class); }
}
