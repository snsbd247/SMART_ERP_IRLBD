<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Loads Sales/Purchase JSON dumps (extracted read-only from the external VAT
 * software's MS SQL database by a local script) into the vat_import_*_staging
 * tables. Safe to re-run — rows already staged (matched by source_ref_no)
 * are skipped, so re-extracting and re-loading only adds genuinely new
 * documents.
 */
class VatImportLoadStaging extends Command
{
    protected $signature = 'vat-import:load-staging {--sales= : Path to sales.json} {--purchase= : Path to purchase.json}';
    protected $description = 'Load extracted VAT-software Sales/Purchase JSON into the import staging tables';

    public function handle(): int
    {
        $salesPath = $this->option('sales');
        $purchasePath = $this->option('purchase');

        if (!$salesPath && !$purchasePath) {
            $this->error('Pass at least one of --sales=path/to/sales.json or --purchase=path/to/purchase.json');
            return 1;
        }

        if ($salesPath) $this->loadSales($salesPath);
        if ($purchasePath) $this->loadPurchase($purchasePath);

        return 0;
    }

    private function loadSales(string $path): void
    {
        if (!file_exists($path)) { $this->error("File not found: {$path}"); return; }
        $docs = json_decode(file_get_contents($path), true);
        if (!is_array($docs)) { $this->error("Invalid JSON: {$path}"); return; }

        $inserted = 0; $skipped = 0;
        foreach ($docs as $doc) {
            if (DB::table('vat_import_sales_staging')->where('source_ref_no', $doc['source_ref_no'])->exists()) {
                $skipped++;
                continue;
            }
            $id = (string) Str::uuid();
            DB::table('vat_import_sales_staging')->insert([
                'id' => $id,
                'source_ref_no' => $doc['source_ref_no'],
                'invoice_date' => $doc['date'],
                'party_name' => $doc['party_name'],
                'party_bin' => $doc['party_bin'],
                'party_tin' => $doc['party_tin'],
                'party_address' => $doc['party_address'],
                'party_phone' => $doc['party_phone'],
                'subtotal' => $doc['subtotal'],
                'vat_amount' => $doc['vat_amount'],
                'grand_total' => $doc['grand_total'],
                'narration' => $doc['narration'],
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            foreach ($doc['items'] as $it) {
                DB::table('vat_import_sales_items_staging')->insert([
                    'id' => (string) Str::uuid(),
                    'staging_id' => $id,
                    'line_no' => $it['line_no'],
                    'item_name' => $it['item_name'],
                    'item_hs_code' => $it['item_hs_code'],
                    'unit' => $it['unit'],
                    'quantity' => $it['quantity'],
                    'rate' => $it['rate'],
                    'vat_pct' => $it['vat_pct'],
                    'vat_amount' => $it['vat_amount'],
                    'line_subtotal' => $it['line_subtotal'],
                    'line_total' => $it['line_total'],
                    'godown_name' => $it['godown_name'],
                    'challan_no' => $it['challan_no'] ?? null,
                    'po_no' => $it['po_no'] ?? null,
                    'po_date' => $it['po_date'] ?? null,
                ]);
            }
            $inserted++;
        }
        $this->info("Sales: {$inserted} new, {$skipped} already staged (skipped).");
    }

    private function loadPurchase(string $path): void
    {
        if (!file_exists($path)) { $this->error("File not found: {$path}"); return; }
        $docs = json_decode(file_get_contents($path), true);
        if (!is_array($docs)) { $this->error("Invalid JSON: {$path}"); return; }

        $inserted = 0; $skipped = 0;
        foreach ($docs as $doc) {
            if (DB::table('vat_import_purchase_staging')->where('source_ref_no', $doc['source_ref_no'])->exists()) {
                $skipped++;
                continue;
            }
            $id = (string) Str::uuid();
            DB::table('vat_import_purchase_staging')->insert([
                'id' => $id,
                'source_ref_no' => $doc['source_ref_no'],
                'bill_date' => $doc['date'],
                'party_name' => $doc['party_name'],
                'party_bin' => $doc['party_bin'],
                'party_tin' => $doc['party_tin'],
                'party_address' => $doc['party_address'],
                'party_phone' => $doc['party_phone'],
                'subtotal' => $doc['subtotal'],
                'vat_amount' => $doc['vat_amount'],
                'grand_total' => $doc['grand_total'],
                'narration' => $doc['narration'],
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            foreach ($doc['items'] as $it) {
                DB::table('vat_import_purchase_items_staging')->insert([
                    'id' => (string) Str::uuid(),
                    'staging_id' => $id,
                    'line_no' => $it['line_no'],
                    'item_name' => $it['item_name'],
                    'item_hs_code' => $it['item_hs_code'],
                    'unit' => $it['unit'],
                    'quantity' => $it['quantity'],
                    'rate' => $it['rate'],
                    'vat_pct' => $it['vat_pct'],
                    'vat_amount' => $it['vat_amount'],
                    'line_subtotal' => $it['line_subtotal'],
                    'line_total' => $it['line_total'],
                    'godown_name' => $it['godown_name'],
                ]);
            }
            $inserted++;
        }
        $this->info("Purchase: {$inserted} new, {$skipped} already staged (skipped).");
    }
}
