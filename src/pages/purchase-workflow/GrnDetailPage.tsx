import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";

export default function GrnDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { fc } = useCurrency();
  const [g, setG] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    if (!id) return;
    Promise.all([
      supabase.from("grns" as any).select("*, suppliers(name), purchase_orders_v2(po_number)").eq("id", id).single(),
      supabase.from("grn_items" as any).select("*, products(product_name, product_code)").eq("grn_id", id),
    ]).then(([a, b]) => { setG(a.data); setItems((b.data as any) || []); });
  }, [id]);
  if (!g) return <div className="p-6">Loading...</div>;
  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" onClick={() => nav("/purchase-workflow/grn")}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{g.grn_number} <Badge className="ml-2">{g.status}</Badge></CardTitle>
          <Button onClick={() => nav(`/purchase-workflow/bills/new?grn=${g.id}`)}><FileText className="w-4 h-4 mr-2" />Create Bill</Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 mb-4 text-sm">
            <div><span className="text-muted-foreground">Date:</span> {g.grn_date}</div>
            <div><span className="text-muted-foreground">PO:</span> {g.purchase_orders_v2?.po_number}</div>
            <div><span className="text-muted-foreground">Supplier:</span> {g.suppliers?.name}</div>
            <div><span className="text-muted-foreground">Supplier Inv:</span> {g.supplier_invoice_no || "-"}</div>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Received</TableHead><TableHead>Rate</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map(i => (
                <TableRow key={i.id}>
                  <TableCell>{i.products?.product_code} - {i.products?.product_name}</TableCell>
                  <TableCell>{i.qty_received}</TableCell>
                  <TableCell>{i.rate}</TableCell>
                  <TableCell className="text-right">{fc(i.line_total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="text-right mt-4 text-lg">Total: <b>{fc(g.total_amount)}</b></div>
        </CardContent>
      </Card>
    </div>
  );
}
