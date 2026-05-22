import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";

export default function DispatchPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => { swApi.listDispatches({ q, status }).then(({ data }) => setRows(data || [])); }, [q, status]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between"><h1 className="text-2xl font-bold">Dispatches</h1>
        <Link to="/sales-workflow/dispatch/new"><Button><Plus className="w-4 h-4 mr-2" />New Dispatch</Button></Link>
      </div>
      <Card className="p-4 flex gap-2">
        <Input placeholder="Search dispatch number..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 bg-background">
          <option value="">All</option><option value="draft">Draft</option><option value="dispatched">Dispatched</option><option value="delivered">Delivered</option><option value="received">Received</option>
        </select>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>No</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Vehicle</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.dispatch_number}</TableCell>
                <TableCell>{r.dispatch_date}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell>{r.vehicle_no}</TableCell>
                <TableCell>{r.total_qty}</TableCell>
                <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                <TableCell><Link to={`/sales-workflow/dispatch/${r.id}`}><Button size="sm" variant="ghost">View</Button></Link></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No dispatches</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
