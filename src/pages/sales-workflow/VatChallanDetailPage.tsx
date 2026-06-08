import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PrintVatChallan } from "@/components/sales-workflow/SalesWorkflowPrints";

export default function VatChallanDetailPage() {
  const { id } = useParams();
  const [v, setV] = useState<any>(null);
  useEffect(() => { swApi.getVatChallan(id!).then(({ data }) => setV(data)); }, [id]);
  if (!v) return <div className="p-6">Loading…</div>;
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex justify-between">
        <div><h1 className="text-2xl font-bold">{v.challan_number}</h1>
          <p className="text-muted-foreground">{v.customer?.name} • {v.challan_date}</p></div>
        <div className="flex items-center gap-2"><PrintVatChallan v={v} /><Badge>{v.status}</Badge></div>
      </div>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Items</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Rate</TableHead><TableHead>VAT %</TableHead><TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {v.items?.map((it: any) => (
              <TableRow key={it.id}><TableCell>{it.product?.name}</TableCell><TableCell>{it.qty}</TableCell><TableCell>{Number(it.rate).toFixed(2)}</TableCell><TableCell>{it.vat_pct}</TableCell><TableCell className="text-right">{Number(it.vat_amount).toFixed(2)}</TableCell><TableCell className="text-right">{Number(it.line_total).toFixed(2)}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="text-right mt-3"><div>Subtotal: {Number(v.subtotal).toFixed(2)}</div><div>VAT: {Number(v.vat_amount).toFixed(2)}</div><div className="font-bold">Total: {Number(v.grand_total).toFixed(2)}</div></div>
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Auto-generated Delivery Challans</h3>
        <Table>
          <TableHeader><TableRow><TableHead>DC No</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {v.delivery_challans?.map((d: any) => (
              <TableRow key={d.id}><TableCell>{d.dc_number}</TableCell><TableCell><Badge variant="secondary">{d.status}</Badge></TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="flex gap-2">
        <Link to="/sales-workflow/vat-challan"><Button variant="outline">Back</Button></Link>
      </div>
    </div>
  );
}
