import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { PackageX } from "lucide-react";
import { ReportHeader } from "@/components/ReportHeader";

const OutOfStockPage = () => {
  const [items, setItems] = useState<any[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [iRes, sRes] = await Promise.all([
        supabase.from("item_master").select("id, item_code, item_name, item_type, unit_id").eq("status", "active").neq("item_type", "service"),
        supabase.from("warehouse_stock").select("item_id, quantity"),
      ]);
      const map: Record<string, number> = {};
      (sRes.data || []).forEach((s: any) => { map[s.item_id] = (map[s.item_id] || 0) + Number(s.quantity); });
      setStock(map);
      setItems(iRes.data || []);
    })();
  }, []);

  const rows = useMemo(() => items
    .map((i) => ({ ...i, qty: stock[i.id] || 0 }))
    .filter((r) => r.qty <= 0)
    .filter((r) => !search || r.item_code.toLowerCase().includes(search.toLowerCase()) || r.item_name.toLowerCase().includes(search.toLowerCase())),
    [items, stock, search]);

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <ReportHeader reportTitle="Out of Stock Report" />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold flex items-center gap-2"><PackageX className="w-5 h-5 text-destructive" />Out of Stock ({rows.length})</h1>
        <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Code</TableHead><TableHead>Item</TableHead><TableHead>Type</TableHead>
            <TableHead className="text-right">Stock</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.item_code}</TableCell>
                <TableCell className="font-medium">{r.item_name}</TableCell>
                <TableCell className="text-muted-foreground text-xs capitalize">{r.item_type?.replace("_", " ")}</TableCell>
                <TableCell className="text-right tabular-nums text-destructive font-bold">{r.qty}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">All items in stock.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default OutOfStockPage;
