<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use App\Repositories\AccountRepository;
use App\Services\AccountingService;
use App\Services\NumberSequenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Selective historical import from an external VAT accounting system.
 *
 * Data flow: a local script reads the (read-only) external MS SQL database
 * and JSON-dumps Sales/Purchase documents; `vat-import:load-staging` loads
 * them into vat_import_*_staging (skipping already-staged source refs); this
 * controller lets a Super Admin review pending rows and selectively convert
 * them into real sales_invoices_v2 / supplier_bills_v2 records — matching or
 * creating the customer/supplier/item, then posting an accounting voucher.
 * Imported rows are marked so they never appear in the pending list again.
 */
class VatImportController extends BaseController
{
    public function __construct(
        private AccountingService $accounting,
        private AccountRepository $accountRepo,
        private NumberSequenceService $seq,
    ) {}

    public function salesIndex(Request $request): JsonResponse
    {
        $rows = DB::table('vat_import_sales_staging')
            ->where('status', 'pending')
            ->orderBy('invoice_date')
            ->get();
        $counts = DB::table('vat_import_sales_items_staging')
            ->select('staging_id', DB::raw('COUNT(*) as cnt'))
            ->whereIn('staging_id', $rows->pluck('id'))
            ->groupBy('staging_id')
            ->pluck('cnt', 'staging_id');
        $rows = $rows->map(function ($r) use ($counts) {
            $r->items_count = (int) ($counts[$r->id] ?? 0);
            return $r;
        });
        return $this->success($rows);
    }

    public function purchaseIndex(Request $request): JsonResponse
    {
        $rows = DB::table('vat_import_purchase_staging')
            ->where('status', 'pending')
            ->orderBy('bill_date')
            ->get();
        $counts = DB::table('vat_import_purchase_items_staging')
            ->select('staging_id', DB::raw('COUNT(*) as cnt'))
            ->whereIn('staging_id', $rows->pluck('id'))
            ->groupBy('staging_id')
            ->pluck('cnt', 'staging_id');
        $rows = $rows->map(function ($r) use ($counts) {
            $r->items_count = (int) ($counts[$r->id] ?? 0);
            return $r;
        });
        return $this->success($rows);
    }

    public function salesItems(string $id): JsonResponse
    {
        $items = DB::table('vat_import_sales_items_staging')->where('staging_id', $id)->orderBy('line_no')->get();
        return $this->success($items);
    }

    public function purchaseItems(string $id): JsonResponse
    {
        $items = DB::table('vat_import_purchase_items_staging')->where('staging_id', $id)->orderBy('line_no')->get();
        return $this->success($items);
    }

    public function importSales(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) return $this->error('Only Super Admins can import.', 403);
        $ids = $request->validate(['ids' => 'required|array|min:1', 'ids.*' => 'string'])['ids'];

