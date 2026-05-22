import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";

export default function VatChallansPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { swApi.listVatChallans({ q }).then(({ data }) => setRows(data || [])); }, [q]);
  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between"><h1 className="text-2xl font-bold">VAT Challans (Mushak 6.3)</h1>
        <Link to="/sales-workflow/vat-challan/new"><Button><Plus className="w-4 h-4 mr-2" />New Challan</Button></Link>
      </div>
      <Card className="p-4"><Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" /></Card>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>No</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Subtotal</TableHead><TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.challan_number}</TableCell>
                <TableCell>{r.challan_date}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell className="text-right">{Number(r.subtotal).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.vat_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell>
                <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                <TableCell><Link to={`/sales-workflow/vat-challan/${r.id}`}><Button size="sm" variant="ghost">View</Button></Link></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No VAT challans</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
