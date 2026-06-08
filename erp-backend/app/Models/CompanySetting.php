<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;

class CompanySetting extends Model
{
    protected $table = 'company_settings';
    public $incrementing = false;
    protected $keyType = 'string';
    protected $fillable = [
        'company_name', 'email', 'phone', 'address', 'website', 'company_logo_url',
        'currency_code', 'currency_symbol', 'currency_name', 'currency_position',
        'default_branch_id', 'default_financial_year_id',
    ];
}
