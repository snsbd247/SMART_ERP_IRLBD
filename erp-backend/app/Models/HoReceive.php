<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class HoReceive extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['delivery_challan_id','ho_receive_date','verified_by','missing_flag','notes'];
    protected $casts = ['ho_receive_date' => 'date', 'missing_flag' => 'boolean', 'created_at' => 'datetime'];
}
