<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class SalesInvoiceItemV2 extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $table = 'sales_invoice_items_v2';
    protected $fillable = ['invoice_id','product_id','qty','rate','vat_pct','line_subtotal','vat_amount','line_total','source_vat_challan_item_id','sort_order'];

    public function invoice() { return $this->belongsTo(SalesInvoiceV2::class, 'invoice_id'); }
    public function product() { return $this->belongsTo(ItemMaster::class, 'product_id'); }
}
