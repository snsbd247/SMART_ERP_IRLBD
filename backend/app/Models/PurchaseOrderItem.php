<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class PurchaseOrderItem extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['po_id','product_id','qty_ordered','qty_delivered','qty_remaining','rate','vat_pct','line_subtotal','line_vat','line_total','sort_order'];

    public function po() { return $this->belongsTo(PurchaseOrder::class, 'po_id'); }
    public function product() { return $this->belongsTo(ItemMaster::class, 'product_id'); }
}
