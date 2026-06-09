import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Printer, PackageCheck } from "lucide-react";

export default function PoDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [po, setPo] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [supplier, setSupplier] = useState<any>(null);
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  const load = async () => {
    const { data: p } = await supabase.from("purchase_orders_v2").select("*").eq("id", id).single();
    setPo(p);
    if (p) {
      supabase.from("suppliers").select("*").eq("id", (p as any).supplier_id).single().then(({ data }) => setSupplier(data));
      const { data: its } = await supabase.from("purchase_order_items_v2").select("*").eq("po_id", id);
      setItems(its || []);
      const pids = (its || []).map((x: any) => x.product_id);
      if (pids.length) {
        const { data: prods } = await supabase.from("item_master").select("id, item_name").in("id", pids);
        const m: Record<string, string> = {}; (prods || []).forEach((p: any) => { m[p.id] = p.item_name; });
        setProductNames(m);
      }
    }
  };
  useEffect(() => { load(); }, [id]);

  if (!po) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-bold">{po.po_number}</h1>
          <Badge>{po.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
          {po.status !== "closed" && <Button size="sm" onClick={() => navigate(`/purchase-workflow/grn/new?po=${po.id}`)}><PackageCheck className="w-4 h-4 mr-1" />Receive (GRN)</Button>}
        </div>
      </div>
      <Card><CardContent className="p-6 space-y-4">
        <div className="text-center">
          <h2 className="text-2xl font-bold">PURCHASE ORDER</h2>
          <p className="text-sm text-muted-foreground">{po.po_number}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-semibold mb-1">Supplier:</div>
            <div>{supplier?.name}</div>
            {supplier?.address && <div className="text-muted-foreground">{supplier.address}</div>}
            {supplier?.bin_number && <div>BIN: {supplier.bin_number}</div>}
          </div>
          <div className="text-right">
            <div><span className="text-muted-foreground">Date:</span> {po.po_date}</div>
            <div><span className="text-muted-foreground">Status:</span> {po.status}</div>
          </div>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty Ordered</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">VAT %</TableHead><TableHead className="text-right">Line Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(it => (
              <TableRow key={it.id}>
                <TableCell>{productNames[it.product_id] || "—"}</TableCell>
                <TableCell className="text-right">{it.qty_ordered}</TableCell>
                <TableCell className="text-right">{it.qty_received}</TableCell>
                <TableCell className="text-right">{Number(it.rate).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(it.vat_pct).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(it.line_total).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-end text-sm">
          <div className="w-64 space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span>{Number(po.subtotal).toFixed(2)}</span></div>
            <div className="flex justify-between"><span>VAT</span><span>{Number(po.vat_amount).toFixed(2)}</span></div>
            <div className="flex justify-between font-bold border-t pt-1"><span>Grand Total</span><span>{Number(po.grand_total).toFixed(2)}</span></div>
          </div>
        </div>
        {po.notes && <div className="text-sm"><span className="font-semibold">Notes:</span> {po.notes}</div>}
      </CardContent></Card>
    </div>
  );
}
