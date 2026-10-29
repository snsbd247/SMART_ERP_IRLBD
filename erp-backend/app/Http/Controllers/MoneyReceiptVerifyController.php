<?php

namespace App\Http\Controllers;

use App\Models\MoneyReceipt;
use Illuminate\Support\Facades\DB;

/**
 * Public (no-auth) verification lookup for the QR code printed on a Money
 * Receipt. Only returns the small, non-sensitive subset of fields needed to
 * confirm the receipt is genuine.
 */
class MoneyReceiptVerifyController extends BaseController
{
    public function show(string $code)
    {
        $receipt = MoneyReceipt::where('verify_code', $code)->first();
        if (!$receipt) {
            return $this->error('Money receipt not found', 404);
        }

        $company = DB::table('company_settings')->where('id', 'default')->first();

        return $this->success([
            'receipt_no' => $receipt->receipt_no,
            'receipt_date' => optional($receipt->receipt_date)->toDateString(),
            'received_from' => $receipt->received_from,
            'address' => $receipt->address,
            'on_account_of' => $receipt->on_account_of,
            'payment_mode' => $receipt->payment_mode,
            'payment_ref_no' => $receipt->payment_ref_no,
            'against_bill_no' => $receipt->against_bill_no,
            'against_bill_date' => optional($receipt->against_bill_date)->toDateString(),
            'amount' => (float) $receipt->amount,
            'amount_in_words' => $receipt->amount_in_words,
            'company_name' => $company->company_name ?? null,
            'company_logo_url' => $company->company_logo_url ?? null,
            'company_address' => $company->address ?? null,
        ]);
    }
}
