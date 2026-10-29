import { useEffect, useState } from "react";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { PrintDeliveryChallan } from "@/components/sales-workflow/SalesWorkflowPrints";
import { Trash2 } from "lucide-react";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { ListPagination } from "@/components/sales-workflow/ListPagination";

const STATUS_COLORS: Record<string, string> = {
  issued: "secondary", delivered: "outline", customer_received: "default",
  sent_to_ho: "outline", ho_received: "default", invoiced: "default",
};

export default function DeliveryChallansPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { paged, page, setPage, pageSize, setPageSize, totalPages, total } = usePagedRows(rows);

  const load = () => swApi.listDeliveryChallans({ q, status }).then(({ data }) => { setRows(data || []); setSelected(new Set()); });
  useEffect(() => { load(); }, [q, status]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    const pageIds = paged.map((r) => r.id);
    const allOnPageSelected = pageIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allOnPageSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const advance = async (r: any, next: string) => {
    await swApi.setDCStatus(r.id, next);
    toast({ title: `${r.dc_number} → ${next}` });
    load();
  };

  const removeOne = async (r: any) => {
    if (!confirm(`Delete DC ${r.dc_number}?`)) return;
    const { error } = await swApi.deleteDeliveryChallan(r.id);
    if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
    toast({ title: "DC deleted" });
    load();
  };

  const removeSelected = async () => {
    if (!confirm(`Delete ${selected.size} selected Delivery Challan(s)?`)) return;
    for (const id of selected) await swApi.deleteDeliveryChallan(id);
    toast({ title: `${selected.size} DC(s) deleted` });
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Delivery Challans</h1>
      <Card className="p-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-2">
          <Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 bg-background">
            <option value="">All</option>
            {["issued", "delivered", "customer_received", "sent_to_ho", "ho_received", "invoiced"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={removeSelected}>
            <Trash2 className="w-4 h-4 mr-1.5" />Delete Selected ({selected.size})
          </Button>
        )}
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10"><Checkbox checked={paged.length > 0 && paged.every((r) => selected.has(r.id))} onCheckedChange={toggleAll} /></TableHead>
            <TableHead>DC</TableHead><TableHead>Date</TableHead><TableHead>VAT Ch.</TableHead><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead><TableHead>Quick Action</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {paged.map((r) => (
              <TableRow key={r.id} className={selected.has(r.id) ? "bg-muted/50" : ""}>
                <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                <TableCell className="font-medium">{r.dc_number}</TableCell>
                <TableCell>{r.dc_date}</TableCell>
                <TableCell>{r.vat_challan?.challan_number}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell>{r.product?.name}</TableCell>
                <TableCell>{r.qty}</TableCell>
                <TableCell><Badge variant={(STATUS_COLORS[r.status] as any) || "secondary"}>{r.status}</Badge></TableCell>
                <TableCell className="space-x-1">
                  <PrintDeliveryChallan dc={r} />
                  {r.status === "issued" && <Button size="sm" variant="outline" onClick={() => advance(r, "delivered")}>Deliver</Button>}
                  {r.status === "delivered" && <Button size="sm" variant="outline" onClick={() => advance(r, "customer_received")}>Cust. Receive</Button>}
                  {r.status === "customer_received" && <Button size="sm" variant="outline" onClick={() => advance(r, "sent_to_ho")}>Send to HO</Button>}
                  {r.status === "sent_to_ho" && <Button size="sm" variant="outline" onClick={() => advance(r, "ho_received")}>HO Receive</Button>}
                  <Button size="icon" variant="ghost" title="Delete" className="text-destructive" onClick={() => removeOne(r)}><Trash2 className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No delivery challans</TableCell></TableRow>}
          </TableBody>
        </Table>
        <ListPagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </Card>
    </div>
  );
}
