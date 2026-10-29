import { dataClient } from "@/integrations/data/client";
import { nextDocNo, logAudit, createVoucherLaravel } from "@/lib/purchase-numbering";
import { isLaravelMode } from "@/lib/laravel-auth";

/**
 * Post supplier bill to GL: Dr GRN Clearing (or Expense) / Cr Payable, plus VAT/AIT splits.
 * Returns voucher_id (or null if mapping absent).
 */
export async function postSupplierBill(bill: any, supplierTypeId?: string | null, userId?: string) {
  const { data: mapping } = await dataClient
    .from("purchase_coa_mapping" as any)
    .select("*")
    .eq("is_active", true)
    .or(`purchase_type_id.eq.${supplierTypeId || "00000000-0000-0000-0000-000000000000"},purchase_type_id.is.null`)
    .order("purchase_type_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const m = mapping as any;
  if (!m?.payable_account_id || !(m?.grn_clearing_account_id || m?.expense_account_id)) return null;

  const drAcct = m.grn_clearing_account_id || m.expense_account_id;
  const sub = Number(bill.subtotal || 0) - Number(bill.discount_amount || 0);
  const vat = Number(bill.vat_amount || 0);
  const ait = Number(bill.ait_amount || 0);
  const other = Number(bill.other_charges || 0);
  const total = Number(bill.grand_total || 0);

  let voucherId: string;
  let voucherNo: string;
  if (isLaravelMode()) {
    const entries: Array<{ account_id: string; debit: number; credit: number; narration?: string }> = [
      { account_id: drAcct, debit: sub + other, credit: 0, narration: `Bill ${bill.bill_no}` },
    ];
    if (vat > 0 && m.vat_account_id) entries.push({ account_id: m.vat_account_id, debit: vat, credit: 0, narration: "VAT" });
    entries.push({ account_id: m.payable_account_id, debit: 0, credit: total + ait, narration: `Payable to supplier` });
    const created = await createVoucherLaravel({
      prefix: "JV",
      voucher_date: bill.bill_date,
      branch_id: bill.branch_id,
      description: `Supplier Bill ${bill.bill_no}`,
      entries,
    });
    voucherId = created.voucherId;
    voucherNo = created.voucherNumber;
  } else {
    voucherNo = await nextDocNo("JV", "acc_vouchers", "voucher_number");
    const { data: v, error: ve } = await dataClient
      .from("acc_vouchers")
      .insert({
        voucher_number: voucherNo,
        voucher_type: "journal",
        voucher_date: bill.bill_date,
        branch_id: bill.branch_id,
        description: `Supplier Bill ${bill.bill_no}`,
        total_amount: total,
        status: "posted",
        created_by: userId,
      } as any)
      .select("id")
      .single();
    if (ve || !v) return null;
    voucherId = (v as any).id;

    const entries: any[] = [
      { voucher_id: voucherId, account_id: drAcct, debit: sub + other, credit: 0, sort_order: 1, narration: `Bill ${bill.bill_no}` },
    ];
    if (vat > 0 && m.vat_account_id) entries.push({ voucher_id: voucherId, account_id: m.vat_account_id, debit: vat, credit: 0, sort_order: 2, narration: "VAT" });
    entries.push({ voucher_id: voucherId, account_id: m.payable_account_id, debit: 0, credit: total + ait, sort_order: 3, narration: `Payable to supplier` });
    if (ait > 0 && m.ait_account_id) entries.push({ voucher_id: voucherId, account_id: m.ait_account_id, debit: 0, credit: 0, sort_order: 4, narration: "AIT (info)" });

    await dataClient.from("voucher_entries").insert(entries as any);
  }

  await dataClient.from("supplier_bills_v2" as any).update({ voucher_id: voucherId, status: "posted" }).eq("id", bill.id);
  await logAudit({ document_type: "BILL", document_id: bill.id, document_no: bill.bill_no, action: "posted", notes: `JV ${voucherNo}`, performed_by: userId });
  return voucherId;
}

/**
 * Post supplier payment to GL: Dr Payable / Cr Cash/Bank.
 * Allocates payment to bills FIFO (oldest first) until amount exhausted.
 */
export async function postSupplierPayment(payment: any, userId?: string) {
  const { data: mapping } = await dataClient
    .from("purchase_coa_mapping" as any)
    .select("*")
    .eq("is_active", true)
    .is("purchase_type_id", null)
    .limit(1)
    .maybeSingle();
  const m = mapping as any;
  const crAcct = payment.payment_method === "bank" || payment.payment_method === "cheque" ? m?.bank_account_id : m?.cash_account_id;
  if (!m?.payable_account_id || !crAcct) return null;

  const total = Number(payment.amount || 0);
  let voucherId: string;
  let voucherNo: string;
  if (isLaravelMode()) {
    const created = await createVoucherLaravel({
      prefix: "PV",
      voucher_date: payment.payment_date,
      branch_id: payment.branch_id,
      description: `Supplier Payment ${payment.payment_no}`,
      entries: [
        { account_id: m.payable_account_id, debit: total, credit: 0, narration: `Payment ${payment.payment_no}` },
        { account_id: crAcct, debit: 0, credit: total, narration: payment.payment_method },
      ],
    });
    voucherId = created.voucherId;
    voucherNo = created.voucherNumber;
  } else {
    voucherNo = await nextDocNo("PV", "acc_vouchers", "voucher_number");
    const { data: v, error: ve } = await dataClient
      .from("acc_vouchers")
      .insert({
        voucher_number: voucherNo,
        voucher_type: "payment",
        voucher_date: payment.payment_date,
        branch_id: payment.branch_id,
        description: `Supplier Payment ${payment.payment_no}`,
        total_amount: total,
        status: "posted",
        created_by: userId,
      } as any)
      .select("id")
      .single();
    if (ve || !v) return null;
    voucherId = (v as any).id;

    await dataClient.from("voucher_entries").insert([
      { voucher_id: voucherId, account_id: m.payable_account_id, debit: total, credit: 0, sort_order: 1, narration: `Payment ${payment.payment_no}` },
      { voucher_id: voucherId, account_id: crAcct, debit: 0, credit: total, sort_order: 2, narration: payment.payment_method },
    ] as any);
  }

  await dataClient.from("supplier_payments_v2" as any).update({ voucher_id: voucherId, status: "posted" }).eq("id", payment.id);
  await logAudit({ document_type: "PAYMENT", document_id: payment.id, document_no: payment.payment_no, action: "posted", notes: `PV ${voucherNo}`, performed_by: userId });
  return voucherId;
}

/** Auto-allocate payment FIFO across unpaid bills for the same supplier. */
export async function autoAllocatePayment(paymentId: string, supplierId: string, amount: number) {
  const { data: bills } = await dataClient
    .from("supplier_bills_v2" as any)
    .select("id,grand_total,paid_amount,bill_date")
    .eq("supplier_id", supplierId)
    .in("status", ["posted", "partially_paid"])
    .order("bill_date", { ascending: true });
  let remaining = amount;
  for (const b of (bills || []) as any[]) {
    if (remaining <= 0) break;
    const due = Number(b.grand_total) - Number(b.paid_amount || 0);
    if (due <= 0) continue;
    const alloc = Math.min(due, remaining);
    await dataClient.from("supplier_payment_allocations" as any).insert({ payment_id: paymentId, bill_id: b.id, allocated_amount: alloc });
    const newPaid = Number(b.paid_amount || 0) + alloc;
    await dataClient.from("supplier_bills_v2" as any).update({
      paid_amount: newPaid,
      status: newPaid >= Number(b.grand_total) ? "paid" : "partially_paid",
    }).eq("id", b.id);
    remaining -= alloc;
  }
  await dataClient.from("supplier_payments_v2" as any).update({ allocated_amount: amount - remaining }).eq("id", paymentId);
}
