import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportCsv } from "@/lib/sales-workflow-reports";
import { ReportPrintFooter } from "@/components/reports/ReportPrintFooter";

/**
 * Mushak 9.1 — Monthly VAT Return (Bangladesh, NBR)
 * Auto-aggregates output VAT from sales invoices and TDS withheld from invoice payments
 * for the selected month. Input VAT (Section 4) is left for purchase module integration.
 */
export default function Mushak91Page() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12

  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const from = useMemo(() => `${year}-${String(month).padStart(2, "0")}-01`, [year, month]);
  const to = useMemo(() => {
    const d = new Date(year, month, 0); // last day of month
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [year, month]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from("sales_invoice_items_v2")
        .select("qty,rate,vat_pct,vat_amount,line_total,invoice:sales_invoices_v2!inner(invoice_number,invoice_date,status,customer:customers(name))")
        .gte("invoice.invoice_date", from)
        .lte("invoice.invoice_date", to),
      supabase.from("invoice_payments")
        .select("payment_number,payment_date,amount_received,tds_amount,total_settled,invoice_id,invoice:sales_invoices_v2(invoice_number,customer:customers(name))")
        .gte("payment_date", from)
        .lte("payment_date", to),
    ]).then(([it, pay]) => {
      setItems((it.data || []) as any[]);
      setPayments((pay.data || []) as any[]);
      setLoading(false);
    });
  }, [from, to]);

  // Group output VAT by rate bucket
  const buckets = useMemo(() => {
    const map: Record<string, { rate: number; taxable: number; vat: number; gross: number }> = {};
    items.forEach((r: any) => {
      const rate = Number(r.vat_pct || 0);
      const key = rate.toFixed(2);
      const taxable = Number(r.qty) * Number(r.rate);
      const vat = Number(r.vat_amount || 0);
      if (!map[key]) map[key] = { rate, taxable: 0, vat: 0, gross: 0 };
      map[key].taxable += taxable;
      map[key].vat += vat;
      map[key].gross += Number(r.line_total || 0);
    });
    return Object.values(map).sort((a, b) => a.rate - b.rate);
  }, [items]);

  const totalTaxable = buckets.reduce((s, b) => s + b.taxable, 0);
  const totalOutputVat = buckets.reduce((s, b) => s + b.vat, 0);
  const totalTds = payments.reduce((s, p) => s + Number(p.tds_amount || 0), 0);
  const totalCollected = payments.reduce((s, p) => s + Number(p.total_settled || 0), 0);
  const netVatPayable = totalOutputVat - totalTds; // simplified; input VAT credit = 0 here

  const n = (v: number) => v.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const onExport = () => {
    exportCsv(`mushak-9.1-${year}-${String(month).padStart(2, "0")}.csv`,
      buckets.map((b) => ({ "VAT Rate %": b.rate, "Taxable Value": b.taxable.toFixed(2), "VAT Amount": b.vat.toFixed(2), "Gross Sales": b.gross.toFixed(2) })),
      ["VAT Rate %", "Taxable Value", "VAT Amount", "Gross Sales"]);
  };

  return (
    <div className="p-6 space-y-4 print:p-0">
      <div className="flex justify-between items-center print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Mushak 9.1 — মাসিক মূসক দাখিলপত্র</h1>
          <p className="text-sm text-muted-foreground">Monthly VAT Return Summary (NBR Bangladesh)</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onExport}><Download className="w-4 h-4 mr-1" />CSV</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
        </div>
      </div>

      <Card className="p-4 flex gap-3 items-end print:hidden">
        <div>
          <label className="text-xs">Tax Period — Month</label>
          <select className="block border rounded px-2 h-10 bg-background" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" })}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs">Year</label>
          <input type="number" className="block border rounded px-2 h-10 w-28 bg-background" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
        <div className="text-sm text-muted-foreground ml-4">Period: <b>{from}</b> → <b>{to}</b></div>
      </Card>

      <div className="space-y-4">
        <Card className="p-4">
          <h2 className="font-semibold mb-2">Section 3 — Output Tax (Sales / Supply)</h2>
          <Table>
            <TableHeader><TableRow>
              <TableHead>VAT Rate %</TableHead>
              <TableHead className="text-right">Taxable Value (BDT)</TableHead>
              <TableHead className="text-right">VAT Amount (BDT)</TableHead>
              <TableHead className="text-right">Gross Sales (BDT)</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {buckets.map((b) => (
                <TableRow key={b.rate}>
                  <TableCell>{b.rate.toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{n(b.taxable)}</TableCell>
                  <TableCell className="text-right">{n(b.vat)}</TableCell>
                  <TableCell className="text-right">{n(b.gross)}</TableCell>
                </TableRow>
              ))}
              {!buckets.length && <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">{loading ? "Loading…" : "No sales in this period"}</TableCell></TableRow>}
              {buckets.length > 0 && (
                <TableRow className="font-bold bg-muted/50">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{n(totalTaxable)}</TableCell>
                  <TableCell className="text-right">{n(totalOutputVat)}</TableCell>
                  <TableCell className="text-right">{n(totalTaxable + totalOutputVat)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-2">Section 4 — Input Tax (Purchase Credit)</h2>
          <p className="text-sm text-muted-foreground">Input VAT credit is sourced from the Purchase module. Integration pending — enter manually on Mushak 9.1 form if applicable.</p>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-2">Section 5 — TDS / VDS Withheld at Source</h2>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Receipt No</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Amount Received</TableHead>
              <TableHead className="text-right">TDS Withheld</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {payments.filter((p) => Number(p.tds_amount) > 0).map((p, i) => (
                <TableRow key={i}>
                  <TableCell>{p.payment_number}</TableCell>
                  <TableCell>{p.payment_date}</TableCell>
                  <TableCell>{p.invoice?.customer?.name}</TableCell>
                  <TableCell>{p.invoice?.invoice_number}</TableCell>
                  <TableCell className="text-right">{n(Number(p.amount_received))}</TableCell>
                  <TableCell className="text-right">{n(Number(p.tds_amount))}</TableCell>
                </TableRow>
              ))}
              {payments.filter((p) => Number(p.tds_amount) > 0).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">No TDS entries</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <Card className="p-4 bg-muted/20">
          <h2 className="font-semibold mb-3">Summary — Net VAT Payable</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><div className="text-xs text-muted-foreground">Total Taxable Sales</div><div className="text-lg font-bold">{n(totalTaxable)}</div></div>
            <div><div className="text-xs text-muted-foreground">Output VAT</div><div className="text-lg font-bold">{n(totalOutputVat)}</div></div>
            <div><div className="text-xs text-muted-foreground">TDS Withheld (Credit)</div><div className="text-lg font-bold">{n(totalTds)}</div></div>
            <div><div className="text-xs text-muted-foreground">Net VAT Payable</div><div className="text-xl font-bold text-primary">{n(netVatPayable)}</div></div>
            <div className="col-span-2"><div className="text-xs text-muted-foreground">Total Cash Collected</div><div className="text-lg font-bold">{n(totalCollected)}</div></div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            This summary is a working draft for filing Mushak 9.1 with the NBR. Verify totals against
            your purchase ledger and adjust for input tax credit, advance VAT, and decreasing/increasing adjustments before submission.
          </p>
        </Card>
      </div>
      <ReportPrintFooter />
    </div>
  );
}
