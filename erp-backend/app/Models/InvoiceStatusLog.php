<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class InvoiceStatusLog extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['invoice_id','old_status','new_status','changed_by','notes'];
    protected $casts = ['created_at' => 'datetime'];
}
