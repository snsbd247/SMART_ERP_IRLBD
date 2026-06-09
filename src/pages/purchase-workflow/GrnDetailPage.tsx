import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Printer, FileText } from "lucide-react";

export default function GrnDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [grn, setGrn] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [supplier, setSupplier] = useState<any>(null);
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data: g } = await supabase.from("grns").select("*").eq("id", id).single();
      setGrn(g);
      if (g) {
        supabase.from("suppliers").select("*").eq("id", (g as any).supplier_id).single().then(({ data }) => setSupplier(data));
        const { data: its } = await supabase.from("grn_items").select("*").eq("grn_id", id);
        setItems(its || []);
        const pids = (its || []).map((x: any) => x.product_id);
        if (pids.length) {
          const { data: prods } = await supabase.from("item_master").select("id, item_name").in("id", pids);
          const m: Record<string, string> = {}; (prods || []).forEach((p: any) => { m[p.id] = p.item_name; });
          setProductNames(m);
        }
      }
    })();
  }, [id]);

  if (!grn) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-bold">{grn.grn_number}</h1>
          <Badge>{grn.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
          <Button size="sm" onClick={() => navigate(`/purchase-workflow/bills/new?supplier=${grn.supplier_id}&grn=${grn.id}`)}><FileText className="w-4 h-4 mr-1" />Enter Bill</Button>
        </div>
      </div>
      <Card><CardContent className="p-6 space-y-4">
        <div className="text-center"><h2 className="text-2xl font-bold">GOODS RECEIPT NOTE</h2><p className="text-sm text-muted-foreground">{grn.grn_number}</p></div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-semibold">Supplier:</div>
            <div>{supplier?.name}</div>
            {supplier?.bin_number && <div>BIN: {supplier.bin_number}</div>}
          </div>
          <div className="text-right">
            <div><span className="text-muted-foreground">Date:</span> {grn.grn_date}</div>
            <div><span className="text-muted-foreground">Supplier Inv:</span> {grn.supplier_invoice_no || "—"} {grn.supplier_invoice_date}</div>
          </div>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty Received</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Line Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(it => (
              <TableRow key={it.id}>
                <TableCell>{productNames[it.product_id] || "—"}</TableCell>
                <TableCell className="text-right">{it.qty_received}</TableCell>
                <TableCell className="text-right">{Number(it.rate).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(it.line_total).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-end font-bold">Total: {Number(grn.total_amount).toFixed(2)}</div>
      </CardContent></Card>
    </div>
  );
}
