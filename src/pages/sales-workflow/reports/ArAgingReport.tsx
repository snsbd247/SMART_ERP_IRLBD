import { useEffect, useState } from "react";
import { swReports, exportCsv } from "@/lib/sales-workflow-reports";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { ReportPrintFooter } from "@/components/reports/ReportPrintFooter";

export default function ArAgingReport() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { swReports.aging().then((d) => setRows(d || [])); }, []);

  const buckets = ["0-30", "31-60", "61-90", "90+"];
  const summary = buckets.map((b) => ({ bucket: b, total: rows.filter((r) => r.bucket === b).reduce((s, r) => s + Number(r.due_amount), 0) }));
  const grand = summary.reduce((s, b) => s + b.total, 0);

  const flat = rows.map((r) => ({
    invoice: r.invoice_number, date: r.invoice_date, customer: r.customer?.name,
    days: r.days, bucket: r.bucket, due: r.due_amount,
  }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center print:hidden">
        <h1 className="text-2xl font-bold">AR Aging (Sales Workflow)</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportCsv("ar-aging.csv", flat, ["invoice","date","customer","days","bucket","due"])}><Download className="w-4 h-4 mr-1" />CSV</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
        </div>
      </div>
      <Card className="p-4 grid grid-cols-4 gap-4">
        {summary.map((b) => (
          <div key={b.bucket} className="text-center">
            <div className="text-xs text-muted-foreground">{b.bucket} days</div>
            <div className="text-xl font-bold">{b.total.toFixed(2)}</div>
          </div>
        ))}
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Days</TableHead><TableHead>Bucket</TableHead><TableHead className="text-right">Due</TableHead></TableRow></TableHeader>
          <TableBody>
            {flat.map((r, i) => (
              <TableRow key={i}><TableCell>{r.invoice}</TableCell><TableCell>{r.date}</TableCell><TableCell>{r.customer}</TableCell><TableCell className="text-right">{r.days}</TableCell><TableCell><Badge variant="secondary">{r.bucket}</Badge></TableCell><TableCell className="text-right font-semibold">{(+r.due).toFixed(2)}</TableCell></TableRow>
            ))}
            {flat.length > 0 && <TableRow className="font-bold bg-muted/50"><TableCell colSpan={5}>Grand Total</TableCell><TableCell className="text-right">{grand.toFixed(2)}</TableCell></TableRow>}
            {flat.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No outstanding</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <ReportPrintFooter />
    </div>
  );
}
