<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A released voucher number waiting to be reused by the next
 * entry of the same sequence. Populated by NumberSequenceService::release()
 * and consumed by NumberSequenceService::next() before incrementing the counter.
 */
class NumberSequenceFreeItem extends Model
{
    use HasUuids;
    protected $table = 'number_sequence_free_list';
    public $timestamps = false;
    protected $fillable = ['sequence_id', 'number', 'released_by', 'released_at', 'consumed_at'];
    protected $casts = [
        'released_at' => 'datetime',
        'consumed_at' => 'datetime',
    ];
}
