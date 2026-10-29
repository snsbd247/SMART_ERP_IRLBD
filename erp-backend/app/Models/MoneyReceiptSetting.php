<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MoneyReceiptSetting extends Model
{
    protected $table = 'money_receipt_settings';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = ['id', 'last_number'];
}
