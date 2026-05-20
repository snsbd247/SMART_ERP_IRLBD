import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layers } from "lucide-react";
import { ReportHeader } from "@/components/ReportHeader";

const BatchReportPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [items, setItems] = useState<Record<string, any>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [bRes, iRes] = await Promise.all([
        supabase.from("stock_batches" as any).select("*").order("exp_date", { ascending: true }),
        supabase.from("item_master").select("id, item_code, item_name"),
      ]);
      const map: Record<string, any> = {};
      (iRes.data || []).forEach((i: any) => { map[i.id] = i; });
      setItems(map);
      setRows((bRes.data as any[]) || []);
    })();
  }, []);

  const today = new Date();
  const filtered = useMemo(() => rows.filter((r) => {
    const item = items[r.item_id];
    if (!search) return true;
    const s = search.toLowerCase();
    return r.batch_no?.toLowerCase().includes(s) || item?.item_code?.toLowerCase().includes(s) || item?.item_name?.toLowerCase().includes(s);
  }), [rows, items, search]);

  const status = (exp: string | null) => {
    if (!exp) return <Badge variant="outline">—</Badge>;
    const d = new Date(exp);
    const diff = (d.getTime() - today.getTime()) / 86400000;
    if (diff < 0) return <Badge variant="destructive">Expired</Badge>;
    if (diff < 30) return <Badge className="bg-warning text-warning-foreground">Expiring</Badge>;
    return <Badge variant="secondary">Valid</Badge>;
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <ReportHeader reportTitle="Batch / Lot Report" />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold flex items-center gap-2"><Layers className="w-5 h-5 text-primary" />Batch Report</h1>
        <Input placeholder="Search batch or item..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Batch No</TableHead><TableHead>Item Code</TableHead><TableHead>Item</TableHead>
            <TableHead>Mfg Date</TableHead><TableHead>Exp Date</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const item = items[r.item_id];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.batch_no}</TableCell>
                  <TableCell className="font-mono text-xs">{item?.item_code || "—"}</TableCell>
                  <TableCell className="font-medium">{item?.item_name || "—"}</TableCell>
                  <TableCell className="text-sm">{r.mfg_date ? new Date(r.mfg_date).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-sm">{r.exp_date ? new Date(r.exp_date).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell>{status(r.exp_date)}</TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No batches.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default BatchReportPage;
