<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class PoAmendment extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $fillable = ['po_id','amended_by','old_data','new_data','reason'];
    protected $casts = ['old_data' => 'array', 'new_data' => 'array'];
}
