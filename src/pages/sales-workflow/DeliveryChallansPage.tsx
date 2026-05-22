import { useEffect, useState } from "react";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  issued: "secondary", delivered: "outline", customer_received: "default",
  sent_to_ho: "outline", ho_received: "default", invoiced: "default",
};

export default function DeliveryChallansPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const load = () => swApi.listDeliveryChallans({ q, status }).then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, [q, status]);

  const advance = async (r: any, next: string) => {
    await swApi.setDCStatus(r.id, next);
    toast({ title: `${r.dc_number} → ${next}` });
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Delivery Challans</h1>
      <Card className="p-4 flex gap-2">
        <Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 bg-background">
          <option value="">All</option>
          {["issued", "delivered", "customer_received", "sent_to_ho", "ho_received", "invoiced"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>DC</TableHead><TableHead>Date</TableHead><TableHead>VAT Ch.</TableHead><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead><TableHead>Quick Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.dc_number}</TableCell>
                <TableCell>{r.dc_date}</TableCell>
                <TableCell>{r.vat_challan?.challan_number}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell>{r.product?.name}</TableCell>
                <TableCell>{r.qty}</TableCell>
                <TableCell><Badge variant={(STATUS_COLORS[r.status] as any) || "secondary"}>{r.status}</Badge></TableCell>
                <TableCell className="space-x-1">
                  {r.status === "issued" && <Button size="sm" variant="outline" onClick={() => advance(r, "delivered")}>Deliver</Button>}
                  {r.status === "delivered" && <Button size="sm" variant="outline" onClick={() => advance(r, "customer_received")}>Cust. Receive</Button>}
                  {r.status === "customer_received" && <Button size="sm" variant="outline" onClick={() => advance(r, "sent_to_ho")}>Send to HO</Button>}
                  {r.status === "sent_to_ho" && <Button size="sm" variant="outline" onClick={() => advance(r, "ho_received")}>HO Receive</Button>}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No delivery challans</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
