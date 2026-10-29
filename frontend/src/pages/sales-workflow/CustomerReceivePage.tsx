import { useEffect, useState } from "react";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Trash2 } from "lucide-react";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { ListPagination } from "@/components/sales-workflow/ListPagination";

import { DateInput } from "@/components/ui/date-input";
export default function CustomerReceivePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historySelected, setHistorySelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [receiver, setReceiver] = useState("");
  const { paged: historyPaged, page, setPage, pageSize, setPageSize, totalPages, total } = usePagedRows(history);

  const load = async () => {
    const { data } = await swApi.listDeliveryChallans({ status: "delivered" });
    setRows(data || []);
    const { data: h } = await swApi.listCustomerReceives();
    setHistory(h || []);
    setSelected(new Set());
    setHistorySelected(new Set());
  };
  useEffect(() => { load(); }, []);

  const toggle = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const toggleHistory = (id: string) => {
    setHistorySelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAllHistory = () => {
    const pageIds = historyPaged.map((r) => r.id);
    const allOnPageSelected = pageIds.every((id) => historySelected.has(id));
    setHistorySelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allOnPageSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) return toast({ title: "Select at least one DC", variant: "destructive" });
    for (const id of selected) {
      await swApi.customerReceive(id, { receive_date: date, received_by_name: receiver });
    }
    toast({ title: `${selected.size} DCs marked as customer received` });
    setSelected(new Set()); load();
  };

  const remove = async (rec: any) => {
    if (!confirm(`Delete this receive entry? DC will revert to delivered.`)) return;
    await swApi.deleteCustomerReceive(rec.id, rec.delivery_challan_id);
    toast({ title: "Receive entry deleted" });
    load();
  };

  const removeSelectedHistory = async () => {
    if (!confirm(`Delete ${historySelected.size} selected receive entr${historySelected.size === 1 ? "y" : "ies"}? Linked DC(s) will revert to delivered.`)) return;
    for (const id of historySelected) {
      const rec = history.find((h) => h.id === id);
      if (rec) await swApi.deleteCustomerReceive(rec.id, rec.delivery_challan_id);
    }
    toast({ title: `${historySelected.size} receive entr${historySelected.size === 1 ? "y" : "ies"} deleted` });
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Customer Receive</h1>
      <Card className="p-4 grid md:grid-cols-3 gap-3 items-end">
        <div><label className="text-sm">Receive Date</label><DateInput value={date} onChange={(v) => setDate(v)} /></div>
        <div><label className="text-sm">Received By</label><Input value={receiver} onChange={(e) => setReceiver(e.target.value)} placeholder="Name" /></div>
        <Button onClick={submit} disabled={selected.size === 0}>Mark {selected.size} Received</Button>
      </Card>
      <Card>
        <div className="p-3 font-semibold border-b">Pending (Delivered DCs)</div>
        <Table>
          <TableHeader><TableRow><TableHead></TableHead><TableHead>DC</TableHead><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Qty</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                <TableCell>{r.dc_number}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell>{r.product?.name}</TableCell>
                <TableCell>{r.qty}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No DCs awaiting customer receive</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <Card>
        <div className="p-3 font-semibold border-b flex items-center justify-between">
          <span>Receive History</span>
          {historySelected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={removeSelectedHistory}>
              <Trash2 className="w-4 h-4 mr-1.5" />Delete Selected ({historySelected.size})
            </Button>
          )}
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10"><Checkbox checked={historyPaged.length > 0 && historyPaged.every((r) => historySelected.has(r.id))} onCheckedChange={toggleAllHistory} /></TableHead>
            <TableHead>DC</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Received By</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {historyPaged.map((h: any) => (
              <TableRow key={h.id} className={historySelected.has(h.id) ? "bg-muted/50" : ""}>
                <TableCell><Checkbox checked={historySelected.has(h.id)} onCheckedChange={() => toggleHistory(h.id)} /></TableCell>
                <TableCell>{h.dc?.dc_number}</TableCell>
                <TableCell>{h.dc?.customer?.name}</TableCell>
                <TableCell>{h.receive_date}</TableCell>
                <TableCell>{h.received_by_name}</TableCell>
                <TableCell className="max-w-xs truncate">{h.notes}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(h)}><Trash2 className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {history.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No receive history</TableCell></TableRow>}
          </TableBody>
        </Table>
        <ListPagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </Card>
    </div>
  );
}
