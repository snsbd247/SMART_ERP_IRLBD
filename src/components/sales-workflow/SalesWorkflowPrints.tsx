import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { PrintLayout } from "@/components/PrintLayout";

const num = (n: any) => Number(n || 0).toFixed(2);
const th: any = { background: "#f0f0f0", fontWeight: 600, textAlign: "left", padding: "8px 10px", border: "1px solid #ddd", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.3px" };
const td: any = { padding: "6px 10px", border: "1px solid #ddd", fontSize: 12 };
const tdr: any = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const totalsBlock = (rows: [string, any][]) => (
  <div style={{ marginTop: 12, marginLeft: "auto", width: 280 }}>
    {rows.map(([k, v]) => (
      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px dashed #ddd", fontSize: 12 }}>
        <span>{k}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
      </div>
    ))}
  </div>
);

/* ---------------- Generic trigger button ---------------- */
export function PrintButton({ render, label = "Print" }: { render: (close: () => void, open: boolean) => React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Printer className="w-4 h-4 mr-1" />{label}
      </Button>
      {render(() => setOpen(false), open)}
    </>
  );
}

/* ---------------- Purchase Order ---------------- */
export function PrintPO({ po }: { po: any }) {
  return (
    <PrintButton render={(close, open) => (
      <PrintLayout open={open} onClose={close} title="Purchase Order"
        docNumber={po.po_number} docDate={po.po_date}
        partyLabel="Customer" partyName={po.customer?.name} partyEmail={po.customer?.email}
        notes={po.notes}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>#</th><th style={th}>Product</th>
            <th style={{ ...th, textAlign: "right" }}>Qty</th>
            <th style={{ ...th, textAlign: "right" }}>Rate</th>
            <th style={{ ...th, textAlign: "right" }}>VAT %</th>
            <th style={{ ...th, textAlign: "right" }}>Line Total</th>
          </tr></thead>
          <tbody>
            {po.items?.map((it: any, i: number) => (
              <tr key={it.id}>
                <td style={td}>{i + 1}</td>
                <td style={td}>{it.product?.name}</td>
                <td style={tdr}>{it.qty_ordered}</td>
                <td style={tdr}>{num(it.rate)}</td>
                <td style={tdr}>{it.vat_pct}</td>
                <td style={tdr}>{num(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalsBlock([["Subtotal", num(po.subtotal)], ["VAT", num(po.vat_amount)], ["Grand Total", num(po.grand_total)]])}
      </PrintLayout>
    )} />
  );
}

/* ---------------- VAT Challan (Mushak 6.3) ---------------- */
export function PrintVatChallan({ v }: { v: any }) {
  return (
    <PrintButton render={(close, open) => (
      <PrintLayout open={open} onClose={close} title="VAT Challan — মূসক ৬.৩ (Mushak 6.3)"
        docNumber={v.challan_number} docDate={v.challan_date}
        partyLabel="Buyer" partyName={v.customer?.name} partyEmail={v.customer?.email}
        notes={v.notes}>
        <div style={{ fontSize: 11, marginBottom: 8, color: "#555" }}>
          Issued under VAT and Supplementary Duty Act, 2012 — Rule 40(1)(b)
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>#</th><th style={th}>Description of Goods</th>
            <th style={{ ...th, textAlign: "right" }}>Qty</th>
            <th style={{ ...th, textAlign: "right" }}>Rate</th>
            <th style={{ ...th, textAlign: "right" }}>Value</th>
            <th style={{ ...th, textAlign: "right" }}>VAT %</th>
            <th style={{ ...th, textAlign: "right" }}>VAT Amt</th>
            <th style={{ ...th, textAlign: "right" }}>Total</th>
          </tr></thead>
          <tbody>
            {v.items?.map((it: any, i: number) => (
              <tr key={it.id}>
                <td style={td}>{i + 1}</td>
                <td style={td}>{it.product?.name}</td>
                <td style={tdr}>{it.qty}</td>
                <td style={tdr}>{num(it.rate)}</td>
                <td style={tdr}>{num(Number(it.qty) * Number(it.rate))}</td>
                <td style={tdr}>{it.vat_pct}</td>
                <td style={tdr}>{num(it.vat_amount)}</td>
                <td style={tdr}>{num(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalsBlock([["Taxable Value", num(v.subtotal)], ["VAT Payable", num(v.vat_amount)], ["Grand Total (BDT)", num(v.grand_total)]])}
      </PrintLayout>
    )} label="Print Mushak 6.3" />
  );
}

/* ---------------- Delivery Challan ---------------- */
export function PrintDeliveryChallan({ dc }: { dc: any }) {
  return (
    <PrintButton render={(close, open) => (
      <PrintLayout open={open} onClose={close} title="Delivery Challan"
        docNumber={dc.dc_number} docDate={dc.dc_date}
        partyLabel="Customer" partyName={dc.customer?.name}>
        <div style={{ fontSize: 11, marginBottom: 8, color: "#555" }}>
          Reference VAT Challan: <b>{dc.vat_challan?.challan_number}</b> &nbsp;|&nbsp; Status: <b>{dc.status}</b>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Product</th>
            <th style={{ ...th, textAlign: "right" }}>Quantity</th>
          </tr></thead>
          <tbody>
            <tr>
              <td style={td}>{dc.product?.name}</td>
              <td style={tdr}>{dc.qty}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: 60, display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <div style={{ textAlign: "center", minWidth: 180 }}>
            <div style={{ borderTop: "1px solid #666", paddingTop: 4 }}>Driver / Carrier</div>
          </div>
          <div style={{ textAlign: "center", minWidth: 180 }}>
            <div style={{ borderTop: "1px solid #666", paddingTop: 4 }}>Received By (Customer)</div>
          </div>
        </div>
      </PrintLayout>
    )} />
  );
}

/* ---------------- Tax Invoice ---------------- */
export function PrintTaxInvoice({ inv }: { inv: any }) {
  return (
    <PrintButton render={(close, open) => (
      <PrintLayout open={open} onClose={close} title="Tax Invoice"
        docNumber={inv.invoice_number} docDate={inv.invoice_date}
        partyLabel="Bill To" partyName={inv.customer?.name} partyEmail={inv.customer?.email}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>#</th><th style={th}>Description</th>
            <th style={{ ...th, textAlign: "right" }}>Qty</th>
            <th style={{ ...th, textAlign: "right" }}>Rate</th>
            <th style={{ ...th, textAlign: "right" }}>VAT %</th>
            <th style={{ ...th, textAlign: "right" }}>VAT Amt</th>
            <th style={{ ...th, textAlign: "right" }}>Line Total</th>
          </tr></thead>
          <tbody>
            {inv.items?.map((it: any, i: number) => (
              <tr key={it.id}>
                <td style={td}>{i + 1}</td>
                <td style={td}>{it.product?.name}</td>
                <td style={tdr}>{it.qty}</td>
                <td style={tdr}>{num(it.rate)}</td>
                <td style={tdr}>{it.vat_pct}</td>
                <td style={tdr}>{num(it.vat_amount)}</td>
                <td style={tdr}>{num(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalsBlock([
          ["Subtotal", num(inv.subtotal)],
          ["VAT Total", num(inv.vat_total)],
          ["Grand Total", num(inv.grand_total)],
          ["Paid", num(inv.paid_amount)],
          ["TDS Withheld", num(inv.tds_amount)],
          ["Balance Due", num(inv.due_amount)],
        ])}
      </PrintLayout>
    )} label="Print Invoice" />
  );
}

/* ---------------- Money Receipt (with TDS) ---------------- */
export function PrintMoneyReceipt({ payment, invoice }: { payment: any; invoice: any }) {
  return (
    <PrintButton render={(close, open) => (
      <PrintLayout open={open} onClose={close} title="Money Receipt"
        docNumber={payment.payment_number} docDate={payment.payment_date}
        partyLabel="Received From" partyName={invoice.customer?.name}>
        <div style={{ fontSize: 12, marginBottom: 12 }}>
          Received with thanks from <b>{invoice.customer?.name}</b> the sum of
          <b style={{ marginLeft: 6 }}>BDT {num(payment.total_settled)}</b>
          &nbsp;against Invoice <b>{invoice.invoice_number}</b> dated {invoice.invoice_date}.
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={td}><b>Mode</b></td><td style={td}>{payment.mode}</td>
                <td style={td}><b>Reference</b></td><td style={td}>{payment.reference || "—"}</td></tr>
            <tr><td style={td}><b>Amount Received</b></td><td style={tdr}>{num(payment.amount_received)}</td>
                <td style={td}><b>TDS Withheld</b></td><td style={tdr}>{num(payment.tds_amount)}</td></tr>
            <tr><td style={td} colSpan={3}><b>Total Settled Against Invoice</b></td>
                <td style={tdr}><b>{num(payment.total_settled)}</b></td></tr>
          </tbody>
        </table>
        {Number(payment.tds_amount) > 0 && (
          <div style={{ marginTop: 16, fontSize: 11, padding: 8, background: "#fffbe6", border: "1px solid #f0d97a" }}>
            <b>TDS Note:</b> A separate TDS certificate (Form Mushak 6.6 / Tax Deducted at Source)
            must be issued by the deductor for BDT {num(payment.tds_amount)}.
          </div>
        )}
      </PrintLayout>
    )} label="Receipt" />
  );
}
