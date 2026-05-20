import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Package, AlertTriangle, PackageX, TrendingUp } from "lucide-react";
import { ReportHeader } from "@/components/ReportHeader";
import { useCurrency } from "@/contexts/CurrencyContext";

const InventoryMisReportPage = () => {
  const [items, setItems] = useState<any[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [movements, setMovements] = useState<any[]>([]);
  const { fc } = useCurrency();

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [iRes, sRes, mRes] = await Promise.all([
        supabase.from("item_master").select("*").neq("item_type", "service"),
        supabase.from("warehouse_stock").select("item_id, quantity"),
        supabase.from("stock_movements").select("product_id, item_id, quantity, movement_type, created_at").gte("created_at", since),
      ]);
      const map: Record<string, number> = {};
      (sRes.data || []).forEach((s: any) => { map[s.item_id] = (map[s.item_id] || 0) + Number(s.quantity); });
      setStock(map);
      setItems(iRes.data || []);
      setMovements(mRes.data || []);
    })();
  }, []);

  const kpis = useMemo(() => {
    let totalValue = 0, outCount = 0, lowCount = 0;
    items.forEach((i) => {
      const qty = stock[i.id] || 0;
      totalValue += qty * (Number(i.cost_price) || 0);
      if (qty <= 0) outCount++;
      else if (Number(i.min_stock_level) > 0 && qty < Number(i.min_stock_level)) lowCount++;
    });
    let inMov = 0, outMov = 0;
    movements.forEach((m) => {
      const q = Number(m.quantity);
      if (q > 0) inMov += q; else outMov += Math.abs(q);
    });
    return { totalValue, outCount, lowCount, totalItems: items.length, inMov, outMov };
  }, [items, stock, movements]);

  const topMovers = useMemo(() => {
    const map = new Map<string, number>();
    movements.forEach((m) => {
      const id = m.item_id || m.product_id;
      if (!id || Number(m.quantity) >= 0) return;
      map.set(id, (map.get(id) || 0) + Math.abs(Number(m.quantity)));
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    return Array.from(map.entries())
      .map(([id, qty]) => ({ item: itemMap.get(id), qty }))
      .filter((r) => r.item)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);
  }, [movements, items]);

  const Kpi = ({ icon: Icon, label, value, color }: any) => (
    <Card><CardContent className="p-4 flex items-center gap-3">
      <div className={`p-2 rounded ${color}`}><Icon className="w-5 h-5 text-white" /></div>
      <div><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-bold">{value}</div></div>
    </CardContent></Card>
  );

  return (
    <div className="p-4 lg:p-6 max-w-[1300px] mx-auto space-y-4">
      <ReportHeader reportTitle="Inventory MIS Report" />
      <div className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" /><h1 className="text-xl font-bold">Inventory MIS Report</h1></div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={Package} label="Total Items" value={kpis.totalItems} color="bg-primary" />
        <Kpi icon={BarChart3} label="Stock Value" value={fc(kpis.totalValue)} color="bg-blue-600" />
        <Kpi icon={AlertTriangle} label="Low Stock" value={kpis.lowCount} color="bg-warning" />
        <Kpi icon={PackageX} label="Out of Stock" value={kpis.outCount} color="bg-destructive" />
        <Kpi icon={TrendingUp} label="In (30d)" value={kpis.inMov} color="bg-green-600" />
        <Kpi icon={TrendingUp} label="Out (30d)" value={kpis.outMov} color="bg-red-600" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Top 10 Moving Items (Last 30 days)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>#</TableHead><TableHead>Code</TableHead><TableHead>Item</TableHead>
              <TableHead className="text-right">Total Out Qty</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {topMovers.map((r, idx) => (
                <TableRow key={r.item.id}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{r.item.item_code}</TableCell>
                  <TableCell className="font-medium">{r.item.item_name}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{r.qty}</TableCell>
                </TableRow>
              ))}
              {topMovers.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No movements in last 30 days.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryMisReportPage;
