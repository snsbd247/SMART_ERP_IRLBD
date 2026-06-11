<?php

namespace App\Services;

use App\Models\NumberSequence;
use Illuminate\Support\Facades\DB;

class NumberSequenceService
{
    /**
     * Get the next number for a sequence and increment atomically.
     * Auto-rolls the year and resets the serial when the calendar year changes.
     */
    public function next(string $sequenceId): string
    {
        return DB::transaction(function () use ($sequenceId) {
            $seq = NumberSequence::lockForUpdate()->findOrFail($sequenceId);

            $currentYear = (int) date('Y');
            if ((int) $seq->year !== $currentYear) {
                $seq->year = $currentYear;
                $seq->current_number = 0;
            }

            $seq->current_number = (int) $seq->current_number + 1;
            $seq->save();

            $num = str_pad((string) $seq->current_number, 5, '0', STR_PAD_LEFT);
            return "{$seq->prefix}-{$seq->year}-{$num}";
        });
    }
}
