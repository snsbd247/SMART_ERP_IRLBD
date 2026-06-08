import { supabase } from "@/integrations/supabase/client";
import { logCreate, logUpdate } from "@/lib/audit-utils";

async function audit(module: string, action: "create" | "update", record: any, details?: string) {
  try {
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id;
    if (action === "create") {
      await logCreate({ userId: uid, module, recordId: record?.id, newData: record, details });
    } else {
      await logUpdate({ userId: uid, module, recordId: record?.id, oldData: {}, newData: record, details: details || "status change" });
    }
  } catch { /* non-blocking */ }
}

// Helper to fetch the next document number from the number_sequences table.
async function nextNumber(prefix: string) {
  const year = new Date().getFullYear();
  const { data: seq } = await supabase
    .from("number_sequences")
    .select("*")
    .eq("prefix", prefix)
    .eq("year", year)
    .maybeSingle();
  let serial = 1;
  if (seq) {
    serial = (Number((seq as any).current_number) || 0) + 1;
    await supabase.from("number_sequences").update({ current_number: serial } as any).eq("id", (seq as any).id);
  } else {
    await supabase.from("number_sequences").insert([{ prefix, year, current_number: 1, description: prefix } as any]);
  }
  return `${prefix}-${year}-${String(serial).padStart(5, "0")}`;
}

