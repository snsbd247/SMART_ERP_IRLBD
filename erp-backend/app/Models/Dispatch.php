<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Dispatch extends Model
{
    use HasUuids, SoftDeletes;
    protected $fillable = ['dispatch_number','dispatch_date','customer_id','vehicle_no','driver_name','driver_phone','status','total_qty','notes','branch_id','financial_year_id','created_by'];
    protected $casts = ['dispatch_date' => 'date'];

    public function items() { return $this->hasMany(DispatchItem::class); }
    public function customer() { return $this->belongsTo(Customer::class); }
    public function vatChallans() { return $this->hasMany(VatChallan::class); }
}
