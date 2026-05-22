import { useEffect, useState } from "react";
import { swApi } from "@/lib/sales-workflow-api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function TdsRegisterPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => { swApi.listTds({ from, to }).then(({ data }) => setRows(data || [])); }, [from, to]);
  const total = rows.reduce((s, r) => s + Number(r.tds_amount || 0), 0);
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">TDS Register</h1>
      <Card className="p-4 flex gap-3">
        <div><label className="text-sm">From</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="text-sm">To</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>TDS No</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Cert No</TableHead><TableHead>Cert Date</TableHead><TableHead className="text-right">TDS %</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.tds_number}</TableCell>
                <TableCell>{r.invoice?.invoice_number}</TableCell>
                <TableCell>{r.invoice?.customer?.name}</TableCell>
                <TableCell>{r.certificate_no}</TableCell>
                <TableCell>{r.certificate_date}</TableCell>
                <TableCell className="text-right">{r.tds_pct}</TableCell>
                <TableCell className="text-right">{Number(r.tds_amount).toFixed(2)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No TDS entries</TableCell></TableRow>}
          </TableBody>
        </Table>
        <div className="p-4 text-right font-bold">Total TDS: {total.toFixed(2)}</div>
      </Card>
    </div>
  );
}
