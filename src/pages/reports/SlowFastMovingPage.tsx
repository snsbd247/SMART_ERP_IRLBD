import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TrendingUp } from "lucide-react";
import { ReportHeader } from "@/components/ReportHeader";

const SlowFastMovingPage = () => {
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [days, setDays] = useState(90);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const [iRes, mRes] = await Promise.all([
        supabase.from("item_master").select("id, item_code, item_name, item_type").neq("item_type", "service"),
        supabase.from("stock_movements").select("product_id, item_id, quantity, created_at").gte("created_at", since),
      ]);
      setItems(iRes.data || []);
      setMovements(mRes.data || []);
    })();
  }, [days]);

  const stats = useMemo(() => {
    const map = new Map<string, { outQty: number; inQty: number; txCount: number }>();
    movements.forEach((m) => {
      const id = m.item_id || m.product_id;
      if (!id) return;
      const cur = map.get(id) || { outQty: 0, inQty: 0, txCount: 0 };
      const q = Number(m.quantity);
      if (q < 0) cur.outQty += Math.abs(q);
      else cur.inQty += q;
      cur.txCount += 1;
      map.set(id, cur);
    });
    return items.map((i) => ({ ...i, ...(map.get(i.id) || { outQty: 0, inQty: 0, txCount: 0 }) }));
  }, [items, movements]);

  const fast = [...stats].sort((a, b) => b.outQty - a.outQty).slice(0, 50);
  const slow = [...stats].filter((s) => s.outQty === 0).slice(0, 100);

  const renderRows = (rows: any[]) => rows.map((r) => (
    <TableRow key={r.id}>
      <TableCell className="font-mono text-xs">{r.item_code}</TableCell>
      <TableCell className="font-medium">{r.item_name}</TableCell>
      <TableCell className="text-right tabular-nums text-green-600">{r.inQty}</TableCell>
      <TableCell className="text-right tabular-nums text-red-600">{r.outQty}</TableCell>
      <TableCell className="text-right tabular-nums">{r.txCount}</TableCell>
    </TableRow>
  ));

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <ReportHeader reportTitle={`Slow / Fast Moving (${days} days)`} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" />Slow / Fast Moving Items</h1>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">Days</Label><Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value) || 90)} className="w-24" /></div>
        </div>
      </div>
      <Tabs defaultValue="fast">
        <TabsList>
          <TabsTrigger value="fast">Fast Moving (Top 50)</TabsTrigger>
          <TabsTrigger value="slow">Slow / Non-Moving</TabsTrigger>
        </TabsList>
        <TabsContent value="fast">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Code</TableHead><TableHead>Item</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Tx Count</TableHead>
              </TableRow></TableHeader>
              <TableBody>{renderRows(fast)}{fast.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>}</TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="slow">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Code</TableHead><TableHead>Item</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Tx Count</TableHead>
              </TableRow></TableHeader>
              <TableBody>{renderRows(slow)}{slow.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">All items moved.</TableCell></TableRow>}</TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SlowFastMovingPage;
