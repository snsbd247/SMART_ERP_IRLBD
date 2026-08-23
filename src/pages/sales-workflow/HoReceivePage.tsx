import { useEffect, useState } from "react";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Trash2 } from "lucide-react";

import { DateInput } from "@/components/ui/date-input";
export default function HoReceivePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const load = async () => {
    const { data } = await swApi.listDeliveryChallans({ status: "sent_to_ho" });
    setRows(data || []);
    const { data: h } = await swApi.listHoReceives();
    setHistory(h || []);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (selected.size === 0) return;
    for (const id of selected) await swApi.hoReceive(id, { ho_receive_date: date });
    toast({ title: `${selected.size} DCs marked HO received` });
    setSelected(new Set()); load();
  };

  const remove = async (rec: any) => {
    if (!confirm(`Delete this HO receive entry? DC reverts to sent_to_ho.`)) return;
    await swApi.deleteHoReceive(rec.id, rec.delivery_challan_id);
    toast({ title: "HO receive entry deleted" });
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">HO Receive (Head Office Inbox)</h1>
      <Card className="p-4 flex gap-3 items-end">
        <div><label className="text-sm">HO Receive Date</label><DateInput value={date} onChange={(v) => setDate(v)} /></div>
        <Button onClick={submit} disabled={selected.size === 0}>Confirm {selected.size}</Button>
      </Card>
      <Card>
        <div className="p-3 font-semibold border-b">Pending (Sent to HO)</div>
        <Table>
          <TableHeader><TableRow><TableHead></TableHead><TableHead>DC</TableHead><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Qty</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => { const s = new Set(selected); s.has(r.id) ? s.delete(r.id) : s.add(r.id); setSelected(s); }} /></TableCell>
                <TableCell>{r.dc_number}</TableCell><TableCell>{r.customer?.name}</TableCell><TableCell>{r.product?.name}</TableCell><TableCell>{r.qty}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No DCs awaiting HO receive</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <Card>
        <div className="p-3 font-semibold border-b">HO Receive History</div>
        <Table>
          <TableHeader><TableRow><TableHead>DC</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Verified By</TableHead><TableHead>Missing</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {history.map((h: any) => (
              <TableRow key={h.id}>
                <TableCell>{h.dc?.dc_number}</TableCell>
                <TableCell>{h.dc?.customer?.name}</TableCell>
                <TableCell>{h.ho_receive_date}</TableCell>
                <TableCell>{h.verified_by}</TableCell>
                <TableCell>{h.missing_flag ? "Yes" : "No"}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(h)}><Trash2 className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {history.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No HO receive history</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
