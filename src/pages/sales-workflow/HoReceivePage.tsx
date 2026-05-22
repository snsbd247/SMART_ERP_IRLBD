import { useEffect, useState } from "react";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";

export default function HoReceivePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const load = () => swApi.listDeliveryChallans({ status: "sent_to_ho" }).then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (selected.size === 0) return;
    for (const id of selected) await swApi.hoReceive(id, { ho_receive_date: date });
    toast({ title: `${selected.size} DCs marked HO received` });
    setSelected(new Set()); load();
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">HO Receive (Head Office Inbox)</h1>
      <Card className="p-4 flex gap-3 items-end">
        <div><label className="text-sm">HO Receive Date</label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <Button onClick={submit} disabled={selected.size === 0}>Confirm {selected.size}</Button>
      </Card>
      <Card>
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
    </div>
  );
}
