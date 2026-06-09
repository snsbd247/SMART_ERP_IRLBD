import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { PrintLayout } from "@/components/PrintLayout";


const num = (n: any) => Number(n || 0).toFixed(2);
const th: any = { background: "#f0f0f0", fontWeight: 600, textAlign: "left", padding: "8px 10px", border: "1px solid #ddd", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.3px" };
const td: any = { padding: "6px 10px", border: "1px solid #ddd", fontSize: 12 };
const tdr: any = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

/** Bilingual cell: English on top, Bangla underneath. Used for Mushak-compliant prints. */
const bi = (en: string, bn: string, align: "left" | "right" = "left") => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: align === "right" ? "flex-end" : "flex-start", lineHeight: 1.15 }}>
    <span>{en}</span>
    <span style={{ fontSize: 10, fontWeight: 400, color: "#555", textTransform: "none" }}>{bn}</span>
  </div>
);

const totalsBlock = (rows: [React.ReactNode, any][]) => (
  <div style={{ marginTop: 12, marginLeft: "auto", width: 320 }}>
    {rows.map((row, i) => (
      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px dashed #ddd", fontSize: 12 }}>
        <span>{row[0]}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{row[1]}</span>
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
      <PrintLayout open={open} onClose={close} title="Purchase Order / ক্রয়াদেশ"
        docNumber={po.po_number} docDate={po.po_date}
        partyLabel="Customer / ক্রেতা" partyName={po.customer?.name} partyEmail={po.customer?.email}
        notes={po.notes}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>#</th>
            <th style={th}>{bi("Product", "পণ্যের বিবরণ")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("Qty", "পরিমাণ", "right")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("Rate", "মূল্য", "right")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("VAT %", "মূসক %", "right")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("Line Total", "মোট", "right")}</th>
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
        {totalsBlock([
          [bi("Subtotal", "উপ-মোট"), num(po.subtotal)],
          [bi("VAT", "মূসক"), num(po.vat_amount)],
          [bi("Grand Total (BDT)", "সর্বমোট (টাকা)"), num(po.grand_total)],
        ])}
      </PrintLayout>
    )} />
  );
}

/* ---------------- VAT Challan (Mushak 6.3) ----------------
 * Exact NBR-prescribed layout lives in Mushak63Print.tsx.
 * Re-exported as PrintVatChallan so existing callers keep working unchanged.
 */
export { PrintMushak63 as PrintVatChallan } from "./Mushak63Print";

/* ---------------- Delivery Challan ---------------- */
export function PrintDeliveryChallan({ dc }: { dc: any }) {
  return (
    <PrintButton render={(close, open) => (
      <PrintLayout open={open} onClose={close} title="Delivery Challan / ডেলিভারি চালান"
        docNumber={dc.dc_number} docDate={dc.dc_date}
        partyLabel="Customer / ক্রেতা" partyName={dc.customer?.name}>
        <div style={{ fontSize: 11, marginBottom: 8, color: "#555" }}>
          Reference VAT Challan / মূসক চালান নং: <b>{dc.vat_challan?.challan_number}</b>
          &nbsp;|&nbsp; Status / অবস্থা: <b>{dc.status}</b>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>{bi("Product", "পণ্যের বিবরণ")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("Quantity", "পরিমাণ", "right")}</th>
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
            <div style={{ borderTop: "1px solid #666", paddingTop: 4 }}>
              Driver / Carrier<br /><span style={{ fontSize: 10, color: "#666" }}>চালক / পরিবহনকারী</span>
            </div>
          </div>
          <div style={{ textAlign: "center", minWidth: 180 }}>
            <div style={{ borderTop: "1px solid #666", paddingTop: 4 }}>
              Received By (Customer)<br /><span style={{ fontSize: 10, color: "#666" }}>প্রাপক (ক্রেতা)</span>
            </div>
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
      <PrintLayout open={open} onClose={close} title="Tax Invoice / কর চালান"
        docNumber={inv.invoice_number} docDate={inv.invoice_date}
        partyLabel="Bill To / প্রাপক" partyName={inv.customer?.name} partyEmail={inv.customer?.email}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>#</th>
            <th style={th}>{bi("Description", "বিবরণ")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("Qty", "পরিমাণ", "right")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("Rate", "মূল্য", "right")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("VAT %", "মূসক %", "right")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("VAT Amt", "মূসক", "right")}</th>
            <th style={{ ...th, textAlign: "right" }}>{bi("Line Total", "মোট", "right")}</th>
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
          [bi("Subtotal", "উপ-মোট"), num(inv.subtotal)],
          [bi("VAT Total", "মোট মূসক"), num(inv.vat_total)],
          [bi("Grand Total", "সর্বমোট"), num(inv.grand_total)],
          [bi("Paid", "পরিশোধিত"), num(inv.paid_amount)],
          [bi("TDS Withheld", "উৎসে কর কর্তন"), num(inv.tds_amount)],
          [bi("Balance Due", "বকেয়া"), num(inv.due_amount)],
        ])}
      </PrintLayout>
    )} label="Print Invoice" />
  );
}

