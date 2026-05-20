import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ArrowRightLeft } from "lucide-react";
import { ReportHeader } from "@/components/ReportHeader";

const StockTransferRegisterPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [items, setItems] = useState<Record<string, any>>({});
  const [whs, setWhs] = useState<Record<string, any>>({});
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    (async () => {
      const [tRes, iRes, wRes] = await Promise.all([
        supabase.from("stock_transfers").select("*").order("transfer_date", { ascending: false }).limit(500),
        supabase.from("item_master").select("id, item_code, item_name"),
        supabase.from("warehouses").select("id, warehouse_name"),
      ]);
      const im: Record<string, any> = {}; (iRes.data || []).forEach((i: any) => im[i.id] = i);
      const wm: Record<string, any> = {}; (wRes.data || []).forEach((w: any) => wm[w.id] = w);
      setItems(im); setWhs(wm);
      setRows(tRes.data || []);
    })();
  }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (from && r.transfer_date < from) return false;
    if (to && r.transfer_date > to) return false;
    if (search) {
      const s = search.toLowerCase();
      const item = items[r.item_id];
      if (!r.transfer_number?.toLowerCase().includes(s) && !item?.item_name?.toLowerCase().includes(s) && !item?.item_code?.toLowerCase().includes(s)) return false;
    }
    return true;
  }), [rows, search, from, to, items]);

  return (
    <div className="p-4 lg:p-6 max-w-[1300px] mx-auto space-y-4">
      <ReportHeader reportTitle="Stock Transfer Register" />
      <div className="flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-primary" /><h1 className="text-xl font-bold">Stock Transfer Register</h1></div>
      <Card><CardContent className="py-3 flex flex-wrap gap-3 items-end">
        <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div className="flex-1 min-w-[200px]"><Label className="text-xs">Search</Label><Input placeholder="Transfer #, item..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </CardContent></Card>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Transfer #</TableHead><TableHead>Item</TableHead>
            <TableHead>From</TableHead><TableHead>To</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const item = items[r.item_id];
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{new Date(r.transfer_date).toLocaleDateString()}</TableCell>
                  <TableCell className="font-mono text-xs">{r.transfer_number}</TableCell>
                  <TableCell className="font-medium">{item?.item_name || "—"}<div className="text-xs text-muted-foreground font-mono">{item?.item_code}</div></TableCell>
                  <TableCell>{whs[r.from_warehouse_id]?.warehouse_name || "—"}</TableCell>
                  <TableCell>{whs[r.to_warehouse_id]?.warehouse_name || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell><Badge variant={r.status === "completed" ? "default" : "secondary"} className="capitalize text-xs">{r.status}</Badge></TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No transfers.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default StockTransferRegisterPage;
