<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class VatChallanItem extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['vat_challan_id','product_id','purchase_order_item_id','qty','po_qty_consumed','rate','vat_pct','line_subtotal','vat_amount','line_total','sort_order'];

    public function purchaseOrderItem() { return $this->belongsTo(PurchaseOrderItem::class, 'purchase_order_item_id'); }

    public function challan() { return $this->belongsTo(VatChallan::class, 'vat_challan_id'); }
    public function product() { return $this->belongsTo(ItemMaster::class, 'product_id'); }
    public function deliveryChallan() { return $this->hasOne(DeliveryChallan::class, 'vat_challan_item_id'); }
}
