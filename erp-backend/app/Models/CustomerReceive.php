<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class CustomerReceive extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['delivery_challan_id','receive_date','received_by_name','transport_info','scan_url','notes','created_by'];
    protected $casts = ['receive_date' => 'date', 'created_at' => 'datetime'];
}
