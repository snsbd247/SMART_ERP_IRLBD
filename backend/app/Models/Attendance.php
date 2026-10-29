<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Attendance extends Model
{
    use HasUuids;
    public $timestamps = false;
    protected $table = 'attendance';
    protected $fillable = [
        'employee_id', 'date', 'status', 'check_in', 'check_out', 'notes',
        'check_in_lat', 'check_in_lng', 'check_out_lat', 'check_out_lng', 'source',
    ];
    protected $casts = [
        'date' => 'date',
        'check_in_lat' => 'float',
        'check_in_lng' => 'float',
        'check_out_lat' => 'float',
        'check_out_lng' => 'float',
    ];
    public function employee() { return $this->belongsTo(Employee::class); }
}
