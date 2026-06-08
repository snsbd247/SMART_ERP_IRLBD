import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PrintPO } from "@/components/sales-workflow/SalesWorkflowPrints";

export default function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const [po, setPo] = useState<any>(null);

  useEffect(() => { swApi.getPO(id!).then(({ data }) => setPo(data)); }, [id]);
  if (!po) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{po.po_number}</h1>
          <p className="text-muted-foreground">{po.customer?.name} • {po.po_date}</p>
        </div>
        <div className="flex items-center gap-2">
          <PrintPO po={po} />
          <Badge>{po.status}</Badge>
        </div>
      </div>
      <Card className="p-4">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Product</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">VAT %</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {po.items?.map((it: any) => (
              <TableRow key={it.id}>
                <TableCell>{it.product?.name}</TableCell>
                <TableCell className="text-right">{it.qty_ordered}</TableCell>
                <TableCell className="text-right">{it.qty_delivered}</TableCell>
                <TableCell className="text-right">{it.qty_remaining}</TableCell>
                <TableCell className="text-right">{Number(it.rate).toFixed(2)}</TableCell>
                <TableCell className="text-right">{it.vat_pct}</TableCell>
                <TableCell className="text-right">{Number(it.line_total).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-4 text-right">
          <div>Subtotal: {Number(po.subtotal).toFixed(2)}</div>
          <div>VAT: {Number(po.vat_amount).toFixed(2)}</div>
          <div className="font-bold text-lg">Total: {Number(po.grand_total).toFixed(2)}</div>
        </div>
      </Card>
      <div className="flex gap-2 flex-wrap">
        <Link to="/sales-workflow/po"><Button variant="outline">Back</Button></Link>
        <Link to={`/sales-workflow/po/${po.id}/edit`}><Button variant="outline">Edit</Button></Link>
        <Link to={`/sales-workflow/vat-challan/new?po=${po.id}`}><Button>Issue VAT Challan</Button></Link>
      </div>
    </div>
  );
}
