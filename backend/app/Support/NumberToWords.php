<?php

namespace App\Support;

/**
 * Converts a Taka amount to English words for printed documents (Money
 * Receipt, cheques, etc). Uses the Indian/Bangladeshi numbering scale
 * (Lakh/Crore) since that's what a Bangladeshi reader expects, rather than
 * the Western Million/Billion scale.
 */
class NumberToWords
{
    private const ONES = [
        '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
        'Seventeen', 'Eighteen', 'Nineteen',
    ];

    private const TENS = [
        '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
    ];

    public static function taka(float $amount): string
    {
        $amount = round($amount, 2);
        $whole = (int) floor($amount);
        $paisa = (int) round(($amount - $whole) * 100);

        $words = self::convert($whole) . ' Taka';
        if ($paisa > 0) {
            $words .= ' and ' . self::convert($paisa) . ' Paisa';
        }
        return trim($words) . ' Only';
    }

    private static function convert(int $number): string
    {
        if ($number === 0) return 'Zero';

        $parts = [];
        $crore = intdiv($number, 10000000);
        $number %= 10000000;
        $lakh = intdiv($number, 100000);
        $number %= 100000;
        $thousand = intdiv($number, 1000);
        $number %= 1000;
        $hundred = intdiv($number, 100);
        $rest = $number % 100;

        if ($crore > 0) $parts[] = self::convertBelowThousand($crore) . ' Crore';
        if ($lakh > 0) $parts[] = self::convertBelowThousand($lakh) . ' Lakh';
        if ($thousand > 0) $parts[] = self::convertBelowThousand($thousand) . ' Thousand';
        if ($hundred > 0) $parts[] = self::ONES[$hundred] . ' Hundred';
        if ($rest > 0) $parts[] = self::convertBelowHundred($rest);

        return implode(' ', $parts);
    }

    private static function convertBelowThousand(int $number): string
    {
        if ($number >= 100) {
            $hundred = intdiv($number, 100);
            $rest = $number % 100;
            return trim(self::ONES[$hundred] . ' Hundred' . ($rest > 0 ? ' ' . self::convertBelowHundred($rest) : ''));
        }
        return self::convertBelowHundred($number);
    }

    private static function convertBelowHundred(int $number): string
    {
        if ($number < 20) return self::ONES[$number];
        $tens = intdiv($number, 10);
        $ones = $number % 10;
        return trim(self::TENS[$tens] . ($ones > 0 ? ' ' . self::ONES[$ones] : ''));
    }
}
