<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LicenseState extends Model
{
    protected $table = 'license_state';
    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = [
        'id', 'license_key', 'status', 'expires_at', 'activated_at',
        'last_checked_at', 'last_check_ok', 'message', 'signature',
    ];
    protected $casts = [
        'expires_at' => 'datetime',
        'activated_at' => 'datetime',
        'last_checked_at' => 'datetime',
        'last_check_ok' => 'boolean',
    ];
}
