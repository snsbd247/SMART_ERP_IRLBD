import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Eye } from "lucide-react";

export default function GrnsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [sup, setSup] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from("grns").select("*").order("created_at", { ascending: false }).then(({ data }) => setRows(data || []));
    supabase.from("suppliers").select("id, name").then(({ data }) => { const m: Record<string, string> = {}; (data || []).forEach((s: any) => { m[s.id] = s.name; }); setSup(m); });
  }, []);

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Goods Receipt Notes (GRN)</h1>
        <Button size="sm" onClick={() => navigate("/purchase-workflow/grn/new")}><Plus className="w-4 h-4 mr-1" />New GRN</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>GRN #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Inv #</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-16"></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell><Link to={`/purchase-workflow/grn/${r.id}`} className="text-primary hover:underline">{r.grn_number}</Link></TableCell>
                <TableCell>{r.grn_date}</TableCell>
                <TableCell>{sup[r.supplier_id] || "—"}</TableCell>
                <TableCell>{r.supplier_invoice_no || "—"}</TableCell>
                <TableCell className="text-right">{Number(r.total_amount).toFixed(2)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/purchase-workflow/grn/${r.id}`)}><Eye className="w-3.5 h-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No GRNs</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
