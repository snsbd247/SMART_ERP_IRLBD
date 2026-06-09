import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";

export default function PoDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { fc } = useCurrency();
  const [po, setPo] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      supabase.from("purchase_orders_v2" as any).select("*, suppliers(name)").eq("id", id).single(),
      supabase.from("purchase_order_items_v2" as any).select("*, products(product_name, product_code)").eq("po_id", id),
    ]).then(([p, it]) => { setPo(p.data); setItems((it.data as any) || []); });
  }, [id]);

  if (!po) return <div className="p-6">Loading...</div>;
  const canReceive = po.status !== "closed" && items.some(i => i.qty_ordered > i.qty_received);

  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" onClick={() => nav("/purchase-workflow/po")}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{po.po_number} <Badge className="ml-2">{po.status}</Badge></CardTitle>
          {canReceive && <Button onClick={() => nav(`/purchase-workflow/grn/new?po=${po.id}`)}><PackageCheck className="w-4 h-4 mr-2" />Create GRN</Button>}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
            <div><span className="text-muted-foreground">Date:</span> {po.po_date}</div>
            <div><span className="text-muted-foreground">Supplier:</span> {po.suppliers?.name}</div>
            <div><span className="text-muted-foreground">Grand Total:</span> <b>{fc(po.grand_total)}</b></div>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Ordered</TableHead><TableHead>Received</TableHead><TableHead>Rate</TableHead><TableHead>VAT%</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map(i => (
                <TableRow key={i.id}>
                  <TableCell>{i.products?.product_code} - {i.products?.product_name}</TableCell>
                  <TableCell>{i.qty_ordered}</TableCell>
                  <TableCell>{i.qty_received}</TableCell>
                  <TableCell>{i.rate}</TableCell>
                  <TableCell>{i.vat_pct}%</TableCell>
                  <TableCell className="text-right">{fc(i.line_total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {po.notes && <p className="mt-4 text-sm"><b>Notes:</b> {po.notes}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
