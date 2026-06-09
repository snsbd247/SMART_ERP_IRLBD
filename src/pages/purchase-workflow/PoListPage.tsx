import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Eye } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";

export default function PoListPage() {
  const nav = useNavigate();
  const { fc } = useCurrency();
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("purchase_orders_v2" as any).select("*, suppliers(name)").order("created_at", { ascending: false })
      .then(({ data }) => setList((data as any) || []));
  }, []);
  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Purchase Orders</CardTitle>
          <Button onClick={() => nav("/purchase-workflow/po/new")}><Plus className="w-4 h-4 mr-2" />New PO</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>PO #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {list.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.po_number}</TableCell>
                  <TableCell>{p.po_date}</TableCell>
                  <TableCell>{p.suppliers?.name}</TableCell>
                  <TableCell>{fc(p.grand_total)}</TableCell>
                  <TableCell><Badge>{p.status}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => nav(`/purchase-workflow/po/${p.id}`)}><Eye className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
              {!list.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No POs yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
