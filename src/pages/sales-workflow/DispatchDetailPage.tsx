import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const STATUSES = ["draft", "dispatched", "delivered", "received", "cancelled"];

export default function DispatchDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [d, setD] = useState<any>(null);
  const load = () => swApi.getDispatch(id!).then(({ data }) => setD(data));
  useEffect(() => { load(); }, [id]);

  if (!d) return <div className="p-6">Loading…</div>;
  const setStatus = async (s: string) => {
    await swApi.setDispatchStatus(id!, s, user?.id);
    toast({ title: `Status: ${s}` });
    load();
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex justify-between">
        <div><h1 className="text-2xl font-bold">{d.dispatch_number}</h1>
          <p className="text-muted-foreground">{d.customer?.name} • {d.dispatch_date} • Vehicle {d.vehicle_no || "-"}</p></div>
        <Badge>{d.status}</Badge>
      </div>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Items & Allocations</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>PO Allocations</TableHead></TableRow></TableHeader>
          <TableBody>
            {d.items?.map((it: any) => (
              <TableRow key={it.id}>
                <TableCell>{it.product?.name}</TableCell>
                <TableCell>{it.qty}</TableCell>
                <TableCell>
                  {it.allocations?.map((a: any) => (
                    <div key={a.id} className="text-sm">{a.po_item?.po?.po_number}: {a.allocated_qty}</div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Status</h3>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map((s) => <Button key={s} size="sm" variant={d.status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{s}</Button>)}
        </div>
      </Card>
      <div className="flex gap-2">
        <Link to="/sales-workflow/dispatch"><Button variant="outline">Back</Button></Link>
        <Link to={`/sales-workflow/vat-challan/new?dispatch=${d.id}`}><Button>Create VAT Challan</Button></Link>
      </div>
    </div>
  );
}
