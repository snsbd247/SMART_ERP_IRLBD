import { supabase } from "@/integrations/supabase/client";
import { nextDocNo, logAudit, createVoucherLaravel } from "@/lib/purchase-numbering";
import { isLaravelMode } from "@/lib/laravel-auth";

/**
 * Post purchase return: inventory out (stock_ledger) + JV Dr Payable / Cr Inventory (+VAT reversal).
 */
export async function postPurchaseReturn(ret: any, lines: any[], supplierTypeId?: string | null, userId?: string) {
  // 1) stock out
  for (const ln of lines) {
    if (!ln.item_id || !(ln.quantity > 0)) continue;
    const { data: prev } = await supabase
      .from("stock_ledger")
      .select("balance_quantity")
      .eq("item_id", ln.item_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const balance = Number(prev?.balance_quantity || 0) - Number(ln.quantity);
    await supabase.from("stock_ledger").insert({
      transaction_type: "PURCHASE_RETURN",
      transaction_id: ret.id,
      item_id: ln.item_id,
      branch_id: ret.branch_id,
      warehouse_id: ret.warehouse_id,
      quantity_in: 0,
      quantity_out: ln.quantity,
      balance_quantity: balance,
      unit_cost: ln.unit_cost,
      total_value: Number(ln.quantity) * Number(ln.unit_cost || 0),
      reference_number: ret.return_no,
      transaction_date: ret.return_date,
    } as any);
  }

  // 2) JV Dr Payable / Cr Inventory
  const { data: mapping } = await supabase
    .from("purchase_coa_mapping" as any)
    .select("*")
    .eq("is_active", true)
    .or(`purchase_type_id.eq.${supplierTypeId || "00000000-0000-0000-0000-000000000000"},purchase_type_id.is.null`)
    .order("purchase_type_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const m = mapping as any;
  let voucherId: string | null = null;
  if (m?.payable_account_id && m?.inventory_account_id) {
    const total = Number(ret.grand_total || 0);
    if (isLaravelMode()) {
      const entries: Array<{ account_id: string; debit: number; credit: number; narration?: string }> = [
        { account_id: m.payable_account_id, debit: total, credit: 0, narration: `Return ${ret.return_no}` },
        { account_id: m.inventory_account_id, debit: 0, credit: Number(ret.subtotal || 0), narration: "Inventory reversal" },
      ];
      if (Number(ret.vat_amount || 0) > 0 && m.vat_account_id) {
        entries.push({ account_id: m.vat_account_id, debit: 0, credit: ret.vat_amount, narration: "VAT reversal" });
      }
      const created = await createVoucherLaravel({
        prefix: "JV",
        voucher_date: ret.return_date,
        branch_id: ret.branch_id,
        description: `Purchase Return ${ret.return_no}`,
        entries,
      });
      voucherId = created.voucherId;
    } else {
      const voucherNo = await nextDocNo("JV", "acc_vouchers", "voucher_number");
      const { data: v } = await supabase.from("acc_vouchers").insert({
        voucher_number: voucherNo, voucher_type: "journal", voucher_date: ret.return_date,
        branch_id: ret.branch_id, description: `Purchase Return ${ret.return_no}`,
        total_amount: total, status: "posted", created_by: userId,
      } as any).select("id").single();
      if (v) {
        voucherId = (v as any).id;
        const entries: any[] = [
          { voucher_id: voucherId, account_id: m.payable_account_id, debit: total, credit: 0, sort_order: 1, narration: `Return ${ret.return_no}` },
          { voucher_id: voucherId, account_id: m.inventory_account_id, debit: 0, credit: Number(ret.subtotal || 0), sort_order: 2, narration: "Inventory reversal" },
        ];
        if (Number(ret.vat_amount || 0) > 0 && m.vat_account_id) {
          entries.push({ voucher_id: voucherId, account_id: m.vat_account_id, debit: 0, credit: ret.vat_amount, sort_order: 3, narration: "VAT reversal" });
        }
        await supabase.from("voucher_entries").insert(entries as any);
      }
    }
  }

  await supabase.from("purchase_returns_v2" as any).update({ voucher_id: voucherId, status: "posted" }).eq("id", ret.id);
  await logAudit({ document_type: "RETURN", document_id: ret.id, document_no: ret.return_no, action: "posted", performed_by: userId });
  return voucherId;
}
