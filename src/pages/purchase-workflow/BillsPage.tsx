import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Eye } from "lucide-react";

const statusColor: Record<string, string> = {
  unpaid: "bg-red-500/15 text-red-700",
  partial: "bg-amber-500/15 text-amber-700",
  paid: "bg-emerald-500/15 text-emerald-700",
};

export default function BillsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [sup, setSup] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.from("purchase_bills").select("*").order("created_at", { ascending: false }).then(({ data }) => setRows(data || []));
    supabase.from("suppliers").select("id, name").then(({ data }) => { const m: Record<string, string> = {}; (data || []).forEach((s: any) => { m[s.id] = s.name; }); setSup(m); });
  }, []);

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Purchase Bills</h1>
        <Button size="sm" onClick={() => navigate("/purchase-workflow/bills/new")}><Plus className="w-4 h-4 mr-1" />New Bill</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Bill #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Due Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="w-16"></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell><Link to={`/purchase-workflow/bills/${r.id}`} className="text-primary hover:underline">{r.bill_number}</Link></TableCell>
                <TableCell>{r.bill_date}</TableCell>
                <TableCell>{sup[r.supplier_id] || "—"}</TableCell>
                <TableCell>{r.due_date || "—"}</TableCell>
                <TableCell><Badge className={statusColor[r.status] || ""}>{r.status}</Badge></TableCell>
                <TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.paid_amount).toFixed(2)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/purchase-workflow/bills/${r.id}`)}><Eye className="w-3.5 h-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No bills</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
