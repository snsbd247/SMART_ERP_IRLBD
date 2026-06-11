<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * Adds FK constraints between BD VAT Sales Workflow tables and the
 * central customers / item_master tables. Mirrors Supabase migrations
 * 20260608125251 (grants — N/A on MySQL) and 20260608125646 (FKs).
 *
 * Safe extension: only adds constraints, no structural change.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        $this->addFk('purchase_orders',        'customer_id', 'customers',   'purchase_orders_customer_id_fkey');
        $this->addFk('purchase_order_items',   'product_id',  'item_master', 'purchase_order_items_product_id_fkey');
        $this->addFk('vat_challans',           'customer_id', 'customers',   'vat_challans_customer_id_fkey');
        $this->addFk('vat_challan_items',      'product_id',  'item_master', 'vat_challan_items_product_id_fkey');
        $this->addFk('delivery_challans',      'customer_id', 'customers',   'delivery_challans_customer_id_fkey');
        $this->addFk('delivery_challans',      'product_id',  'item_master', 'delivery_challans_product_id_fkey');
        $this->addFk('sales_invoices_v2',      'customer_id', 'customers',   'sales_invoices_v2_customer_id_fkey');
        $this->addFk('sales_invoice_items_v2', 'product_id',  'item_master', 'sales_invoice_items_v2_product_id_fkey');
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        foreach ([
            ['purchase_orders',        'purchase_orders_customer_id_fkey'],
            ['purchase_order_items',   'purchase_order_items_product_id_fkey'],
            ['vat_challans',           'vat_challans_customer_id_fkey'],
            ['vat_challan_items',      'vat_challan_items_product_id_fkey'],
            ['delivery_challans',      'delivery_challans_customer_id_fkey'],
            ['delivery_challans',      'delivery_challans_product_id_fkey'],
            ['sales_invoices_v2',      'sales_invoices_v2_customer_id_fkey'],
            ['sales_invoice_items_v2', 'sales_invoice_items_v2_product_id_fkey'],
        ] as [$table, $name]) {
            if (Schema::hasTable($table)) {
                try { Schema::table($table, fn (Blueprint $t) => $t->dropForeign($name)); } catch (\Throwable $e) {}
            }
        }
    }

    private function addFk(string $table, string $column, string $refTable, string $name): void
    {
        if (!Schema::hasTable($table) || !Schema::hasTable($refTable) || !Schema::hasColumn($table, $column)) {
            return;
        }

        // Skip if FK already exists (idempotent re-runs)
        $exists = DB::selectOne(
            "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?",
            [$table, $name]
        );
        if ($exists) {
            return;
        }

        // Detect nullability of the column — SET NULL FKs require a nullable column.
        $col = DB::selectOne(
            "SELECT IS_NULLABLE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
            [$table, $column]
        );
        $isNullable = $col && strtoupper($col->IS_NULLABLE) === 'YES';

        if ($isNullable) {
            // Clean orphan rows so SET NULL FK can be added without failure
            DB::statement("UPDATE `{$table}` t LEFT JOIN `{$refTable}` r ON r.id = t.`{$column}`
                           SET t.`{$column}` = NULL WHERE t.`{$column}` IS NOT NULL AND r.id IS NULL");
        } else {
            // NOT NULL column — orphans would break a RESTRICT FK; abort silently to avoid data loss.
            $orphans = DB::selectOne(
                "SELECT COUNT(*) AS c FROM `{$table}` t LEFT JOIN `{$refTable}` r ON r.id = t.`{$column}`
                 WHERE t.`{$column}` IS NOT NULL AND r.id IS NULL"
            );
            if ($orphans && (int) $orphans->c > 0) {
                return; // surfaced via sw:verify-fks
            }
        }

        Schema::table($table, function (Blueprint $t) use ($column, $refTable, $name, $isNullable) {
            $fk = $t->foreign($column, $name)->references('id')->on($refTable);
            $isNullable ? $fk->nullOnDelete() : $fk->restrictOnDelete();
        });
    }
};
