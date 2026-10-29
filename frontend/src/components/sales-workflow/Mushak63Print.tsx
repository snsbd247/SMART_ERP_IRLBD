import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer, Download } from "lucide-react";
import { useCompanySettings } from "@/hooks/useCompanySettings";

/**
 * Mushak 6.3 — exact NBR (Bangladesh) prescribed layout.
 * Pixel-faithful reproduction of the official Bengali tax-invoice form.
 * Isolated component: changes here do NOT affect other prints.
 */

const num = (n: any) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: any) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};

const fmtDate = (d: any) => {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return String(d);
  return x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }).toUpperCase().replace(/ /g, "-");
};
const fmtTime = (d: any) => {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  return x.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
};

/* Locked A4 layout — identical across Chrome / Firefox / Safari / Edge.
 * Uses mm units for print, fixed table-layout with explicit colgroup widths,
 * forced color rendering, and antialiased font smoothing. */
const MUSHAK_CSS = `
  *, *::before, *::after { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: "SolaimanLipi","Nikosh","Noto Sans Bengali","Siyam Rupali",Arial,sans-serif;
    color: #000;
    font-size: 10.5pt;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: geometricPrecision;
  }
  .mushak-doc { width: 190mm; margin: 0 auto; padding: 5mm 5mm; }
  .gov-line { text-align:center; font-size: 11pt; padding: 1mm 0; }
  .title-row { display:flex; align-items:flex-start; justify-content:space-between; margin-top: 1mm; }
  .title-center { flex:1; text-align:center; }
  .title-center h1 { font-size: 20pt; font-weight: 700; margin: 0; letter-spacing: 1.5pt; }
  .title-center .rule-ref { font-size: 10pt; margin-top: 1mm; }
  .form-code { font-size: 12pt; font-weight: 700; border: 0.4mm solid #000; padding: 1mm 3mm; white-space: nowrap; }
  .header-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 3mm; align-items: flex-start; }

  .kv { display:grid; grid-template-columns: 45mm 3mm 1fr; column-gap: 1mm; row-gap: 0.8mm; font-size: 10pt; }
  .kv .k { font-weight: 600; }
  .kv .v { font-weight: 600; word-wrap: break-word; overflow-wrap: anywhere; }
  table.mushak-items { width: 100%; border-collapse: collapse; margin-top: 3mm; table-layout: fixed; }
  table.mushak-items th, table.mushak-items td {
    border: 0.25mm solid #000;
    padding: 0.6mm 0.8mm;
    font-size: 7.5pt;
    vertical-align: middle;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    word-break: break-word;
    hyphens: auto;
    line-height: 1.1;
  }
  table.mushak-items thead th { background:#fff !important; font-weight: 700; text-align: center; line-height: 1.1; font-size: 7.5pt; }
  table.mushak-items tr.col-no td { font-size: 7pt; font-weight: 600; text-align: center; padding: 0.3mm; }
  table.mushak-items td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.mushak-items td.center { text-align: center; }
  table.mushak-items tr.total-row td { font-weight: 700; text-align: right; }
  table.mushak-items tr.total-row td.label { text-align: center; }
  .signoff { margin-top: 18mm; font-size: 10pt; }
  .signoff .row { margin: 1mm 0; }
  .footnote { font-size: 9pt; margin-top: 8mm; }
  .entry-user { text-align:right; font-size: 9pt; margin-top: 6mm; font-weight: 600; }
  @page { size: A4 portrait; margin: 8mm 10mm; }
  @media print {
    html, body { width: 210mm; height: 297mm; }
    .mushak-doc { width: 190mm; padding: 0; }
    table.mushak-items { page-break-inside: auto; }
    table.mushak-items tr { page-break-inside: avoid; page-break-after: auto; }
    table.mushak-items thead { display: table-header-group; }
  }
`;


interface Props { v: any; }

/** Renders just the Mushak 6.3 document body (no dialog/print chrome).
 *  Use this for inline preview pages or embedding. */
