<?php

namespace App\Services;

use App\Models\DeliveryChallan;
use App\Models\CustomerReceive;
use App\Models\HoReceive;
use Illuminate\Support\Facades\DB;

class DeliveryChallanService
{
    /** Customer signs and returns the challan. */
    public function markCustomerReceived(string $dcId, array $data): DeliveryChallan
    {
        return DB::transaction(function () use ($dcId, $data) {
            $dc = DeliveryChallan::findOrFail($dcId);
            CustomerReceive::create(array_merge($data, ['delivery_challan_id' => $dc->id]));
            if (in_array($dc->status, ['issued', 'delivered'])) {
                $dc->update(['status' => 'customer_received']);
            }
            return $dc;
        });
    }

    /** Physical doc reaches Head Office. */
    public function markHoReceived(string $dcId, array $data): DeliveryChallan
    {
        return DB::transaction(function () use ($dcId, $data) {
            $dc = DeliveryChallan::findOrFail($dcId);
            HoReceive::create(array_merge($data, ['delivery_challan_id' => $dc->id]));
            if (!($data['missing_flag'] ?? false)) {
                $dc->update(['status' => 'ho_received']);
            }
            return $dc;
        });
    }

    public function setStatus(string $dcId, string $status): DeliveryChallan
    {
        $dc = DeliveryChallan::findOrFail($dcId);
        $dc->update(['status' => $status]);
        return $dc;
    }
}
