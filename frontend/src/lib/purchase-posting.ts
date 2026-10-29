import { dataClient } from "@/integrations/data/client";
import { nextDocNo, logAudit, createVoucherLaravel } from "@/lib/purchase-numbering";
import { isLaravelMode } from "@/lib/laravel-auth";

/**
 * Post a GRN to inventory + accounting.
 * - Inserts stock_ledger rows (quantity_in) for each accepted line.
 * - Creates an accounting voucher: Dr Inventory / Cr GRN Clearing (per purchase_coa_mapping).
 * Returns voucher_id (or null if accounts not mapped).
 */
export async function postGrn(grn: any, lines: any[], po: any | null, userId?: string) {
  // 1) Stock ledger entries (only accepted_qty > 0 and stock items)
  for (const ln of lines) {
    if (!ln.item_id || !(ln.accepted_qty > 0)) continue;
    const { data: prev } = await dataClient
      .from("stock_ledger")
      .select("balance_quantity")
      .eq("item_id", ln.item_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const balance = Number(prev?.balance_quantity || 0) + Number(ln.accepted_qty);
    await dataClient.from("stock_ledger").insert({
      transaction_type: "GRN",
      transaction_id: grn.id,
      item_id: ln.item_id,
      branch_id: grn.branch_id,
      warehouse_id: grn.warehouse_id,
      quantity_in: ln.accepted_qty,
      quantity_out: 0,
      balance_quantity: balance,
      unit_cost: ln.unit_cost,
      total_value: Number(ln.accepted_qty) * Number(ln.unit_cost || 0),
      reference_number: grn.grn_no,
      transaction_date: grn.grn_date,
    } as any);
  }

  // 2) Journal voucher (Dr Inventory / Cr GRN Clearing) — needs mapping
  let voucherId: string | null = null;
  if (grn.auto_post) {
    const { data: mapping } = await dataClient
      .from("purchase_coa_mapping" as any)
      .select("*")
      .eq("is_active", true)
      .or(`purchase_type_id.eq.${po?.purchase_type_id || "00000000-0000-0000-0000-000000000000"},purchase_type_id.is.null`)
      .order("purchase_type_id", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const m = mapping as any;
    if (m?.inventory_account_id && m?.grn_clearing_account_id) {
      const total = Number(grn.grand_total || 0);
      if (isLaravelMode()) {
        const created = await createVoucherLaravel({
          prefix: "JV",
          voucher_date: grn.grn_date,
          branch_id: grn.branch_id,
          description: `Auto-posted from GRN ${grn.grn_no}`,
          entries: [
            { account_id: m.inventory_account_id, debit: total, credit: 0, narration: `GRN ${grn.grn_no}` },
            { account_id: m.grn_clearing_account_id, debit: 0, credit: total, narration: `GRN ${grn.grn_no}` },
          ],
        });
        voucherId = created.voucherId;
      } else {
        const voucherNo = await nextDocNo("JV", "acc_vouchers", "voucher_number");
        const { data: v, error: ve } = await dataClient
          .from("acc_vouchers")
          .insert({
            voucher_number: voucherNo,
            voucher_type: "journal",
            voucher_date: grn.grn_date,
            branch_id: grn.branch_id,
            description: `Auto-posted from GRN ${grn.grn_no}`,
            total_amount: total,
            status: "posted",
            created_by: userId,
          } as any)
          .select("id")
          .single();
        if (!ve && v) {
          voucherId = (v as any).id;
          await dataClient.from("voucher_entries").insert([
            { voucher_id: voucherId, account_id: m.inventory_account_id, debit: total, credit: 0, sort_order: 1, narration: `GRN ${grn.grn_no}` },
            { voucher_id: voucherId, account_id: m.grn_clearing_account_id, debit: 0, credit: total, sort_order: 2, narration: `GRN ${grn.grn_no}` },
          ] as any);
        }
      }
    }
  }

  // 3) Update PO received quantities (if linked)
  if (po?.id) {
    for (const ln of lines) {
      if (!ln.po_item_id) continue;
      const { data: poi } = await dataClient
        .from("purchase_order_items_v2" as any)
        .select("received_qty,quantity")
        .eq("id", ln.po_item_id)
        .maybeSingle();
      if (poi) {
        const newRecv = Number((poi as any).received_qty || 0) + Number(ln.accepted_qty || 0);
        await dataClient
          .from("purchase_order_items_v2" as any)
          .update({ received_qty: newRecv })
          .eq("id", ln.po_item_id);
      }
    }
    // Update PO status
    const { data: allItems } = await dataClient
      .from("purchase_order_items_v2" as any)
      .select("quantity,received_qty")
      .eq("po_id", po.id);
    const fully = (allItems || []).every((i: any) => Number(i.received_qty) >= Number(i.quantity));
    const any = (allItems || []).some((i: any) => Number(i.received_qty) > 0);
    await dataClient
      .from("purchase_orders_v2" as any)
      .update({ status: fully ? "closed" : any ? "partially_received" : po.status })
      .eq("id", po.id);
  }

  // 4) Audit
  await logAudit({
    document_type: "GRN",
    document_id: grn.id,
    document_no: grn.grn_no,
    action: "approved",
    notes: voucherId ? `Posted JV ${voucherId}` : "Inventory posted",
    performed_by: userId,
  });

  return voucherId;
}
