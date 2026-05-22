<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class DispatchItem extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['dispatch_id','product_id','qty','sort_order'];

    public function dispatch() { return $this->belongsTo(Dispatch::class); }
    public function allocations() { return $this->hasMany(DispatchPoAllocation::class); }
    public function product() { return $this->belongsTo(ItemMaster::class, 'product_id'); }
}
