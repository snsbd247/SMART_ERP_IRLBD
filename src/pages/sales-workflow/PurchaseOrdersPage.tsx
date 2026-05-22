import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

export default function PurchaseOrdersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const load = async () => {
    const { data } = await swApi.listPOs({ q, status });
    setRows(data || []);
  };
  useEffect(() => { load(); }, [q, status]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <Link to="/sales-workflow/po/new"><Button><Plus className="w-4 h-4 mr-2" />New PO</Button></Link>
      </div>
      <Card className="p-4 flex gap-2 flex-wrap">
        <Input placeholder="Search PO number..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 bg-background">
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="partial">Partial</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </Card>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.po_number}</TableCell>
                <TableCell>{r.po_date}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell className="text-right">{Number(r.subtotal).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.vat_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell>
                <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                <TableCell><Link to={`/sales-workflow/po/${r.id}`}><Button size="sm" variant="ghost">View</Button></Link></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No purchase orders</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
