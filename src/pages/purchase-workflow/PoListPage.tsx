import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Eye } from "lucide-react";

const statusColor: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/15 text-blue-700",
  partial_received: "bg-amber-500/15 text-amber-700",
  received: "bg-emerald-500/15 text-emerald-700",
  closed: "bg-muted text-muted-foreground",
};

export default function PoListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from("purchase_orders_v2").select("*").order("created_at", { ascending: false }).then(({ data }) => setRows(data || []));
    supabase.from("suppliers").select("id, name").then(({ data }) => {
      const m: Record<string, string> = {}; (data || []).forEach((s: any) => { m[s.id] = s.name; }); setSuppliers(m);
    });
  }, []);

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Purchase Orders</h1>
        <Button size="sm" onClick={() => navigate("/purchase-workflow/po/new")}><Plus className="w-4 h-4 mr-1" />New PO</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>PO #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="w-16"></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell><Link to={`/purchase-workflow/po/${r.id}`} className="text-primary hover:underline">{r.po_number}</Link></TableCell>
                <TableCell>{r.po_date}</TableCell>
                <TableCell>{suppliers[r.supplier_id] || "—"}</TableCell>
                <TableCell><Badge className={statusColor[r.status] || ""}>{r.status}</Badge></TableCell>
                <TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/purchase-workflow/po/${r.id}`)}><Eye className="w-3.5 h-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No POs</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
