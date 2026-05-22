import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";

export default function InvoicesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { swApi.listInvoices({ q }).then(({ data }) => setRows(data || [])); }, [q]);
  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between"><h1 className="text-2xl font-bold">Invoices (V2)</h1>
        <Link to="/sales-workflow/invoice-queue"><Button><Plus className="w-4 h-4 mr-2" />New from Queue</Button></Link>
      </div>
      <Card className="p-4"><Input placeholder="Search invoice no..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" /></Card>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>No</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Mode</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Due</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.invoice_number}</TableCell>
                <TableCell>{r.invoice_date}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell>{r.mode}</TableCell>
                <TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.paid_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.due_amount).toFixed(2)}</TableCell>
                <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                <TableCell><Link to={`/sales-workflow/invoice/${r.id}`}><Button size="sm" variant="ghost">View</Button></Link></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No invoices</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