        $results = [];
        foreach ($ids as $id) {
            try {
                $results[] = DB::transaction(fn () => $this->importOneSale($id, $request->user()->id));
            } catch (\Throwable $e) {
                Log::warning("VAT import (sales {$id}) failed: " . $e->getMessage());
                $results[] = ['id' => $id, 'ok' => false, 'error' => $e->getMessage()];
            }
        }
        return $this->success($results);
    }

    public function importPurchase(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) return $this->error('Only Super Admins can import.', 403);
        $ids = $request->validate(['ids' => 'required|array|min:1', 'ids.*' => 'string'])['ids'];

        $results = [];
        foreach ($ids as $id) {
            try {
                $results[] = DB::transaction(fn () => $this->importOnePurchase($id, $request->user()->id));
            } catch (\Throwable $e) {
                Log::warning("VAT import (purchase {$id}) failed: " . $e->getMessage());
                $results[] = ['id' => $id, 'ok' => false, 'error' => $e->getMessage()];
            }
        }
        return $this->success($results);
    }

    /**
     * Pending VAT Challans — grouped from sales line-items that carry a real
     * Challan/PO reference but haven't had their Challan-stage created yet.
     * Importing here (see importVatChallans) creates only
     * PO + VAT Challan + Delivery Challan, left at a real "not yet received"
     * status so the normal Customer Receive / HO Receive / Invoice Queue
     * pages pick them up like a fresh delivery.
     */
    public function vatChallansIndex(): JsonResponse
    {
        $items = DB::table('vat_import_sales_items_staging as i')
            ->join('vat_import_sales_staging as h', 'h.id', '=', 'i.staging_id')
            ->whereNotNull('i.challan_no')
            ->whereNotNull('i.po_no')
            ->where('i.challan_status', 'pending')
            ->select('i.challan_no', 'i.po_no', 'i.po_date', 'i.line_subtotal', 'i.vat_amount', 'i.line_total', 'h.invoice_date', 'h.party_name')
            ->orderBy('i.challan_no')
            ->get();

        $grouped = [];
        foreach ($items as $it) {
            if (!isset($grouped[$it->challan_no])) {
                $grouped[$it->challan_no] = [
                    'challan_no' => $it->challan_no,
                    'po_no' => $it->po_no,
                    'invoice_date' => $it->invoice_date,
                    'party_name' => $it->party_name,
                    'subtotal' => 0.0,
                    'vat_amount' => 0.0,
                    'grand_total' => 0.0,
                    'items_count' => 0,
                ];
            }
            $grouped[$it->challan_no]['subtotal'] += (float) $it->line_subtotal;
            $grouped[$it->challan_no]['vat_amount'] += (float) $it->vat_amount;
            $grouped[$it->challan_no]['grand_total'] += (float) $it->line_total;
            $grouped[$it->challan_no]['items_count']++;
        }
        foreach ($grouped as &$g) {
            $g['subtotal'] = round($g['subtotal'], 2);
            $g['vat_amount'] = round($g['vat_amount'], 2);
            $g['grand_total'] = round($g['grand_total'], 2);
        }
        return $this->success(array_values($grouped));
    }

    public function importVatChallans(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) return $this->error('Only Super Admins can import.', 403);
        $challanNos = $request->validate(['challan_nos' => 'required|array|min:1', 'challan_nos.*' => 'string'])['challan_nos'];

        $results = [];
        foreach ($challanNos as $challanNo) {
            try {
                $results[] = DB::transaction(fn () => $this->importOneChallanGroup($challanNo, $request->user()->id));
            } catch (\Throwable $e) {
                Log::warning("VAT import (challan {$challanNo}) failed: " . $e->getMessage());
                $results[] = ['challan_no' => $challanNo, 'ok' => false, 'error' => $e->getMessage()];
            }
        }
        return $this->success($results);
    }

    // ───────────────────────── one-record conversion ─────────────────────────

    private function importOneSale(string $stagingId, ?string $userId): array
    {
        $row = DB::table('vat_import_sales_staging')->where('id', $stagingId)->where('status', 'pending')->lockForUpdate()->first();
        if (!$row) throw new \RuntimeException('Already imported or not found.');
        $items = DB::table('vat_import_sales_items_staging')->where('staging_id', $stagingId)->orderBy('line_no')->get();

        $customerId = $this->matchOrCreateCustomer($row);

        $invoiceId = (string) Str::uuid();
        $invoiceNumber = $this->seq->next('sales_invoice_v2');
        DB::table('sales_invoices_v2')->insert([
            'id' => $invoiceId,
            'invoice_number' => $invoiceNumber,
            'invoice_date' => $row->invoice_date,
            'customer_id' => $customerId,
            'mode' => 'single',
            'subtotal' => $row->subtotal,
            'vat_total' => $row->vat_amount,
            'grand_total' => $row->grand_total,
            'paid_amount' => 0,
            'tds_amount' => 0,
            'due_amount' => $row->grand_total,
            'status' => 'posted',
            'notes' => $row->narration ? "Imported from VAT software (ref {$row->source_ref_no}). {$row->narration}" : "Imported from VAT software (ref {$row->source_ref_no}).",
            'created_by' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Reconstruct PO -> VAT Challan -> Delivery Challan -> Receive for
        // items that carry a real Challan/PO reference from the source
        // system; items without one just go straight onto the invoice —
        // never invent a challan/PO that didn't exist in the source data.
        $challanIdsTouched = [];
        foreach ($items as $sort => $it) {
            $vatChallanItemId = null;

            if (!empty($it->challan_no) && !empty($it->po_no)) {
                if ($it->challan_status === 'imported' && $it->created_vat_challan_item_id) {
                    // Already created (possibly received) via a separate
                    // Challan-stage import — reuse it, just fill in whatever
                    // is still missing (receive steps) before invoicing.
                    $itemId = $it->created_item_id;
                    $challanId = $it->created_vat_challan_id;
                    $vatChallanItemId = $it->created_vat_challan_item_id;
                    $this->ensureReceived($it->created_delivery_challan_id, $row->invoice_date, $userId);
                } else {
                    $itemId = $this->matchOrCreateItem($it->item_name, $it->unit, (float) $it->rate);
                    $poId = $this->matchOrCreatePurchaseOrder($it->po_no, $it->po_date ?? $row->invoice_date, $customerId, $userId);
                    $poItemId = $this->matchOrCreatePurchaseOrderItem($poId, $itemId, $it);
                    $challanId = $this->matchOrCreateVatChallan($it->challan_no, $row->invoice_date, $customerId, $poId, $userId);
                    $vatChallanItemId = $this->addVatChallanItem($challanId, $itemId, $poItemId, $it);
                    $dcId = $this->createDeliveryChallan($challanId, $vatChallanItemId, $itemId, (float) $it->quantity, $customerId, $row->invoice_date, $userId, 'ho_received');
                    $this->ensureReceived($dcId, $row->invoice_date, $userId);
                }
                $challanIdsTouched[$challanId] = true;
            } else {
                $itemId = $this->matchOrCreateItem($it->item_name, $it->unit, (float) $it->rate);
            }

            DB::table('sales_invoice_items_v2')->insert([
                'id' => (string) Str::uuid(),
                'invoice_id' => $invoiceId,
                'product_id' => $itemId,
                'qty' => $it->quantity,
                'rate' => $it->rate,
                'vat_pct' => $it->vat_pct,
                'line_subtotal' => $it->line_subtotal,
                'vat_amount' => $it->vat_amount,
                'line_total' => $it->line_total,
                'source_vat_challan_item_id' => $vatChallanItemId,
                'sort_order' => $sort,
            ]);
        }

        foreach (array_keys($challanIdsTouched) as $challanId) {
            DB::table('invoice_challans')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'invoice_id' => $invoiceId,
                'vat_challan_id' => $challanId,
                'created_at' => now(),
            ]);
            DB::table('vat_challans')->where('id', $challanId)->update(['status' => 'invoiced']);
            DB::table('delivery_challans')->where('vat_challan_id', $challanId)->update(['status' => 'invoiced', 'updated_at' => now()]);
        }

        $voucherId = $this->postSalesVoucher($row, $invoiceNumber, $userId);
        if ($voucherId) {
            DB::table('sales_invoices_v2')->where('id', $invoiceId)->update(['voucher_id' => $voucherId]);
        }

        DB::table('vat_import_sales_staging')->where('id', $stagingId)->update([
            'status' => 'imported',
            'created_customer_id' => $customerId,
            'created_sales_invoice_id' => $invoiceId,
            'created_voucher_id' => $voucherId,
            'imported_by' => $userId,
            'imported_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            'id' => $stagingId, 'ok' => true, 'invoice_id' => $invoiceId,
            'invoice_number' => $invoiceNumber, 'voucher_posted' => (bool) $voucherId,
        ];
    }

    private function importOnePurchase(string $stagingId, ?string $userId): array
    {
        $row = DB::table('vat_import_purchase_staging')->where('id', $stagingId)->where('status', 'pending')->lockForUpdate()->first();
        if (!$row) throw new \RuntimeException('Already imported or not found.');
        $items = DB::table('vat_import_purchase_items_staging')->where('staging_id', $stagingId)->orderBy('line_no')->get();

        $supplierId = $this->matchOrCreateSupplier($row);

        $billId = (string) Str::uuid();
        $billNumber = $this->seq->next('purchase_bill');
        DB::table('supplier_bills_v2')->insert([
            'id' => $billId,
            'bill_no' => $billNumber,
            'bill_date' => $row->bill_date,
            'supplier_id' => $supplierId,
            'currency' => 'BDT',
            'exchange_rate' => 1,
            'subtotal' => $row->subtotal,
            'vat_amount' => $row->vat_amount,
            'grand_total' => $row->grand_total,
            'paid_amount' => 0,
            'balance_due' => $row->grand_total,
            'status' => 'Posted',
            'auto_post' => false,
            'notes' => $row->narration ? "Imported from VAT software (ref {$row->source_ref_no}). {$row->narration}" : "Imported from VAT software (ref {$row->source_ref_no}).",
            'created_by' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ($items as $idx => $it) {
            $itemId = $this->matchOrCreateItem($it->item_name, $it->unit, (float) $it->rate);
            DB::table('supplier_bill_items_v2')->insert([
                'id' => (string) Str::uuid(),
                'bill_id' => $billId,
                'line_no' => $idx + 1,
                'item_id' => $itemId,
                'item_description' => $it->item_name,
                'quantity' => $it->quantity,
                'unit_price' => $it->rate,
                'line_total' => $it->line_total,
                'created_at' => now(),
            ]);
        }

        $voucherId = $this->postPurchaseVoucher($row, $billNumber, $userId);
        if ($voucherId) {
            DB::table('supplier_bills_v2')->where('id', $billId)->update(['voucher_id' => $voucherId]);
        }

        DB::table('vat_import_purchase_staging')->where('id', $stagingId)->update([
            'status' => 'imported',
            'created_supplier_id' => $supplierId,
            'created_bill_id' => $billId,
            'created_voucher_id' => $voucherId,
            'imported_by' => $userId,
            'imported_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            'id' => $stagingId, 'ok' => true, 'bill_id' => $billId,
            'bill_no' => $billNumber, 'voucher_posted' => (bool) $voucherId,
        ];
    }

    /**
     * Import just the Challan stage for every pending item under one source
     * Challan No: Customer PO + VAT Challan + Delivery Challan, left at a
     * real "not yet received" status — no Customer/HO Receive, no Invoice.
     * The result is picked up by the app's own Delivery Challans /
     * Customer Receive / HO Receive / Invoice Queue pages exactly like a
     * fresh, real delivery.
     */
    private function importOneChallanGroup(string $challanNo, ?string $userId): array
    {
        $items = DB::table('vat_import_sales_items_staging as i')
            ->join('vat_import_sales_staging as h', 'h.id', '=', 'i.staging_id')
            ->where('i.challan_no', $challanNo)
            ->where('i.challan_status', 'pending')
            ->select('i.*', 'h.invoice_date', 'h.party_name', 'h.party_phone', 'h.party_address', 'h.party_tin', 'h.party_bin')
            ->lockForUpdate()
            ->get();
        if ($items->isEmpty()) throw new \RuntimeException('Already imported or not found.');

        $header = $items->first();
        $customerId = $this->matchOrCreateCustomer($header);
        $challanId = null;

        foreach ($items as $it) {
            $itemId = $this->matchOrCreateItem($it->item_name, $it->unit, (float) $it->rate);
            $poId = $this->matchOrCreatePurchaseOrder($it->po_no, $it->po_date ?? $it->invoice_date, $customerId, $userId);
            $poItemId = $this->matchOrCreatePurchaseOrderItem($poId, $itemId, $it);
            $challanId = $this->matchOrCreateVatChallan($it->challan_no, $it->invoice_date, $customerId, $poId, $userId);
            $vatChallanItemId = $this->addVatChallanItem($challanId, $itemId, $poItemId, $it);
            $dcId = $this->createDeliveryChallan($challanId, $vatChallanItemId, $itemId, (float) $it->quantity, $customerId, $it->invoice_date, $userId, 'issued');

            DB::table('vat_import_sales_items_staging')->where('id', $it->id)->update([
                'challan_status' => 'imported',
                'created_item_id' => $itemId,
                'created_purchase_order_id' => $poId,
                'created_vat_challan_id' => $challanId,
                'created_vat_challan_item_id' => $vatChallanItemId,
                'created_delivery_challan_id' => $dcId,
            ]);
        }

        return ['challan_no' => $challanNo, 'ok' => true, 'vat_challan_id' => $challanId, 'items_count' => $items->count()];
    }

    // ───────────────────────── match-or-create ─────────────────────────

    private function matchOrCreateCustomer(object $row): string
    {
        $name = trim($row->party_name);
        $existing = DB::table('customers')->whereRaw('LOWER(name) = ?', [strtolower($name)])->first();
        if ($existing) return $existing->id;

        $id = (string) Str::uuid();
        DB::table('customers')->insert([
            'id' => $id,
            'name' => $name,
            'phone' => $row->party_phone,
            'address' => $row->party_address,
            'tin_no' => $row->party_tin,
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        return $id;
    }

    private function matchOrCreateSupplier(object $row): string
    {
        $name = trim($row->party_name);
        $existing = DB::table('suppliers')->whereRaw('LOWER(name) = ?', [strtolower($name)])->first();
        if ($existing) return $existing->id;

        $id = (string) Str::uuid();
        DB::table('suppliers')->insert([
            'id' => $id,
            'name' => $name,
            'phone' => $row->party_phone,
            'address' => $row->party_address,
            'tin_no' => $row->party_tin,
            'bin_no' => $row->party_bin,
            'vat_reg_no' => $row->party_bin,
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        return $id;
    }

    private function matchOrCreateItem(string $name, ?string $unit, float $rate): string
    {
        $name = trim($name);
        $existing = DB::table('item_master')->whereRaw('LOWER(item_name) = ?', [strtolower($name)])->first();
        if ($existing) return $existing->id;

        $unitId = null;
        if ($unit) {
            $unit = trim($unit);
            $u = DB::table('units')->whereRaw('LOWER(abbreviation) = ?', [strtolower($unit)])->first();
            if ($u) {
                $unitId = $u->id;
            } else {
                $unitId = (string) Str::uuid();
                DB::table('units')->insert(['id' => $unitId, 'name' => $unit, 'abbreviation' => $unit, 'created_at' => now(), 'updated_at' => now()]);
            }
        }

        $itemId = (string) Str::uuid();
        $n = DB::table('item_master')->count() + 1;
        $code = 'ITM-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
        while (DB::table('item_master')->where('item_code', $code)->exists()) {
            $n++;
            $code = 'ITM-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
        }

        DB::table('item_master')->insert([
            'id' => $itemId,
            'item_code' => $code,
            'item_name' => $name,
            'item_type' => 'product',
            'unit_id' => $unitId,
            'cost_price' => $rate,
            'selling_price' => $rate,
            'is_stock_item' => 1,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $itemId;
    }

    /**
     * Find-or-create a Customer PO by its source PO number. The same PO can
     * legitimately span many challans/invoices over time (partial
     * deliveries), so this only creates it once and accumulates totals on
     * every subsequent line that references it.
     */
    private function matchOrCreatePurchaseOrder(string $poNo, string $poDate, string $customerId, ?string $userId): string
    {
        $existing = DB::table('purchase_orders')->where('po_number', $poNo)->first();
        if ($existing) return $existing->id;

        $id = (string) Str::uuid();
        DB::table('purchase_orders')->insert([
            'id' => $id,
            'po_number' => $poNo,
            'po_date' => $poDate,
            'customer_id' => $customerId,
            'status' => 'open',
            'subtotal' => 0,
            'vat_amount' => 0,
            'grand_total' => 0,
            'notes' => 'Imported from VAT software.',
            'created_by' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $id;
    }

    /**
     * Find-or-create a VAT Challan by its source challan number, accumulating
     * totals as each line-item is added (see matchOrCreatePurchaseOrder).
     */
    /**
     * Find-or-create the PO line for this product. Historical data is
     * already fully delivered, so each occurrence (the same product can
     * appear on more than one challan under the same PO) simply adds onto
     * qty_ordered/qty_delivered with qty_remaining staying at 0.
     */
    private function matchOrCreatePurchaseOrderItem(string $poId, string $itemId, object $it): string
    {
        $existing = DB::table('purchase_order_items')->where('po_id', $poId)->where('product_id', $itemId)->first();
        if ($existing) {
            DB::table('purchase_order_items')->where('id', $existing->id)->update([
                'qty_ordered' => DB::raw('qty_ordered + ' . (float) $it->quantity),
                'qty_delivered' => DB::raw('qty_delivered + ' . (float) $it->quantity),
                'line_subtotal' => DB::raw('line_subtotal + ' . (float) $it->line_subtotal),
                'line_vat' => DB::raw('line_vat + ' . (float) $it->vat_amount),
                'line_total' => DB::raw('line_total + ' . (float) $it->line_total),
            ]);
            return $existing->id;
        }

        $id = (string) Str::uuid();
        $sort = DB::table('purchase_order_items')->where('po_id', $poId)->count();
        DB::table('purchase_order_items')->insert([
            'id' => $id,
            'po_id' => $poId,
            'product_id' => $itemId,
            'qty_ordered' => $it->quantity,
            'qty_delivered' => $it->quantity,
            'qty_remaining' => 0,
            'rate' => $it->rate,
            'vat_pct' => $it->vat_pct,
            'line_subtotal' => $it->line_subtotal,
            'line_vat' => $it->vat_amount,
            'line_total' => $it->line_total,
            'sort_order' => $sort,
        ]);
        return $id;
    }

    private function matchOrCreateVatChallan(string $challanNo, string $date, string $customerId, ?string $poId, ?string $userId): string
    {
        $existing = DB::table('vat_challans')->where('challan_number', $challanNo)->first();
        if ($existing) return $existing->id;

        $id = (string) Str::uuid();
        DB::table('vat_challans')->insert([
            'id' => $id,
            'challan_number' => $challanNo,
            'challan_date' => $date,
            'customer_id' => $customerId,
            'purchase_order_id' => $poId,
            'subtotal' => 0,
            'vat_amount' => 0,
            'grand_total' => 0,
            'source' => 'purchase_order',
            'status' => 'issued',
            'notes' => 'Imported from VAT software.',
            'created_by' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $id;
    }

    private function addVatChallanItem(string $challanId, string $itemId, string $poItemId, object $it): string
    {
        $itemId2 = (string) Str::uuid();
        $sort = DB::table('vat_challan_items')->where('vat_challan_id', $challanId)->count();
        DB::table('vat_challan_items')->insert([
            'id' => $itemId2,
            'vat_challan_id' => $challanId,
            'product_id' => $itemId,
            'purchase_order_item_id' => $poItemId,
            'qty' => $it->quantity,
            'po_qty_consumed' => $it->quantity,
            'rate' => $it->rate,
            'vat_pct' => $it->vat_pct,
            'line_subtotal' => $it->line_subtotal,
            'vat_amount' => $it->vat_amount,
            'line_total' => $it->line_total,
            'sort_order' => $sort,
        ]);
        DB::table('vat_challans')->where('id', $challanId)->update([
            'subtotal' => DB::raw('subtotal + ' . (float) $it->line_subtotal),
            'vat_amount' => DB::raw('vat_amount + ' . (float) $it->vat_amount),
            'grand_total' => DB::raw('grand_total + ' . (float) $it->line_total),
        ]);
        $challan = DB::table('vat_challans')->where('id', $challanId)->first();
        if ($challan->purchase_order_id) {
            DB::table('purchase_orders')->where('id', $challan->purchase_order_id)->update([
                'subtotal' => DB::raw('subtotal + ' . (float) $it->line_subtotal),
                'vat_amount' => DB::raw('vat_amount + ' . (float) $it->vat_amount),
                'grand_total' => DB::raw('grand_total + ' . (float) $it->line_total),
            ]);
        }
        return $itemId2;
    }

    /**
     * Create the Delivery Challan row only — left at $status (a real,
     * not-yet-received state when imported at the Challan stage, so it
     * shows up in the normal Delivery Challans / Customer Receive / HO
     * Receive pages to be advanced by hand, exactly like a fresh delivery).
     */
    private function createDeliveryChallan(string $challanId, string $vatChallanItemId, string $itemId, float $qty, string $customerId, string $date, ?string $userId, string $status): string
    {
        $dcId = (string) Str::uuid();
        $dcNumber = $this->seq->next('delivery_challan');
        DB::table('delivery_challans')->insert([
            'id' => $dcId,
            'dc_number' => $dcNumber,
            'dc_date' => $date,
            'vat_challan_id' => $challanId,
            'vat_challan_item_id' => $vatChallanItemId,
            'product_id' => $itemId,
            'qty' => $qty,
            'customer_id' => $customerId,
            'status' => $status,
            'created_by' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $dcId;
    }

    /**
     * Customer Receive + HO Receive for a Delivery Challan, only if they
     * don't already exist — used when importing the invoice for a challan
     * that may already have been imported (and possibly even received via
     * the app's own UI) at the Challan stage earlier.
     */
    private function ensureReceived(string $dcId, string $date, ?string $userId): void
    {
        if (!DB::table('customer_receives')->where('delivery_challan_id', $dcId)->exists()) {
            DB::table('customer_receives')->insert([
                'id' => (string) Str::uuid(),
                'delivery_challan_id' => $dcId,
                'receive_date' => $date,
                'notes' => 'Imported from VAT software — marked received.',
                'created_by' => $userId,
                'created_at' => now(),
            ]);
        }
        if (!DB::table('ho_receives')->where('delivery_challan_id', $dcId)->exists()) {
            DB::table('ho_receives')->insert([
                'id' => (string) Str::uuid(),
                'delivery_challan_id' => $dcId,
                'ho_receive_date' => $date,
                'missing_flag' => false,
                'notes' => 'Imported from VAT software — marked received.',
                'created_at' => now(),
            ]);
        }
    }

    // ───────────────────────── voucher posting ─────────────────────────

    /**
     * Mirrors the app's existing Sales Invoice posting convention
     * (see src/lib/sales-workflow-api.ts postSalesInvoiceVoucher):
     * Dr Accounts Receivable / Cr Sales Revenue / Cr VAT Payable.
     * Returns null (and just leaves the invoice unposted) if those Chart of
     * Accounts entries aren't configured — never guesses.
     */
    private function postSalesVoucher(object $row, string $invoiceNumber, ?string $userId): ?string
    {
        $ar = $this->accountRepo->findByName('Accounts Receivable');
        $sales = $this->accountRepo->findByName('Sales Revenue') ?? $this->accountRepo->findByName('Sales');
        if (!$ar || !$sales) {
            Log::warning("VAT import: sales voucher skipped for {$row->source_ref_no} — Accounts Receivable / Sales account not found.");
            return null;
        }
        $vatAcct = $this->accountRepo->findByName('VAT Payable') ?? $this->accountRepo->findByName('VAT Payable (Output VAT)');

        $grand = round((float) $row->grand_total, 2);
        $sub = round((float) $row->subtotal, 2);
        $vat = round((float) $row->vat_amount, 2);

        $entries = [['account_id' => $ar->id, 'debit' => $grand, 'credit' => 0, 'narration' => "Invoice {$invoiceNumber}"]];
        if (abs(($sub + $vat) - $grand) <= 1.0) {
            $entries[] = ['account_id' => $sales->id, 'debit' => 0, 'credit' => $sub, 'narration' => "Sales {$invoiceNumber}"];
            if ($vat > 0 && $vatAcct) {
                $entries[] = ['account_id' => $vatAcct->id, 'debit' => 0, 'credit' => $vat, 'narration' => "VAT on {$invoiceNumber}"];
            } elseif ($vat > 0) {
                $entries[0] = $entries[0]; // AR line unchanged
                $entries[1]['credit'] += $vat; // fold VAT into Sales — no VAT Payable account configured
            }
        } else {
            // Source figures don't reconcile (e.g. import-VAT paid separately,
            // not owed to this party) — post the whole amount as Sales rather
            // than guess a split that would leave the voucher unbalanced.
            $entries[] = ['account_id' => $sales->id, 'debit' => 0, 'credit' => $grand, 'narration' => "Sales {$invoiceNumber} (VAT not split — source figures didn't reconcile)"];
        }

        try {
            $voucher = $this->accounting->createVoucher([
                'voucher_type' => 'journal',
                'voucher_date' => $row->invoice_date,
                'description' => "Imported Sales Invoice {$invoiceNumber} (VAT software ref {$row->source_ref_no})",
                'created_by' => $userId,
                'source_module' => 'vat_import',
            ], $entries, true);
            return $voucher->id;
        } catch (\Throwable $e) {
            Log::warning("VAT import: sales voucher post failed for {$row->source_ref_no}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Mirrors the app's existing Supplier Bill posting convention
     * (see src/lib/purchase-billing.ts postSupplierBill), using the default
     * (purchase_type_id IS NULL) purchase_coa_mapping row:
     * Dr GRN Clearing/Expense (+VAT) / Cr Payable.
     */
    private function postPurchaseVoucher(object $row, string $billNumber, ?string $userId): ?string
    {
        $mapping = DB::table('purchase_coa_mapping')->where('is_active', 1)->whereNull('purchase_type_id')->first();
        $drAcctId = $mapping->grn_clearing_account_id ?? $mapping->expense_account_id ?? null;
        if (!$mapping || !$drAcctId || !$mapping->payable_account_id) {
            Log::warning("VAT import: purchase voucher skipped for {$row->source_ref_no} — purchase_coa_mapping not configured (payable/expense account missing).");
            return null;
        }

        $grand = round((float) $row->grand_total, 2);
        $sub = round((float) $row->subtotal, 2);
        $vat = round((float) $row->vat_amount, 2);

        $entries = [];
        if (abs(($sub + $vat) - $grand) <= 1.0) {
            $entries[] = ['account_id' => $drAcctId, 'debit' => $sub, 'credit' => 0, 'narration' => "Bill {$billNumber}"];
            if ($vat > 0 && $mapping->vat_input_account_id) {
                $entries[] = ['account_id' => $mapping->vat_input_account_id, 'debit' => $vat, 'credit' => 0, 'narration' => 'VAT'];
            } elseif ($vat > 0) {
                $entries[0]['debit'] += $vat; // fold VAT into the expense/clearing line — no VAT input account configured
            }
            $entries[] = ['account_id' => $mapping->payable_account_id, 'debit' => 0, 'credit' => $grand, 'narration' => 'Payable to supplier'];
        } else {
            // Source figures don't reconcile (common for import purchases,
            // where VAT is paid to customs separately, not owed to the
            // supplier) — post the whole payable amount as a single line.
            $entries[] = ['account_id' => $drAcctId, 'debit' => $grand, 'credit' => 0, 'narration' => "Bill {$billNumber} (VAT not split — source figures didn't reconcile)"];
            $entries[] = ['account_id' => $mapping->payable_account_id, 'debit' => 0, 'credit' => $grand, 'narration' => 'Payable to supplier'];
        }

        try {
            $voucher = $this->accounting->createVoucher([
                'voucher_type' => 'journal',
                'voucher_date' => $row->bill_date,
                'description' => "Imported Supplier Bill {$billNumber} (VAT software ref {$row->source_ref_no})",
                'created_by' => $userId,
                'source_module' => 'vat_import',
            ], $entries, true);
            return $voucher->id;
        } catch (\Throwable $e) {
            Log::warning("VAT import: purchase voucher post failed for {$row->source_ref_no}: " . $e->getMessage());
            return null;
        }
    }
}
