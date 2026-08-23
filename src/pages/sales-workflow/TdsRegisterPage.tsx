import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Eye, Trash2 } from "lucide-react";
import { ReportPrintFooter } from "@/components/reports/ReportPrintFooter";

import { DateInput } from "@/components/ui/date-input";
export default function TdsRegisterPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const load = () => swApi.listTds({ from, to }).then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, [from, to]);
  const total = rows.reduce((s, r) => s + Number(r.tds_amount || 0), 0);
  const remove = async (r: any) => {
    if (!confirm(`Delete TDS entry for ${r.invoice?.invoice_number || "this invoice"}? This does not refund the invoice automatically.`)) return;
    const { error } = await swApi.deleteTds(r.id);
    if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
    toast({ title: "TDS entry deleted" });
    load();
  };
  const handlePrint = () => window.print();
  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">TDS Register</h1>
        <Button variant="outline" onClick={handlePrint}>Print</Button>
      </div>
      <Card className="p-4 flex gap-3">
        <div><label className="text-sm">From</label><DateInput value={from} onChange={(v) => setFrom(v)} /></div>
        <div><label className="text-sm">To</label><DateInput value={to} onChange={(v) => setTo(v)} /></div>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Cert No</TableHead><TableHead>Cert Date</TableHead><TableHead className="text-right">TDS %</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.invoice?.invoice_number}</TableCell>
                <TableCell>{r.invoice?.customer?.name}</TableCell>
                <TableCell>{r.certificate_no}</TableCell>
                <TableCell>{r.certificate_date}</TableCell>
                <TableCell className="text-right">{r.tds_pct}</TableCell>
                <TableCell className="text-right">{Number(r.tds_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <Link to={`/sales-workflow/invoice/${r.invoice_id}`}>
                    <Button size="icon" variant="ghost" title="View invoice"><Eye className="w-4 h-4" /></Button>
                  </Link>
                  <Button size="icon" variant="ghost" className="text-destructive" title="Delete" onClick={() => remove(r)}><Trash2 className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No TDS entries</TableCell></TableRow>}
          </TableBody>
        </Table>
        <div className="p-4 text-right font-bold">Total TDS: {total.toFixed(2)}</div>
      </Card>
      <ReportPrintFooter />
    </div>
  );
}
