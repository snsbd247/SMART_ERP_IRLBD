<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Centralised deletion guard for the Bangladesh VAT sales workflow.
 *
 * Prevents deletion of any document that already has downstream
 * dependencies. Super Admins can bypass via `allowSuperAdmin = true`.
 */
class DocumentDeleteGuard
{
    public function __construct(private bool $allowSuperAdmin = false) {}

    public function purchaseOrder(string $poId): void
    {
        $challanCount = DB::table('vat_challans')->where('purchase_order_id', $poId)->whereNull('deleted_at')->count();
        if ($challanCount > 0 && ! $this->allowSuperAdmin) {
            throw new RuntimeException(
                "Cannot delete Purchase Order: {$challanCount} VAT challan(s) reference it. " .
                "Delete the challan first."
            );
        }
    }

    public function vatChallan(string $vatChallanId): void
    {
        $dcs = DB::table('delivery_challans')->where('vat_challan_id', $vatChallanId)->count();
        if ($dcs > 0 && ! $this->allowSuperAdmin) {
            throw new RuntimeException(
                "Cannot delete VAT Challan: {$dcs} delivery challan(s) reference it."
            );
        }
    }

    public function deliveryChallan(string $dcId): void
    {
        if (DB::table('customer_receives')->where('delivery_challan_id', $dcId)->exists()
            || DB::table('ho_receives')->where('delivery_challan_id', $dcId)->exists()) {
            if (! $this->allowSuperAdmin) {
                throw new RuntimeException('Cannot delete Delivery Challan: it has receive records.');
            }
        }
    }

    public function invoice(string $invoiceId): void
    {
        $pays = DB::table('invoice_payments')->where('invoice_id', $invoiceId)->count();
        if ($pays > 0 && ! $this->allowSuperAdmin) {
            throw new RuntimeException(
                "Cannot delete Invoice: {$pays} payment(s) recorded. Reverse the payments first."
            );
        }
    }

    /** Factory: build a guard tuned to the current user's privilege. */
    public static function forUser(?object $user): self
    {
        $isSuper = $user && property_exists($user, 'employee_id') && $user->employee_id === null;
        return new self($isSuper);
    }
}
