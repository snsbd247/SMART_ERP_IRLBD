import { dataClient } from "@/integrations/data/client";

export type ReportFilters = {
  from?: string;
  to?: string;
  customer_id?: string;
  status?: string;
};

export function exportCsv(filename: string, rows: any[], headers: string[]) {
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const swReports = {
  async poVsVatChallan(f: ReportFilters) {
    let q = dataClient.from("purchase_order_items").select("*, po:purchase_orders!inner(po_number,po_date,customer_id,status,customer:customers(name)), product:item_master(name:item_name,sku:item_code)");
    if (f.from) q = q.gte("po.po_date", f.from);
    if (f.to) q = q.lte("po.po_date", f.to);
    if (f.customer_id) q = q.eq("po.customer_id", f.customer_id);
    return q;
  },
  async pendingPO(f: ReportFilters) {
    let q = dataClient.from("purchase_orders").select("*, customer:customers(name), items:purchase_order_items(qty_ordered,qty_remaining)").in("status", ["open", "partial"]).is("deleted_at", null);
    if (f.from) q = q.gte("po_date", f.from);
    if (f.to) q = q.lte("po_date", f.to);
    if (f.customer_id) q = q.eq("customer_id", f.customer_id);
    return q;
  },
  async challanStatus(f: ReportFilters) {
    let q = dataClient.from("delivery_challans").select("*, customer:customers(name), product:item_master(name:item_name), vat_challan:vat_challans(challan_number,challan_date)");
    if (f.from) q = q.gte("dc_date", f.from);
    if (f.to) q = q.lte("dc_date", f.to);
    if (f.customer_id) q = q.eq("customer_id", f.customer_id);
    if (f.status) q = q.eq("status", f.status);
    return q;
  },
  async vatRegister(f: ReportFilters) {
    let q = dataClient.from("vat_challans").select("*, customer:customers(name), items:vat_challan_items(*)").is("deleted_at", null).order("challan_date");
    if (f.from) q = q.gte("challan_date", f.from);
    if (f.to) q = q.lte("challan_date", f.to);
    if (f.customer_id) q = q.eq("customer_id", f.customer_id);
    return q;
  },
  async invoiceRegister(f: ReportFilters) {
    let q = dataClient.from("sales_invoices_v2").select("*, customer:customers(name)").is("deleted_at", null).order("invoice_date");
    if (f.from) q = q.gte("invoice_date", f.from);
    if (f.to) q = q.lte("invoice_date", f.to);
    if (f.customer_id) q = q.eq("customer_id", f.customer_id);
    if (f.status) q = q.eq("status", f.status);
    return q;
  },
  async invoicePending(f: ReportFilters) {
    let q = dataClient.from("sales_invoices_v2").select("*, customer:customers(name)").is("deleted_at", null).gt("due_amount", 0);
    if (f.from) q = q.gte("invoice_date", f.from);
    if (f.to) q = q.lte("invoice_date", f.to);
    if (f.customer_id) q = q.eq("customer_id", f.customer_id);
    return q;
  },
  async collection(f: ReportFilters) {
    let q = dataClient.from("invoice_payments").select("*, invoice:sales_invoices_v2(invoice_number,customer:customers(name))").order("payment_date");
    if (f.from) q = q.gte("payment_date", f.from);
    if (f.to) q = q.lte("payment_date", f.to);
    return q;
  },
  async aging() {
    const { data } = await dataClient.from("sales_invoices_v2").select("*, customer:customers(name)").gt("due_amount", 0).is("deleted_at", null);
    const today = new Date();
    const buckets = (data || []).map((inv: any) => {
      const days = Math.floor((today.getTime() - new Date(inv.invoice_date).getTime()) / 86400000);
      const bucket = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
      return { ...inv, days, bucket };
    });
    return buckets;
  },
};
