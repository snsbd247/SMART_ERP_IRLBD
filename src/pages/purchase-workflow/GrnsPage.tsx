import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Eye } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";

export default function GrnsPage() {
  const nav = useNavigate();
  const { fc } = useCurrency();
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("grns" as any).select("*, suppliers(name), purchase_orders_v2(po_number)").order("created_at", { ascending: false })
      .then(({ data }) => setList((data as any) || []));
  }, []);
  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Goods Receipts (GRN)</CardTitle>
          <Button onClick={() => nav("/purchase-workflow/grn/new")}><Plus className="w-4 h-4 mr-2" />New GRN</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>GRN #</TableHead><TableHead>Date</TableHead><TableHead>PO #</TableHead><TableHead>Supplier</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {list.map(g => (
                <TableRow key={g.id}>
                  <TableCell className="font-mono">{g.grn_number}</TableCell>
                  <TableCell>{g.grn_date}</TableCell>
                  <TableCell className="font-mono">{g.purchase_orders_v2?.po_number}</TableCell>
                  <TableCell>{g.suppliers?.name}</TableCell>
                  <TableCell>{fc(g.total_amount)}</TableCell>
                  <TableCell><Badge>{g.status}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => nav(`/purchase-workflow/grn/${g.id}`)}><Eye className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
              {!list.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No GRNs yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
