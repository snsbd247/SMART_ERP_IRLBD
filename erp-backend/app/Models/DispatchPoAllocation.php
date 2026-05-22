<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DispatchPoAllocation extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['dispatch_item_id','po_item_id','po_id','allocated_qty'];

    public function dispatchItem() { return $this->belongsTo(DispatchItem::class); }
    public function poItem() { return $this->belongsTo(PurchaseOrderItem::class, 'po_item_id'); }
    public function po() { return $this->belongsTo(PurchaseOrder::class, 'po_id'); }
}
