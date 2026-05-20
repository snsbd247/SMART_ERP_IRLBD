import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DollarSign } from "lucide-react";
import { ReportHeader } from "@/components/ReportHeader";
import { useCurrency } from "@/contexts/CurrencyContext";

const ProfitabilityPage = () => {
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const { fc } = useCurrency();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("item_master")
        .select("id, item_code, item_name, item_type, cost_price, selling_price")
        .eq("status", "active")
        .neq("item_type", "service");
      setItems(data || []);
    })();
  }, []);

  const rows = useMemo(() => items
    .map((i) => {
      const cost = Number(i.cost_price) || 0;
      const price = Number(i.selling_price) || 0;
      const profit = price - cost;
      const margin = price > 0 ? (profit / price) * 100 : 0;
      return { ...i, cost, price, profit, margin };
    })
    .filter((r) => !search || r.item_code.toLowerCase().includes(search.toLowerCase()) || r.item_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.margin - a.margin),
    [items, search]);

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <ReportHeader reportTitle="Product Profitability Report" />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" />Profitability</h1>
        <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Code</TableHead><TableHead>Item</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Sell Price</TableHead>
            <TableHead className="text-right">Profit/Unit</TableHead>
            <TableHead className="text-right">Margin %</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.item_code}</TableCell>
                <TableCell className="font-medium">{r.item_name}</TableCell>
                <TableCell className="text-right tabular-nums">{fc(r.cost)}</TableCell>
                <TableCell className="text-right tabular-nums">{fc(r.price)}</TableCell>
                <TableCell className={`text-right tabular-nums font-medium ${r.profit < 0 ? "text-destructive" : "text-green-600"}`}>{fc(r.profit)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <Badge variant={r.margin < 0 ? "destructive" : r.margin < 10 ? "secondary" : "default"}>{r.margin.toFixed(1)}%</Badge>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No items.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default ProfitabilityPage;
