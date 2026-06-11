<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class PurchaseReturn extends Model
{
    use HasUuids;
    protected $fillable = ['return_number', 'return_date', 'supplier_id', 'purchase_id', 'branch_id', 'warehouse_id', 'total_amount', 'reason', 'status', 'created_by'];
    protected $casts = ['return_date' => 'date'];
    public function items() { return $this->hasMany(PurchaseReturnItem::class); }
}
