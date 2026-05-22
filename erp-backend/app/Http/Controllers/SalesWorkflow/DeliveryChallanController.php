<?php
namespace App\Http\Controllers\SalesWorkflow;

use App\Http\Controllers\BaseController;
use App\Models\DeliveryChallan;
use App\Services\DeliveryChallanService;
use App\Services\DocumentDeleteGuard;
use Illuminate\Http\Request;

class DeliveryChallanController extends BaseController
{
    public function __construct(private DeliveryChallanService $service) {}

    public function index(Request $r)
    {
        $q = DeliveryChallan::with('customer', 'product', 'vatChallan')->latest('dc_date');
        if ($r->customer_id) $q->where('customer_id', $r->customer_id);
        if ($r->status) $q->where('status', $r->status);
        if ($r->vat_challan_id) $q->where('vat_challan_id', $r->vat_challan_id);
        if ($r->q) $q->where('dc_number', 'like', "%{$r->q}%");
        return $this->paginated($q->paginate($r->per_page ?? 25));
    }

    public function show(string $id)
    {
        return $this->success(DeliveryChallan::with('vatChallan.items','customer','product','customerReceives','hoReceives')->findOrFail($id));
    }

    public function customerReceive(Request $r, string $id)
    {
        $r->validate(['receive_date' => 'required|date']);
        return $this->success($this->service->markCustomerReceived($id, array_merge(
            $r->only('receive_date','received_by_name','transport_info','scan_url','notes'),
            ['created_by' => $r->user()?->id]
        )));
    }

    public function hoReceive(Request $r, string $id)
    {
        $r->validate(['ho_receive_date' => 'required|date']);
        return $this->success($this->service->markHoReceived($id, array_merge(
            $r->only('ho_receive_date','missing_flag','notes'),
            ['verified_by' => $r->user()?->id]
        )));
    }

    public function setStatus(Request $r, string $id)
    {
        $r->validate(['status' => 'required|in:issued,delivered,customer_received,sent_to_ho,ho_received,invoiced']);
        return $this->success($this->service->setStatus($id, $r->status));
    }

    public function destroy(Request $r, string $id)
    {
        DocumentDeleteGuard::forUser($r->user())->deliveryChallan($id);
        DeliveryChallan::findOrFail($id)->delete();
        return $this->success(['deleted' => true]);
    }
}
