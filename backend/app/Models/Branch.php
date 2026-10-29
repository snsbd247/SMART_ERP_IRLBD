<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Branch extends Model
{
    use HasUuids;

    protected $fillable = [
        'code', 'name', 'phone', 'address', 'status',
        'latitude', 'longitude', 'geofence_radius_m',
    ];

    protected $casts = [
        'latitude' => 'float',
        'longitude' => 'float',
        'geofence_radius_m' => 'integer',
    ];

    public function users() { return $this->hasMany(User::class); }
    public function employees() { return $this->hasMany(Employee::class); }
    public function warehouses() { return $this->hasMany(Warehouse::class); }
}