export const swApi = {
  nextNumber,

  // -------- Purchase Orders --------
  async listPOs(filters: any = {}) {
    let q = supabase.from("purchase_orders").select("*, customer:customers(id,name), items:purchase_order_items(*)").is("deleted_at", null).order("po_date", { ascending: false });
    if (filters.customer_id) q = q.eq("customer_id", filters.customer_id);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.q) q = q.ilike("po_number", `%${filters.q}%`);
    return q;
  },
  async getPO(id: string) {
    return supabase.from("purchase_orders").select("*, customer:customers(*), items:purchase_order_items(*, product:item_master(id,name:item_name,sku:item_code))").eq("id", id).maybeSingle();
  },
  async createPO(payload: any, items: any[]) {
    const po_number = await nextNumber("PO");
    const subtotal = items.reduce((s, i) => s + Number(i.qty_ordered) * Number(i.rate), 0);
    const vat_amount = items.reduce((s, i) => s + Number(i.qty_ordered) * Number(i.rate) * (Number(i.vat_pct || 0) / 100), 0);
    const { data: po, error } = await supabase
      .from("purchase_orders")
      .insert({ ...payload, po_number, subtotal, vat_amount, grand_total: subtotal + vat_amount, status: "open" })
      .select()
      .single();
    if (error || !po) return { data: null, error };
    const rows = items.map((i) => ({
      po_id: po.id,
      product_id: i.product_id,
      qty_ordered: i.qty_ordered,
      qty_remaining: i.qty_ordered,
      rate: i.rate,
      vat_pct: i.vat_pct || 0,
      line_total: Number(i.qty_ordered) * Number(i.rate),
    }));
    await supabase.from("purchase_order_items").insert(rows);
    await audit("purchase_orders", "create", po, `PO ${po.po_number}`);
    return { data: po, error: null };
  },

  // -------- Dispatch --------
  async listDispatches(filters: any = {}) {
    let q = supabase.from("dispatches").select("*, customer:customers(id,name)").order("dispatch_date", { ascending: false });
    if (filters.customer_id) q = q.eq("customer_id", filters.customer_id);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.q) q = q.ilike("dispatch_number", `%${filters.q}%`);
    return q;
  },
  async getDispatch(id: string) {
    return supabase.from("dispatches").select("*, customer:customers(*), items:dispatch_items(*, allocations:dispatch_po_allocations(*, po_item:purchase_order_items(*, po:purchase_orders(po_number))), product:item_master(name:item_name,sku:item_code))").eq("id", id).maybeSingle();
  },
  async createDispatch(payload: any, items: any[]) {
    const dispatch_number = await nextNumber("DSP");
    const total_qty = items.reduce((s, i) => s + Number(i.qty || 0), 0);
    const { data: d, error } = await supabase.from("dispatches").insert({ ...payload, dispatch_number, total_qty, status: "draft" }).select().single();
    if (error || !d) return { data: null, error };
    for (const it of items) {
      const { data: di } = await supabase.from("dispatch_items").insert({
        dispatch_id: d.id, product_id: it.product_id, qty: it.qty,
      }).select().single();
      if (!di) continue;
      const allocs = (it.allocations || []).map((a: any) => ({
        dispatch_item_id: di.id, po_item_id: a.po_item_id, allocated_qty: a.allocated_qty,
      }));
      if (allocs.length) await supabase.from("dispatch_po_allocations").insert(allocs);
      // decrement PO remaining
      for (const a of it.allocations || []) {
        const { data: poi } = await supabase.from("purchase_order_items").select("qty_remaining,qty_delivered").eq("id", a.po_item_id).maybeSingle();
        if (poi) {
          await supabase.from("purchase_order_items").update({
            qty_remaining: Number(poi.qty_remaining) - Number(a.allocated_qty),
            qty_delivered: Number(poi.qty_delivered) + Number(a.allocated_qty),
          }).eq("id", a.po_item_id);
        }
      }
    }
    await audit("dispatch", "create", d, `Dispatch ${d.dispatch_number}`);
    return { data: d, error: null };
  },
  async setDispatchStatus(id: string, status: string, userId?: string) {
    const { data: cur } = await supabase.from("dispatches").select("status").eq("id", id).maybeSingle();
    await supabase.from("dispatches").update({ status }).eq("id", id);
    await supabase.from("dispatch_status_logs").insert({ dispatch_id: id, old_status: cur?.status, new_status: status, changed_by: userId });
    await audit("dispatch", "update", { id, status }, `${cur?.status} → ${status}`);
    return { data: { id, status }, error: null };
  },

  // -------- VAT Challan --------
  async listVatChallans(filters: any = {}) {
    let q = supabase.from("vat_challans").select("*, customer:customers(id,name)").is("deleted_at", null).order("challan_date", { ascending: false });
    if (filters.customer_id) q = q.eq("customer_id", filters.customer_id);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.q) q = q.ilike("challan_number", `%${filters.q}%`);
    return q;
  },
  async getVatChallan(id: string) {
    return supabase.from("vat_challans").select("*, customer:customers(*), items:vat_challan_items(*, product:item_master(name:item_name,sku:item_code)), delivery_challans:delivery_challans(*)").eq("id", id).maybeSingle();
  },
  async createVatChallan(payload: any, items: any[]) {
    const challan_number = await nextNumber("VCH");
    const subtotal = items.reduce((s, i) => s + Number(i.qty) * Number(i.rate), 0);
    const vat_amount = items.reduce((s, i) => s + Number(i.qty) * Number(i.rate) * (Number(i.vat_pct || 0) / 100), 0);
    const { data: v, error } = await supabase.from("vat_challans").insert({
      ...payload, challan_number, subtotal, vat_amount, grand_total: subtotal + vat_amount, status: "issued",
    }).select().single();
    if (error || !v) return { data: null, error };
    const itemRows = items.map((i) => ({
      vat_challan_id: v.id, product_id: i.product_id, qty: i.qty, rate: i.rate,
      vat_pct: i.vat_pct || 0,
      vat_amount: Number(i.qty) * Number(i.rate) * (Number(i.vat_pct || 0) / 100),
      line_total: Number(i.qty) * Number(i.rate) * (1 + Number(i.vat_pct || 0) / 100),
    }));
    const { data: insertedItems } = await supabase.from("vat_challan_items").insert(itemRows).select();
    // Auto-create DCs per item
    for (const ii of insertedItems || []) {
      const dc_number = await nextNumber("DC");
      await supabase.from("delivery_challans").insert({
        dc_number, dc_date: payload.challan_date,
        vat_challan_id: v.id, vat_challan_item_id: ii.id,
        product_id: ii.product_id, qty: ii.qty,
        customer_id: payload.customer_id, status: "issued", branch_id: payload.branch_id,
      });
    }
    await audit("vat_challan", "create", v, `Mushak 6.3 ${v.challan_number}`);
    return { data: v, error: null };
  },


  // -------- Delivery Challans --------
  async listDeliveryChallans(filters: any = {}) {
    let q = supabase.from("delivery_challans").select("*, customer:customers(id,name), product:item_master(name:item_name,sku:item_code), vat_challan:vat_challans(challan_number)").order("dc_date", { ascending: false });
    if (filters.customer_id) q = q.eq("customer_id", filters.customer_id);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.q) q = q.ilike("dc_number", `%${filters.q}%`);
    return q;
  },
  async customerReceive(dcId: string, payload: any) {
    await supabase.from("customer_receives").insert({ delivery_challan_id: dcId, ...payload });
    await supabase.from("delivery_challans").update({ status: "customer_received" }).eq("id", dcId);
  },
  async hoReceive(dcId: string, payload: any) {
    await supabase.from("ho_receives").insert({ delivery_challan_id: dcId, ...payload });
    await supabase.from("delivery_challans").update({ status: "ho_received" }).eq("id", dcId);
  },
  async setDCStatus(id: string, status: string) {
    return supabase.from("delivery_challans").update({ status }).eq("id", id);
  },

  // -------- Invoice V2 --------
  async listInvoices(filters: any = {}) {
    let q = supabase.from("sales_invoices_v2").select("*, customer:customers(id,name)").is("deleted_at", null).order("invoice_date", { ascending: false });
    if (filters.customer_id) q = q.eq("customer_id", filters.customer_id);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.q) q = q.ilike("invoice_number", `%${filters.q}%`);
    return q;
  },
  async getInvoice(id: string) {
    return supabase.from("sales_invoices_v2").select("*, customer:customers(*), items:sales_invoice_items_v2(*, product:item_master(name:item_name,sku:item_code)), payments:invoice_payments(*), tds_entries(*)").eq("id", id).maybeSingle();
  },
  async eligibleVatChallans(customer_id?: string, date?: string) {
    // VAT challans whose ALL delivery_challans are ho_received and not invoiced
    let q = supabase.from("vat_challans").select("*, customer:customers(id,name), delivery_challans:delivery_challans(id,status), items:vat_challan_items(*)").neq("status", "invoiced").is("deleted_at", null);
    if (customer_id) q = q.eq("customer_id", customer_id);
    if (date) q = q.eq("challan_date", date);
    const { data, error } = await q;
    if (error || !data) return { data: [], error };
    const filtered = data.filter((v: any) =>
      v.delivery_challans?.length && v.delivery_challans.every((d: any) => d.status === "ho_received")
    );
    return { data: filtered, error: null };
  },
  async createInvoice(payload: { invoice_date: string; customer_id: string; mode: string; branch_id?: string; notes?: string }, vatChallanIds: string[]) {
    const invoice_number = await nextNumber("INV");
    // Gather all items
    const { data: items } = await supabase.from("vat_challan_items").select("*").in("vat_challan_id", vatChallanIds);
    const subtotal = (items || []).reduce((s, i: any) => s + Number(i.qty) * Number(i.rate), 0);
    const vat_total = (items || []).reduce((s, i: any) => s + Number(i.vat_amount || 0), 0);
    const grand_total = subtotal + vat_total;
    const { data: inv, error } = await supabase.from("sales_invoices_v2").insert({
      invoice_number, invoice_date: payload.invoice_date, customer_id: payload.customer_id,
      mode: payload.mode, subtotal, vat_total, grand_total, due_amount: grand_total,
      status: "posted", branch_id: payload.branch_id, notes: payload.notes,
    }).select().single();
    if (error || !inv) return { data: null, error };
    const invItems = (items || []).map((i: any, idx: number) => {
      const qty = Number(i.qty || 0);
      const rate = Number(i.rate || 0);
      const line_subtotal = Number(i.line_subtotal ?? qty * rate);
      const vat_amount = Number(i.vat_amount ?? line_subtotal * Number(i.vat_pct || 0) / 100);
      const line_total = Number(i.line_total ?? line_subtotal + vat_amount);
      return {
        invoice_id: inv.id, product_id: i.product_id, qty, rate,
        vat_pct: Number(i.vat_pct || 0), line_subtotal, vat_amount, line_total,
        source_vat_challan_item_id: i.id, sort_order: idx,
      };
    });
    if (invItems.length) {
      const { error: itemsErr } = await supabase.from("sales_invoice_items_v2").insert(invItems);
      if (itemsErr) {
        await supabase.from("sales_invoices_v2").delete().eq("id", inv.id);
        return { data: null, error: itemsErr };
      }
    }
    const { error: chErr } = await supabase.from("invoice_challans").insert(vatChallanIds.map((vcId) => ({ invoice_id: inv.id, vat_challan_id: vcId })));
    if (chErr) {
      await supabase.from("sales_invoices_v2").delete().eq("id", inv.id);
      return { data: null, error: chErr };
    }
    await supabase.from("vat_challans").update({ status: "invoiced" }).in("id", vatChallanIds);
    await supabase.from("delivery_challans").update({ status: "invoiced" }).in("vat_challan_id", vatChallanIds);
    await audit("invoice_processing", "create", inv, `Invoice ${inv.invoice_number}`);
    return { data: inv, error: null };
  },
  async recordPayment(invoiceId: string, payload: any) {
    const payment_number = await nextNumber("RCP");
    const total_settled = Number(payload.amount_received || 0) + Number(payload.tds_amount || 0);
    const { data: p, error } = await supabase.from("invoice_payments").insert({
      invoice_id: invoiceId, payment_number, ...payload, total_settled,
    }).select().single();
    if (error || !p) return { data: null, error };
    if (payload.tds_amount && Number(payload.tds_amount) > 0) {
      const tds_number = await nextNumber("TDS");
      await supabase.from("tds_entries").insert({
        invoice_id: invoiceId, payment_id: p.id,
        tds_number, tds_amount: payload.tds_amount,
        tds_pct: payload.tds_pct || 0,
        certificate_no: payload.tds_certificate_no,
        certificate_date: payload.tds_certificate_date,
      });
    }
    // Update invoice paid/due
    const { data: inv } = await supabase.from("sales_invoices_v2").select("paid_amount,tds_amount,grand_total").eq("id", invoiceId).maybeSingle();
    if (inv) {
      const paid = Number(inv.paid_amount || 0) + Number(payload.amount_received || 0);
      const tds = Number(inv.tds_amount || 0) + Number(payload.tds_amount || 0);
      const due = Number(inv.grand_total) - paid - tds;
      await supabase.from("sales_invoices_v2").update({
        paid_amount: paid, tds_amount: tds, due_amount: due,
        status: due <= 0 ? "paid" : "partially_paid",
      }).eq("id", invoiceId);
    }
    await audit("invoice_processing", "create", p, `Payment ${p.payment_number} (TDS ${payload.tds_amount || 0})`);
    return { data: p, error: null };
  },
  async listTds(filters: any = {}) {
    let q = supabase.from("tds_entries").select("*, invoice:sales_invoices_v2(invoice_number, customer:customers(name))").order("created_at", { ascending: false });
    if (filters.from) q = q.gte("created_at", filters.from);
    if (filters.to) q = q.lte("created_at", filters.to);
    return q;
  },

  // -------- Update / Delete helpers --------
  async updatePO(id: string, payload: any, items: any[]) {
    const subtotal = items.reduce((s, i) => s + Number(i.qty_ordered) * Number(i.rate), 0);
    const vat_amount = items.reduce((s, i) => s + Number(i.qty_ordered) * Number(i.rate) * (Number(i.vat_pct || 0) / 100), 0);
    const { error } = await supabase.from("purchase_orders").update({ ...payload, subtotal, vat_amount, grand_total: subtotal + vat_amount }).eq("id", id);
    if (error) return { data: null, error };
    const { data: existing } = await supabase.from("purchase_order_items").select("id,qty_delivered").eq("po_id", id);
    if ((existing || []).some((it: any) => Number(it.qty_delivered) > 0)) {
      return { data: null, error: { message: "Cannot edit items after dispatch started." } as any };
    }
    await supabase.from("purchase_order_items").delete().eq("po_id", id);
    const rows = items.map((i) => ({
      po_id: id, product_id: i.product_id, qty_ordered: i.qty_ordered, qty_remaining: i.qty_ordered,
      rate: i.rate, vat_pct: i.vat_pct || 0, line_total: Number(i.qty_ordered) * Number(i.rate),
    }));
    await supabase.from("purchase_order_items").insert(rows);
    await audit("purchase_orders", "update", { id }, "edit");
    return { data: { id }, error: null };
  },
  async deletePO(id: string) {
    const { error } = await supabase.from("purchase_orders").update({ deleted_at: new Date().toISOString() } as any).eq("id", id);
    await audit("purchase_orders", "update", { id }, "delete");
    return { error };
  },

  async updateDispatchHeader(id: string, payload: any) {
    const { error } = await supabase.from("dispatches").update(payload).eq("id", id);
    await audit("dispatch", "update", { id }, "edit");
    return { error };
  },
  async deleteDispatch(id: string) {
    const { data: items } = await supabase.from("dispatch_items").select("id, allocations:dispatch_po_allocations(po_item_id, allocated_qty)").eq("dispatch_id", id);
    for (const it of items || []) {
      for (const a of (it as any).allocations || []) {
        const { data: poi } = await supabase.from("purchase_order_items").select("qty_remaining,qty_delivered").eq("id", a.po_item_id).maybeSingle();
        if (poi) {
          await supabase.from("purchase_order_items").update({
            qty_remaining: Number(poi.qty_remaining) + Number(a.allocated_qty),
            qty_delivered: Math.max(0, Number(poi.qty_delivered) - Number(a.allocated_qty)),
          }).eq("id", a.po_item_id);
        }
      }
    }
    const { error } = await supabase.from("dispatches").update({ deleted_at: new Date().toISOString() } as any).eq("id", id);
    await audit("dispatch", "update", { id }, "delete");
    return { error };
  },

  async updateVatChallanHeader(id: string, payload: any) {
    const { error } = await supabase.from("vat_challans").update(payload).eq("id", id);
    await audit("vat_challan", "update", { id }, "edit");
    return { error };
  },
  async deleteVatChallan(id: string) {
    const { data: dcs } = await supabase.from("delivery_challans").select("id,status").eq("vat_challan_id", id);
    if ((dcs || []).some((d: any) => ["customer_received", "ho_received", "invoiced"].includes(d.status))) {
      return { error: { message: "Cannot delete: DC already received/invoiced" } as any };
    }
    await supabase.from("delivery_challans").delete().eq("vat_challan_id", id);
    const { error } = await supabase.from("vat_challans").update({ deleted_at: new Date().toISOString() } as any).eq("id", id);
    await audit("vat_challan", "update", { id }, "delete");
    return { error };
  },

  async deleteDeliveryChallan(id: string) {
    const { data: dc } = await supabase.from("delivery_challans").select("status").eq("id", id).maybeSingle();
    if (dc && ["invoiced"].includes((dc as any).status)) return { error: { message: "Cannot delete invoiced DC" } as any };
    const { error } = await supabase.from("delivery_challans").delete().eq("id", id);
    return { error };
  },

  async deleteInvoice(id: string) {
    const { data: inv } = await supabase.from("sales_invoices_v2").select("paid_amount,tds_amount").eq("id", id).maybeSingle();
    if (inv && (Number((inv as any).paid_amount) > 0 || Number((inv as any).tds_amount) > 0)) {
      return { error: { message: "Cannot delete invoice with payments/TDS recorded" } as any };
    }
    const { data: links } = await supabase.from("invoice_challans").select("vat_challan_id").eq("invoice_id", id);
    const vcIds = (links || []).map((l: any) => l.vat_challan_id);
    if (vcIds.length) {
      await supabase.from("vat_challans").update({ status: "issued" }).in("id", vcIds);
      await supabase.from("delivery_challans").update({ status: "ho_received" }).in("vat_challan_id", vcIds);
    }
    await supabase.from("invoice_challans").delete().eq("invoice_id", id);
    const { error } = await supabase.from("sales_invoices_v2").update({ deleted_at: new Date().toISOString() } as any).eq("id", id);
    await audit("invoice_processing", "update", { id }, "delete");
    return { error };
  },

  async listCustomerReceives() {
    return supabase.from("customer_receives").select("*, dc:delivery_challans(id,dc_number, customer:customers(name))").order("created_at", { ascending: false });
  },
  async listHoReceives() {
    return supabase.from("ho_receives").select("*, dc:delivery_challans(id,dc_number, customer:customers(name))").order("created_at", { ascending: false });
  },
  async deleteCustomerReceive(id: string, dcId: string) {
    await supabase.from("customer_receives").delete().eq("id", id);
    await supabase.from("delivery_challans").update({ status: "delivered" }).eq("id", dcId);
    return { error: null };
  },
  async deleteHoReceive(id: string, dcId: string) {
    await supabase.from("ho_receives").delete().eq("id", id);
    await supabase.from("delivery_challans").update({ status: "sent_to_ho" }).eq("id", dcId);
    return { error: null };
  },

  async deleteTds(id: string) {
    const { error } = await supabase.from("tds_entries").delete().eq("id", id);
    return { error };
  },

  // -------- Bill Submit (customer HO) --------
  async submitBill(invoiceId: string, payload: { bill_submitted_at: string; payment_terms_days?: number; bill_submission_ref?: string }) {
    const days = Number(payload.payment_terms_days ?? 30);
    const submittedAt = payload.bill_submitted_at;
    const dueDate = new Date(submittedAt);
    dueDate.setDate(dueDate.getDate() + days);
    const bill_due_date = dueDate.toISOString().slice(0, 10);
    const { data: cur } = await supabase.from("sales_invoices_v2").select("status").eq("id", invoiceId).maybeSingle();
    const newStatus = (cur as any)?.status === "posted" ? "bill_submitted" : (cur as any)?.status;
    const { error } = await supabase.from("sales_invoices_v2").update({
      bill_submitted_at: submittedAt,
      bill_due_date,
      payment_terms_days: days,
      bill_submission_ref: payload.bill_submission_ref ?? null,
      status: newStatus,
    } as any).eq("id", invoiceId);
    if (error) return { error };
    await supabase.from("invoice_status_logs").insert({
      invoice_id: invoiceId,
      new_status: "bill_submitted",
      notes: `Bill submitted to customer HO (ref: ${payload.bill_submission_ref ?? "-"}). Due in ${days} days (${bill_due_date}).`,
    } as any);
    await audit("invoice_processing", "update", { id: invoiceId }, `Bill submitted, due ${bill_due_date}`);
    return { error: null };
  },
};