export function Mushak63Body({ v }: Props) {
  const { settings } = useCompanySettings();

  const sellerName = settings?.company_name || "—";
  const sellerBin = settings?.bin_number || "—";
  const sellerAddress = settings?.address || "—";
  const buyerName = v.customer?.name || "—";
  const buyerBin = v.customer?.bin_number || v.customer?.bin || "—";
  const buyerAddress = v.customer?.address || "—";
  const destination = v.delivery_destination || v.customer?.address || "—";
  const vehicleNo = v.vehicle_no || "—";

  const challanNo = v.challan_number || "—";
  const issueDate = fmtDate(v.challan_date);
  const issueTime = fmtTime(v.created_at || v.challan_date);
  const printDate = fmtDate(new Date());
  const printTime = fmtTime(new Date());
  const entryUser = v.created_by_name || v.entry_user || "";

  const items: any[] = v.items || [];
  const totalQty = items.reduce((s, it) => s + Number(it.qty || 0), 0);
  const totalValue = items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.rate || 0), 0);
  const totalVat = items.reduce((s, it) => s + Number(it.vat_amount || 0), 0);
  const grandTotal = items.reduce((s, it) => s + Number(it.line_total || 0), 0);

  const subHdr: React.CSSProperties = { fontWeight: 400, fontSize: "6.5pt", display: "block", marginTop: "0.4mm" };

  return (
    <div className="mushak-doc">
      <div className="gov-line">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার, জাতীয় রাজস্ব বোর্ড, ঢাকা।</div>

      <div className="title-row">
        <div style={{ width: "20mm" }} />
        <div className="title-center">
          <h1>কর চালানপত্র</h1>
          <div className="rule-ref">[বিধি ৪০ এর উপ-বিধি (১) এর দফা (গ) ও (চ) দ্রষ্টব্য]</div>
        </div>
        <div className="form-code">মূসক-৬.৩</div>
      </div>

      <div className="header-grid" style={{ marginTop: "4mm" }}>
        <div className="kv">
          <div className="k">নিবন্ধিত ব্যক্তির নাম</div><div>:</div><div className="v">{sellerName}</div>
          <div className="k">নিবন্ধিত ব্যক্তির বিআইএন</div><div>:</div><div className="v">{sellerBin}</div>
          <div className="k">চালানপত্র ইস্যুর ঠিকানা</div><div>:</div><div className="v">{sellerAddress}</div>
        </div>
        <div className="kv">
          <div className="k">চালানপত্র নম্বর</div><div>:</div><div className="v">{challanNo}</div>
          <div className="k">ইস্যুর তারিখ</div><div>:</div><div className="v">{issueDate}</div>
          <div className="k">ইস্যুর সময়</div><div>:</div><div className="v">{issueTime}</div>
          <div className="k">প্রিন্টের সময়</div><div>:</div><div className="v">{printDate} {printTime}</div>
        </div>
      </div>

      <div className="header-grid" style={{ marginTop: "2mm" }}>
        <div className="kv">
          <div className="k">ক্রেতার নাম</div><div>:</div><div className="v">{buyerName}</div>
          <div className="k">ক্রেতার বিআইএন</div><div>:</div><div className="v">{buyerBin}</div>
          <div className="k">ক্রেতার ঠিকানা</div><div>:</div><div className="v">{buyerAddress}</div>
          <div className="k">সরবরাহের গন্তব্যস্থল</div><div>:</div><div className="v">{destination}</div>
        </div>
        <div />
      </div>

      <div className="kv" style={{ marginTop: "1.5mm", gridTemplateColumns: "55mm 3mm 1fr" }}>
        <div className="k">যানবাহনের প্রকৃতি ও নম্বর</div><div>:</div><div className="v">{vehicleNo}</div>
      </div>

      <table className="mushak-items">
        <colgroup>
          <col style={{ width: "4%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "11%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>ক্রমিক</th>
            <th>পণ্য/সেবার বর্ণনা<span style={subHdr}>(প্রযোজ্য ক্ষেত্রে ব্র্যান্ড নামসহ)</span></th>
            <th>সরবরাহের একক</th>
            <th>পরিমাণ</th>
            <th>একক মূল্য <sup>১</sup><span style={subHdr}>(টাকায়)</span></th>
            <th>মোট মূল্য<span style={subHdr}>(টাকায়)</span></th>
            <th>সম্পূরক শুল্কের ভিত্তি মূল্য<span style={subHdr}>(টাকায়)</span></th>
            <th>সম্পূরক শুল্কের পরিমাণ / সুনির্দিষ্ট কর</th>
            <th>মূল্য সংযোজন করের হার / সুনির্দিষ্ট কর</th>
            <th>মূল্য সংযোজন কর / সুনির্দিষ্ট কর এর পরিমাণ</th>
            <th>সকল প্রকার কর সহ মূল্য</th>
          </tr>
          <tr className="col-no">
            {Array.from({ length: 11 }, (_, i) => (<td key={i}>{i + 1}</td>))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const lineValue = Number(it.qty || 0) * Number(it.rate || 0);
            return (
              <tr key={it.id || i}>
                <td className="center">{i + 1}</td>
                <td>{it.product?.name || it.description || "—"}</td>
                <td className="center">{it.unit || it.product?.unit || "PCS"}</td>
                <td className="num">{qty(it.qty)}</td>
                <td className="num">{num(it.rate)}</td>
                <td className="num">{num(lineValue)}</td>
                <td className="num">{num(0)}</td>
                <td className="num">{num(0)}</td>
                <td className="num">{Number(it.vat_pct || 0).toFixed(2)}</td>
                <td className="num">{num(it.vat_amount)}</td>
                <td className="num">{num(it.line_total)}</td>
              </tr>
            );
          })}
          <tr className="total-row">
            <td colSpan={3} className="label">সর্বমোট</td>
            <td className="num">{qty(totalQty)}</td>
            <td />
            <td className="num">{num(totalValue)}</td>
            <td className="num">{num(0)}</td>
            <td className="num">{num(0)}</td>
            <td />
            <td className="num">{num(totalVat)}</td>
            <td className="num">{num(grandTotal)}</td>
          </tr>
        </tbody>
      </table>

      <div className="signoff">
        <div className="row" style={{ fontWeight: 700 }}>প্রতিষ্ঠান কর্তৃপক্ষের দায়িত্বপ্রাপ্ত ব্যক্তির নাম :</div>
        <div className="row" style={{ paddingLeft: "4mm" }}>পদবী :</div>
        <div className="row" style={{ paddingLeft: "4mm" }}>স্বাক্ষর :</div>
        <div className="row" style={{ paddingLeft: "4mm" }}>সীল :</div>
      </div>

      <div className="footnote"><sup>১</sup> সকল প্রকার কর ব্যতীত মূল্য।</div>

      {entryUser && <div className="entry-user">Entry User: {entryUser}</div>}
    </div>
  );
}

export function MushakStyles() {
  return <style dangerouslySetInnerHTML={{ __html: MUSHAK_CSS }} />;
}

export function PrintMushak63({ v }: Props) {
  const [open, setOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const challanNo = v.challan_number || "—";

  const getHtml = () => {
    if (!printRef.current) return "";
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Mushak 6.3 — ${challanNo}</title><style>${MUSHAK_CSS}</style></head><body>${printRef.current.innerHTML}</body></html>`;
  };

  const doPrint = () => {
    const html = getHtml();
    if (!html) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Printer className="w-4 h-4 mr-1" />Print Mushak 6.3
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Mushak 6.3 — {challanNo}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={doPrint}>
                  <Download className="w-4 h-4 mr-1" />PDF
                </Button>
                <Button size="sm" onClick={doPrint}>
                  <Printer className="w-4 h-4 mr-1" />Print
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>

          <MushakStyles />
          <div ref={printRef} className="bg-white" style={{ color: "#000" }}>
            <Mushak63Body v={v} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

