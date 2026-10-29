import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CheckCircle, Edit, Printer, RotateCcw } from "lucide-react";
import { postPurchaseReturn } from "@/lib/purchase-returns";

const PurchaseReturnDetailPage = () => {
  const { id } = useParams();
  const [ret, setRet] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [supplier, setSupplier] = useState<any>(null);

  const load = async () => {
    const { data: h } = await dataClient.from("purchase_returns_v2" as any).select("*").eq("id", id).maybeSingle();
    const { data: it } = await dataClient.from("purchase_return_items_v2" as any).select("*").eq("return_id", id).order("sort_order");
    setRet(h); setItems((it || []) as any);
    if ((h as any)?.supplier_id) {
      const { data: s } = await dataClient.from("suppliers" as any).select("*").eq("id", (h as any).supplier_id).maybeSingle();
      setSupplier(s);
    }
  };
  useEffect(() => { if (id) load(); }, [id]);

  const post = async () => {
    const { data: { user } } = await dataClient.auth.getUser();
    await postPurchaseReturn(ret, items, supplier?.purchase_type_id, user?.id);
    toast.success("Return posted (stock + GL)");
    load();
  };

  if (!ret) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 space-y-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <RotateCcw className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold">Return {ret.return_no}</h1>
          <Badge variant={ret.status === "posted" ? "default" : "outline"}>{ret.status}</Badge>
        </div>
        <div className="flex gap-2">
          {ret.status === "draft" && <Button asChild variant="outline" size="sm"><Link to={`/purchase/returns/${ret.id}/edit`}><Edit className="w-4 h-4 mr-1" />Edit</Link></Button>}
          {ret.status === "draft" && <Button size="sm" onClick={post}><CheckCircle className="w-4 h-4 mr-1" />Post</Button>}
          <Button className="print:hidden" variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
        </div>
      </div>
      <Card><CardContent className="p-4 grid md:grid-cols-4 gap-3 text-sm">
        <div><div className="text-muted-foreground">Supplier</div><div className="font-medium">{supplier?.name || "—"}</div></div>
        <div><div className="text-muted-foreground">Date</div><div>{ret.return_date}</div></div>
        <div><div className="text-muted-foreground">Reason</div><div>{ret.reason || "—"}</div></div>
        <div><div className="text-muted-foreground">Grand Total</div><div className="font-semibold">{Number(ret.grand_total).toFixed(2)}</div></div>
      </CardContent></Card>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit</TableHead><TableHead className="text-right">VAT%</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map((it: any, i: number) => (
              <TableRow key={i}>
                <TableCell>{it.description}</TableCell>
                <TableCell className="text-right font-mono">{it.quantity}</TableCell>
                <TableCell className="text-right font-mono">{Number(it.unit_cost).toFixed(2)}</TableCell>
                <TableCell className="text-right font-mono">{it.vat_rate}</TableCell>
                <TableCell className="text-right font-mono">{Number(it.line_total).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default PurchaseReturnDetailPage;
