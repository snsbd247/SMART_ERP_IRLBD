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

async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

async function resolveAccount(name: string, fallbackNames: string[] = []) {
  const names = [name, ...fallbackNames];
  for (const accountName of names) {
    const { data } = await supabase
      .from("chart_of_accounts")
      .select("id,account_name")
      .ilike("account_name", accountName)
      .eq("is_active", true)
      .order("account_code", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return data as any;
  }
  return null;
}

async function createApprovedVoucher(params: {
  voucherPrefix: "JV" | "RV";
  voucherType: "journal" | "receipt";
  voucherDate: string;
  description: string;
  branchId?: string | null;
  financialYearId?: string | null;
  entries: Array<{ account_id: string; debit: number; credit: number; narration: string }>;
}) {
  const debit = params.entries.reduce((s, e) => s + Number(e.debit || 0), 0);
  const credit = params.entries.reduce((s, e) => s + Number(e.credit || 0), 0);
  if (Math.abs(debit - credit) > 0.01 || debit <= 0) return null;
  const uid = await getCurrentUserId();
  const { data: voucher, error } = await supabase.from("acc_vouchers").insert({
    voucher_number: await nextNumber(params.voucherPrefix),
    voucher_type: params.voucherType,
    voucher_date: params.voucherDate,
    description: params.description,
    total_amount: debit,
    status: "approved",
    branch_id: params.branchId ?? null,
    financial_year_id: params.financialYearId ?? null,
    created_by: uid,
    approved_by: uid,
    approved_at: new Date().toISOString(),
  } as any).select().single();
  if (error || !voucher) return null;
  const { error: entryError } = await supabase.from("voucher_entries").insert(
    params.entries.map((entry, index) => ({ ...entry, voucher_id: (voucher as any).id, sort_order: index }))
  );
  if (entryError) {
    await supabase.from("acc_vouchers").delete().eq("id", (voucher as any).id);
    return null;
  }
  return voucher as any;
}

async function postSalesInvoiceVoucher(invoice: any) {
  const ar = await resolveAccount("Accounts Receivable");
  const sales = await resolveAccount("Sales Revenue", ["Sales"]);
  const vat = await resolveAccount("VAT Payable", ["VAT Payable (Output VAT)"]);
  if (!ar || !sales || !vat) return null;
  const entries = [
    { account_id: ar.id, debit: Number(invoice.grand_total || 0), credit: 0, narration: `Invoice ${invoice.invoice_number}` },
    { account_id: sales.id, debit: 0, credit: Number(invoice.subtotal || 0), narration: `Sales ${invoice.invoice_number}` },
  ];
  if (Number(invoice.vat_total || 0) > 0) {
    entries.push({ account_id: vat.id, debit: 0, credit: Number(invoice.vat_total || 0), narration: `VAT on ${invoice.invoice_number}` });
  }
  return createApprovedVoucher({
    voucherPrefix: "JV",
    voucherType: "journal",
    voucherDate: invoice.invoice_date,
    description: `Sales Invoice ${invoice.invoice_number}`,
    branchId: invoice.branch_id,
    financialYearId: invoice.financial_year_id,
    entries,
  });
}

async function postInvoicePaymentVoucher(payment: any, invoice: any) {
  const bank = payment.mode === "cash"
    ? await resolveAccount("Cash in Hand", ["Cash"])
    : await resolveAccount("Bank Account", ["%Bank%A/C%", "%Bank%Current%", "%Bank%Savings%", "%Bank%"]);
  const ar = await resolveAccount("Accounts Receivable");
  const tds = await resolveAccount("TDS Receivable");
  if (!bank || !ar) return null;
  const entries: Array<{ account_id: string; debit: number; credit: number; narration: string }> = [];
  if (Number(payment.amount_received || 0) > 0) {
    entries.push({ account_id: bank.id, debit: Number(payment.amount_received || 0), credit: 0, narration: `Receipt ${payment.payment_number}` });
  }
  if (Number(payment.tds_amount || 0) > 0 && tds) {
    entries.push({ account_id: tds.id, debit: Number(payment.tds_amount || 0), credit: 0, narration: `TDS on ${invoice.invoice_number}` });
  }
  entries.push({ account_id: ar.id, debit: 0, credit: Number(payment.total_settled || 0), narration: `Settle ${invoice.invoice_number}` });
  return createApprovedVoucher({
    voucherPrefix: "RV",
    voucherType: "receipt",
    voucherDate: payment.payment_date,
    description: `Payment ${payment.payment_number} for ${invoice.invoice_number}`,
    branchId: payment.branch_id ?? invoice.branch_id,
    financialYearId: payment.financial_year_id ?? invoice.financial_year_id,
    entries,
  });
}

export const swApi = {
  nextNumber,

  // -------- Purchase Orders --------
  /**
   * Plain POs (no embed — see getVatChallan for why belongs-to embeds have
   * been unreliable on these workflow tables) plus customer/items hydrated
   * with a handful of bulk (IN-list) queries, instead of the old N+1
   * pattern of calling getPO() once per row.
   */
  async listPOsFull(filters: any = {}) {
    let q = supabase.from("purchase_orders").select("*").is("deleted_at", null).order("po_date", { ascending: false });
    if (filters.customer_id) q = q.eq("customer_id", filters.customer_id);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.q) q = q.ilike("po_number", `%${filters.q}%`);
    const { data: pos, error } = await q;
    const rows = (pos as any[]) || [];
    if (error || rows.length === 0) return { data: rows, error };

    const ids = rows.map((r) => r.id);
    const customerIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
    const [{ data: customers }, { data: allItems }] = await Promise.all([
      customerIds.length ? supabase.from("customers").select("id,name").in("id", customerIds) : Promise.resolve({ data: [] as any[] }),
      supabase.from("purchase_order_items").select("*").in("po_id", ids),
    ]);
    const customerMap = new Map(((customers as any[]) || []).map((c) => [c.id, c]));

    const itemRows = (allItems as any[]) || [];
    const productIds = [...new Set(itemRows.map((i) => i.product_id).filter(Boolean))];
    const { data: products } = productIds.length
      ? await supabase.from("item_master").select("id,item_name,item_code").in("id", productIds)
      : { data: [] as any[] };
    const productMap = new Map(((products as any[]) || []).map((p) => [p.id, p]));

    const itemsByPo = new Map<string, any[]>();
    for (const it of itemRows) {
      const arr = itemsByPo.get(it.po_id) || [];
      arr.push({
        ...it,
        product: productMap.has(it.product_id)
          ? { name: productMap.get(it.product_id).item_name, sku: productMap.get(it.product_id).item_code }
          : null,
      });
      itemsByPo.set(it.po_id, arr);
    }

    return {
      data: rows.map((r) => ({
        ...r,
        customer: customerMap.get(r.customer_id) || null,
        items: (itemsByPo.get(r.id) || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)),
      })),
      error: null,
    };
  },
  async getPO(id: string) {
    // items is has-many (FK on the child row) with a nested product embed —
    // same limitation as getVatChallan/getInvoice above; fetched separately.
    const { data: po, error } = await supabase.from("purchase_orders").select("*, customer:customers(*)").eq("id", id).maybeSingle();
    if (error || !po) return { data: null, error };

    const { data: items } = await supabase.from("purchase_order_items").select("*").eq("po_id", id).order("sort_order", { ascending: true });
    const itemRows = (items as any[]) || [];
    const productIds = [...new Set(itemRows.map((i) => i.product_id).filter(Boolean))];
    const { data: products } = productIds.length
      ? await supabase.from("item_master").select("id,item_name,item_code").in("id", productIds)
      : { data: [] as any[] };
    const productMap = new Map(((products as any[]) || []).map((p) => [p.id, p]));

    return {
      data: {
        ...(po as any),
        items: itemRows.map((i) => ({
          ...i,
          product: productMap.has(i.product_id)
            ? { id: i.product_id, name: productMap.get(i.product_id).item_name, sku: productMap.get(i.product_id).item_code }
            : null,
        })),
      },
      error: null,
    } as any;
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

  // -------- VAT Challan --------
  async getVatChallan(id: string) {
    // items/delivery_challans are has-many from a challan's perspective (the
    // FK lives on the child row) and items also nested a second embed
    // (product:item_master) inside itself — neither is something the
    // Laravel bridge's embed emulation can follow (belongs-to only, one
    // level), so the combined embedded select used to silently come back
    // with items/product/delivery_challans all missing. Fetched separately.
    const { data: challan, error } = await supabase.from("vat_challans").select("*, customer:customers(*), purchase_order:purchase_orders(id,po_number,po_date)").eq("id", id).maybeSingle();
    if (error || !challan) return { data: null, error };

    const c: any = challan;
    const [{ data: items }, { data: dcs }] = await Promise.all([
      supabase.from("vat_challan_items").select("*").eq("vat_challan_id", id).order("sort_order", { ascending: true }),
      supabase.from("delivery_challans").select("*").eq("vat_challan_id", id),
    ]);

    const itemRows = (items as any[]) || [];
    const productIds = [...new Set(itemRows.map((i) => i.product_id).filter(Boolean))];
    const poItemIds = [...new Set(itemRows.map((i) => i.purchase_order_item_id).filter(Boolean))];
    const [{ data: products }, { data: poItems }] = await Promise.all([
      productIds.length
        ? supabase.from("item_master").select("id,item_name,item_code").in("id", productIds)
        : Promise.resolve({ data: [] as any[] }),
      poItemIds.length
        ? supabase.from("purchase_order_items").select("id,qty_ordered,qty_delivered,qty_remaining").in("id", poItemIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const productMap = new Map(((products as any[]) || []).map((p) => [p.id, p]));
    const poItemMap = new Map(((poItems as any[]) || []).map((p) => [p.id, p]));

    return {
      data: {
        ...c,
        items: itemRows.map((i) => ({
          ...i,
          product: productMap.has(i.product_id)
            ? { name: productMap.get(i.product_id).item_name, sku: productMap.get(i.product_id).item_code }
            : null,
          purchase_order_item: poItemMap.get(i.purchase_order_item_id) || null,
        })),
        delivery_challans: dcs || [],
      },
      error: null,
    } as any;
  },
  /**
   * Plain challans (no embed — see getVatChallan for why belongs-to embeds
   * on this table have been unreliable) plus customer/purchase_order/items
   * hydrated with a handful of bulk (IN-list) queries. Used by the VAT
   * Challans list page, which also needs items for its per-row Print button.
   */
  async listVatChallansFull(filters: any = {}) {
    let q = supabase.from("vat_challans").select("*").is("deleted_at", null).order("challan_date", { ascending: false });
    if (filters.customer_id) q = q.eq("customer_id", filters.customer_id);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.q) q = q.ilike("challan_number", `%${filters.q}%`);
    const { data: challans, error } = await q;
    const rows = (challans as any[]) || [];
    if (error || rows.length === 0) return { data: rows, error };

    const ids = rows.map((r) => r.id);
    const customerIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
    const poIds = [...new Set(rows.map((r) => r.purchase_order_id).filter(Boolean))];
    const [{ data: customers }, { data: pos }, { data: allItems }] = await Promise.all([
      customerIds.length ? supabase.from("customers").select("id,name").in("id", customerIds) : Promise.resolve({ data: [] as any[] }),
      poIds.length ? supabase.from("purchase_orders").select("id,po_number").in("id", poIds) : Promise.resolve({ data: [] as any[] }),
      supabase.from("vat_challan_items").select("*").in("vat_challan_id", ids),
    ]);
    const customerMap = new Map(((customers as any[]) || []).map((c) => [c.id, c]));
    const poMap = new Map(((pos as any[]) || []).map((p) => [p.id, p]));

    const itemRows = (allItems as any[]) || [];
    const productIds = [...new Set(itemRows.map((i) => i.product_id).filter(Boolean))];
    const { data: products } = productIds.length
      ? await supabase.from("item_master").select("id,item_name,item_code").in("id", productIds)
      : { data: [] as any[] };
    const productMap = new Map(((products as any[]) || []).map((p) => [p.id, p]));

    const itemsByChallanId = new Map<string, any[]>();
    for (const it of itemRows) {
      const arr = itemsByChallanId.get(it.vat_challan_id) || [];
      arr.push({
        ...it,
        product: productMap.has(it.product_id)
          ? { name: productMap.get(it.product_id).item_name, sku: productMap.get(it.product_id).item_code }
          : null,
      });
      itemsByChallanId.set(it.vat_challan_id, arr);
    }

    return {
      data: rows.map((r) => ({
        ...r,
        customer: customerMap.get(r.customer_id) || null,
        purchase_order: poMap.get(r.purchase_order_id) || null,
        items: (itemsByChallanId.get(r.id) || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)),
      })),
      error: null,
    };
  },
  async getPoAvailability(poId: string) {
    return supabase
      .from("purchase_orders")
      .select("*, customer:customers(id,name), items:purchase_order_items(*, product:item_master(id,name:item_name,sku:item_code))")
      .eq("id", poId)
      .maybeSingle();
  },
  async createVatChallan(payload: any, items: any[]) {
    if (!payload.purchase_order_id) {
      return { data: null, error: { message: "VAT Challan must be issued against a Purchase Order." } as any };
    }
    const poItemIds = items.map((i) => i.purchase_order_item_id).filter(Boolean);
    if (poItemIds.length !== items.length) {
      return { data: null, error: { message: "Every item must reference a PO item." } as any };
    }
    const { data: poItems } = await supabase.from("purchase_order_items").select("id,qty_remaining,po_id").in("id", poItemIds);
    const byId = new Map((poItems || []).map((p: any) => [p.id, p]));
    for (const it of items) {
      const poi = byId.get(it.purchase_order_item_id);
      if (!poi) return { data: null, error: { message: "Invalid PO item." } as any };
      if ((poi as any).po_id !== payload.purchase_order_id) {
        return { data: null, error: { message: "PO item does not belong to selected PO." } as any };
      }
      if (Number(it.qty) > Number((poi as any).qty_remaining) + 0.0001) {
        return { data: null, error: { message: `Qty ${it.qty} exceeds remaining ${(poi as any).qty_remaining}.` } as any };
      }
    }

    const challan_number = await nextNumber("VCH");
    const subtotal = items.reduce((s, i) => s + Number(i.qty) * Number(i.rate), 0);
    const vat_amount = items.reduce((s, i) => s + Number(i.qty) * Number(i.rate) * (Number(i.vat_pct || 0) / 100), 0);
    const { data: v, error } = await supabase.from("vat_challans").insert({
      ...payload, challan_number, subtotal, vat_amount, grand_total: subtotal + vat_amount, status: "issued", source: "purchase_order",
    }).select().single();
    if (error || !v) return { data: null, error };

    const itemRows = items.map((i) => ({
      vat_challan_id: v.id,
      product_id: i.product_id,
      purchase_order_item_id: i.purchase_order_item_id || null,
      qty: i.qty,
      po_qty_consumed: i.purchase_order_item_id ? i.qty : 0,
      rate: i.rate,
      vat_pct: i.vat_pct || 0,
      line_subtotal: Number(i.qty) * Number(i.rate),
      vat_amount: Number(i.qty) * Number(i.rate) * (Number(i.vat_pct || 0) / 100),
      line_total: Number(i.qty) * Number(i.rate) * (1 + Number(i.vat_pct || 0) / 100),
    }));
    const { data: insertedItems, error: itemsErr } = await supabase.from("vat_challan_items").insert(itemRows).select();
    if (itemsErr) {
      await supabase.from("vat_challans").delete().eq("id", v.id);
      return { data: null, error: itemsErr };
    }

    // Decrement PO remaining/delivered
    if (payload.purchase_order_id) {
      for (const i of items) {
        if (!i.purchase_order_item_id) continue;
        const { data: poi } = await supabase.from("purchase_order_items").select("qty_ordered,qty_delivered,qty_remaining").eq("id", i.purchase_order_item_id).maybeSingle();
        if (poi) {
          const newDelivered = Number((poi as any).qty_delivered) + Number(i.qty);
          await supabase.from("purchase_order_items").update({
            qty_delivered: newDelivered,
            qty_remaining: Math.max(0, Number((poi as any).qty_ordered) - newDelivered),
          }).eq("id", i.purchase_order_item_id);
        }
      }
      const { data: remainingItems } = await supabase.from("purchase_order_items").select("qty_remaining,qty_delivered").eq("po_id", payload.purchase_order_id);
      const totalRemaining = (remainingItems || []).reduce((s: number, r: any) => s + Number(r.qty_remaining || 0), 0);
      const totalDelivered = (remainingItems || []).reduce((s: number, r: any) => s + Number(r.qty_delivered || 0), 0);
      if (totalRemaining <= 0.0001) {
        await supabase.from("purchase_orders").update({ status: "closed" }).eq("id", payload.purchase_order_id);
      } else if (totalDelivered > 0) {
        await supabase.from("purchase_orders").update({ status: "partial" }).eq("id", payload.purchase_order_id);
      }
    }

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
  /**
   * Same list, plus items/payments/tds_entries hydrated with a handful of
   * bulk (IN-list) queries — for pages (e.g. the Invoices list, which needs
   * items for its per-row Print button) that need more than the plain list
   * but shouldn't pay for calling getInvoice() once per row.
   */
  async listInvoicesFull(filters: any = {}) {
    // Plain columns only (no customer embed) — hydrated below via a bulk
    // query instead, for the same reliability reasons as listVatChallansFull.
    let iq = supabase.from("sales_invoices_v2").select("*").is("deleted_at", null).order("invoice_date", { ascending: false });
    if (filters.customer_id) iq = iq.eq("customer_id", filters.customer_id);
    if (filters.status) iq = iq.eq("status", filters.status);
    if (filters.q) iq = iq.ilike("invoice_number", `%${filters.q}%`);
    const { data: invoices, error } = await iq;
    const rows = (invoices as any[]) || [];
    if (error || rows.length === 0) return { data: rows, error };

    const customerIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
    const { data: customers } = customerIds.length
      ? await supabase.from("customers").select("id,name").in("id", customerIds)
      : { data: [] as any[] };
    const customerMap = new Map(((customers as any[]) || []).map((c) => [c.id, c]));

    const ids = rows.map((r) => r.id);
    const [{ data: allItems }, { data: allPayments }, { data: allTds }] = await Promise.all([
      supabase.from("sales_invoice_items_v2").select("*").in("invoice_id", ids),
      supabase.from("invoice_payments").select("*").in("invoice_id", ids),
      supabase.from("tds_entries").select("*").in("invoice_id", ids),
    ]);

    const itemRows = (allItems as any[]) || [];
    const productIds = [...new Set(itemRows.map((i) => i.product_id).filter(Boolean))];
    const { data: products } = productIds.length
      ? await supabase.from("item_master").select("id,item_name,item_code").in("id", productIds)
      : { data: [] as any[] };
    const productMap = new Map(((products as any[]) || []).map((p) => [p.id, p]));

    const byInvoice = <T extends { invoice_id: string }>(list: T[] | null) => {
      const map = new Map<string, T[]>();
      for (const row of list || []) {
        const arr = map.get(row.invoice_id) || [];
        arr.push(row);
        map.set(row.invoice_id, arr);
      }
      return map;
    };
    const itemsByInvoice = byInvoice(itemRows.map((i) => ({
      ...i,
      product: productMap.has(i.product_id)
        ? { name: productMap.get(i.product_id).item_name, sku: productMap.get(i.product_id).item_code }
        : null,
    })) as any);
    const paymentsByInvoice = byInvoice((allPayments as any[]) || []);
    const tdsByInvoice = byInvoice((allTds as any[]) || []);

    return {
      data: rows.map((r) => ({
        ...r,
        customer: customerMap.get(r.customer_id) || null,
        items: (itemsByInvoice.get(r.id) || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)),
        payments: paymentsByInvoice.get(r.id) || [],
        tds_entries: tdsByInvoice.get(r.id) || [],
      })),
      error: null,
    };
  },
  async getInvoice(id: string) {
    // Fetched as separate has-many queries (not a nested Supabase embed) —
    // the Laravel bridge's embed emulation only supports belongs-to relations
    // (a single FK column on the parent row); it can't follow a has-many
    // child table (items keyed by invoice_id) nor a second embed nested
    // inside one (product:item_master inside items), so a combined embedded
    // select silently comes back with items/product missing.
    const { data: invoice, error } = await supabase.from("sales_invoices_v2").select("*").eq("id", id).maybeSingle();
    if (error || !invoice) return { data: null, error };

    const inv: any = invoice;
    const [{ data: customer }, { data: items }, { data: payments }, { data: tdsEntries }] = await Promise.all([
      inv.customer_id
        ? supabase.from("customers").select("*").eq("id", inv.customer_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      supabase.from("sales_invoice_items_v2").select("*").eq("invoice_id", id).order("sort_order", { ascending: true }),
      supabase.from("invoice_payments").select("*").eq("invoice_id", id),
      supabase.from("tds_entries").select("*").eq("invoice_id", id),
    ]);

    const itemRows = ((items as any[]) || []);
    const productIds = [...new Set(itemRows.map((i) => i.product_id).filter(Boolean))];
    const { data: products } = productIds.length
      ? await supabase.from("item_master").select("id,item_name,item_code").in("id", productIds)
      : { data: [] as any[] };
    const productMap = new Map(((products as any[]) || []).map((p) => [p.id, p]));

    return {
      data: {
        ...inv,
        customer: customer || null,
        items: itemRows.map((i) => ({
          ...i,
          product: productMap.has(i.product_id)
            ? { name: productMap.get(i.product_id).item_name, sku: productMap.get(i.product_id).item_code }
            : null,
        })),
        payments: payments || [],
        tds_entries: tdsEntries || [],
      },
      error: null,
    } as any;
  },
  async eligibleVatChallans(customer_id?: string, date?: string) {
    // VAT challans whose ALL delivery_challans are ho_received and not invoiced.
    // delivery_challans/items are has-many from a challan's perspective (the
    // FK lives on the child row) — the Laravel bridge's embed emulation only
    // follows belongs-to relations, so embedding them here always came back
    // empty and this silently returned zero challans, ever. Fetched as
    // separate bulk (IN-list) queries instead.
    let q = supabase.from("vat_challans").select("*, customer:customers(id,name)").neq("status", "invoiced").is("deleted_at", null);
    if (customer_id) q = q.eq("customer_id", customer_id);
    if (date) q = q.eq("challan_date", date);
    const { data, error } = await q;
    const challans = (data as any[]) || [];
    if (error || challans.length === 0) return { data: [], error };

    const ids = challans.map((c) => c.id);
    const [{ data: allDcs }, { data: allItems }] = await Promise.all([
      supabase.from("delivery_challans").select("id,status,vat_challan_id").in("vat_challan_id", ids),
      supabase.from("vat_challan_items").select("*").in("vat_challan_id", ids),
    ]);
    const dcsByChallan = new Map<string, any[]>();
    for (const dc of (allDcs as any[]) || []) {
      const arr = dcsByChallan.get(dc.vat_challan_id) || [];
      arr.push(dc);
      dcsByChallan.set(dc.vat_challan_id, arr);
    }
    const itemsByChallan = new Map<string, any[]>();
    for (const it of (allItems as any[]) || []) {
      const arr = itemsByChallan.get(it.vat_challan_id) || [];
      arr.push(it);
      itemsByChallan.set(it.vat_challan_id, arr);
    }

    const hydrated = challans.map((c) => ({
      ...c,
      delivery_challans: dcsByChallan.get(c.id) || [],
      items: itemsByChallan.get(c.id) || [],
    }));
    const filtered = hydrated.filter((v) =>
      v.delivery_challans.length > 0 && v.delivery_challans.every((d: any) => d.status === "ho_received")
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
    const voucher = await postSalesInvoiceVoucher(inv);
    if (voucher?.id) await supabase.from("sales_invoices_v2").update({ voucher_id: voucher.id } as any).eq("id", inv.id);
    await audit("invoice_processing", "create", inv, `Invoice ${inv.invoice_number}`);
    return { data: inv, error: null };
  },
  async recordPayment(invoiceId: string, payload: any) {
    const payment_number = await nextNumber("RCP");
    const total_settled = Number(payload.amount_received || 0) + Number(payload.tds_amount || 0);
    const { data: currentInvoice } = await supabase.from("sales_invoices_v2").select("*").eq("id", invoiceId).maybeSingle();
    if (!currentInvoice) return { data: null, error: { message: "Invoice not found." } as any };
    if (total_settled <= 0) return { data: null, error: { message: "Payment must be greater than zero." } as any };
    if (total_settled > Number((currentInvoice as any).due_amount || 0) + 0.01) {
      return { data: null, error: { message: `Payment ${total_settled} exceeds outstanding ${(currentInvoice as any).due_amount}.` } as any };
    }
    const { data: p, error } = await supabase.from("invoice_payments").insert({
      invoice_id: invoiceId, payment_number, ...payload, total_settled,
      branch_id: payload.branch_id ?? (currentInvoice as any).branch_id,
      financial_year_id: payload.financial_year_id ?? (currentInvoice as any).financial_year_id,
    }).select().single();
    if (error || !p) return { data: null, error };
    if (payload.tds_amount && Number(payload.tds_amount) > 0) {
      await supabase.from("tds_entries").insert({
        invoice_id: invoiceId, payment_id: p.id,
        tds_amount: payload.tds_amount,
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
        status: due <= 0 ? "paid" : "partial_paid",
      }).eq("id", invoiceId);
    }
    const voucher = await postInvoicePaymentVoucher(p, currentInvoice);
    if (voucher?.id) await supabase.from("invoice_payments").update({ voucher_id: voucher.id } as any).eq("id", p.id);
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
      return { data: null, error: { message: "Cannot edit items after VAT Challan started." } as any };
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

  async deleteVatChallan(id: string) {
    const { data: dcs } = await supabase.from("delivery_challans").select("id,status").eq("vat_challan_id", id);
    if ((dcs || []).some((d: any) => ["customer_received", "ho_received", "invoiced"].includes(d.status))) {
      return { error: { message: "Cannot delete: DC already received/invoiced" } as any };
    }
    // Restore PO availability for any PO-linked items
    const { data: challan } = await supabase.from("vat_challans").select("purchase_order_id").eq("id", id).maybeSingle();
    const { data: items } = await supabase.from("vat_challan_items").select("purchase_order_item_id, qty").eq("vat_challan_id", id);
    for (const it of items || []) {
      if (!(it as any).purchase_order_item_id) continue;
      const { data: poi } = await supabase.from("purchase_order_items").select("qty_ordered,qty_delivered").eq("id", (it as any).purchase_order_item_id).maybeSingle();
      if (poi) {
        const newDelivered = Math.max(0, Number((poi as any).qty_delivered) - Number((it as any).qty));
        await supabase.from("purchase_order_items").update({
          qty_delivered: newDelivered,
          qty_remaining: Math.max(0, Number((poi as any).qty_ordered) - newDelivered),
        }).eq("id", (it as any).purchase_order_item_id);
      }
    }
    if ((challan as any)?.purchase_order_id) {
      const { data: poItems } = await supabase.from("purchase_order_items").select("qty_remaining,qty_delivered").eq("po_id", (challan as any).purchase_order_id);
      const totalRemaining = (poItems || []).reduce((s: number, r: any) => s + Number(r.qty_remaining || 0), 0);
      const totalDelivered = (poItems || []).reduce((s: number, r: any) => s + Number(r.qty_delivered || 0), 0);
      const status = totalDelivered <= 0 ? "open" : totalRemaining <= 0.0001 ? "closed" : "partial";
      await supabase.from("purchase_orders").update({ status }).eq("id", (challan as any).purchase_order_id);
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