/* ---------------- Money Receipt (with TDS) — Mushak 6.6 reference ---------------- */
export function PrintMoneyReceipt({ payment, invoice }: { payment: any; invoice: any }) {
  return (
    <PrintButton render={(close, open) => (
      <PrintLayout open={open} onClose={close} title="Money Receipt / অর্থ প্রাপ্তির রসিদ"
        docNumber={payment.payment_number} docDate={payment.payment_date}
        partyLabel="Received From / প্রাপ্তির উৎস" partyName={invoice.customer?.name}>
        <div style={{ fontSize: 12, marginBottom: 12 }}>
          Received with thanks from <b>{invoice.customer?.name}</b> the sum of
          <b style={{ marginLeft: 6 }}>BDT {num(payment.total_settled)}</b>
          &nbsp;against Invoice <b>{invoice.invoice_number}</b> dated {invoice.invoice_date}.
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
            <b>{invoice.customer?.name}</b>-এর নিকট থেকে চালান নং <b>{invoice.invoice_number}</b>-এর
            বিপরীতে <b>টাকা {num(payment.total_settled)}</b> ধন্যবাদসহকারে গ্রহণ করা হলো।
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={td}><b>{bi("Mode", "পদ্ধতি")}</b></td><td style={td}>{payment.mode}</td>
              <td style={td}><b>{bi("Reference", "রেফারেন্স")}</b></td><td style={td}>{payment.reference || "—"}</td>
            </tr>
            <tr>
              <td style={td}><b>{bi("Amount Received", "প্রাপ্ত অর্থ")}</b></td><td style={tdr}>{num(payment.amount_received)}</td>
              <td style={td}><b>{bi("TDS Withheld", "উৎসে কর কর্তন")}</b></td><td style={tdr}>{num(payment.tds_amount)}</td>
            </tr>
            <tr>
              <td style={td} colSpan={3}><b>{bi("Total Settled Against Invoice", "চালানের বিপরীতে মোট সমন্বয়")}</b></td>
              <td style={tdr}><b>{num(payment.total_settled)}</b></td>
            </tr>
          </tbody>
        </table>
        {Number(payment.tds_amount) > 0 && (
          <div style={{ marginTop: 16, fontSize: 11, padding: 8, background: "#fffbe6", border: "1px solid #f0d97a" }}>
            <b>TDS Note / উৎসে কর নোট:</b> A separate TDS certificate (Form Mushak 6.6 / উৎসে কর কর্তনের প্রত্যয়নপত্র — ফরম মূসক ৬.৬)
            must be issued by the deductor for BDT {num(payment.tds_amount)} /
            কর্তনকারীকে অবশ্যই টাকা {num(payment.tds_amount)}-এর জন্য পৃথক প্রত্যয়নপত্র ইস্যু করতে হবে।
          </div>
        )}
      </PrintLayout>
    )} label="Receipt" />
  );
}
