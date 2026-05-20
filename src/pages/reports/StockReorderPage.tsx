import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { ReportHeader } from "@/components/ReportHeader";

const StockReorderPage = () => {
  const [items, setItems] = useState<any[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [iRes, sRes] = await Promise.all([
        supabase.from("item_master").select("*").eq("status", "active").neq("item_type", "service"),
        supabase.from("warehouse_stock").select("item_id, quantity"),
      ]);
      const map: Record<string, number> = {};
      (sRes.data || []).forEach((s: any) => { map[s.item_id] = (map[s.item_id] || 0) + Number(s.quantity); });
      setStock(map);
      setItems(iRes.data || []);
    })();
  }, []);

  const rows = useMemo(() => {
    return items
      .map((i) => {
        const qty = stock[i.id] || 0;
        const min = Number(i.min_stock_level) || 0;
        const reorder = min > 0 ? Math.max(0, min - qty) : 0;
        return { ...i, qty, min, reorder };
      })
      .filter((r) => r.min > 0 && r.qty < r.min)
      .filter((r) =>
        !search || r.item_code.toLowerCase().includes(search.toLowerCase()) || r.item_name.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => b.reorder - a.reorder);
  }, [items, stock, search]);

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <ReportHeader reportTitle="Stock Reorder Report" />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold flex items-center gap-2"><RefreshCw className="w-5 h-5 text-primary" />Stock Reorder</h1>
        <Input placeholder="Search code or name..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Code</TableHead><TableHead>Item</TableHead>
            <TableHead className="text-right">Current Stock</TableHead>
            <TableHead className="text-right">Min Level</TableHead>
            <TableHead className="text-right">Reorder Qty</TableHead>
            <TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.item_code}</TableCell>
                <TableCell className="font-medium">{r.item_name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{r.min}</TableCell>
                <TableCell className="text-right tabular-nums font-bold text-destructive">{r.reorder}</TableCell>
                <TableCell>{r.qty <= 0 ? <Badge variant="destructive">Out</Badge> : <Badge variant="secondary">Low</Badge>}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No reorder needed.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default StockReorderPage;
