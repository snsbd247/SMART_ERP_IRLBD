<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\Pivot;

class UserCustomRole extends Pivot
{
    use HasUuids;

    protected $table = 'user_custom_roles';
    public $incrementing = false;
    public $timestamps = false;
    protected $keyType = 'string';
    protected $fillable = ['id', 'user_id', 'custom_role_id'];

    public function uniqueIds(): array
    {
        return ['id'];
    }
}
