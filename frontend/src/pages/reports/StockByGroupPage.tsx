import { useEffect, useMemo, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BarChart3, ChevronRight, ChevronDown, FolderTree, Package, Search, Download } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";

import { DateInput } from "@/components/ui/date-input";
interface StockGroup { id: string; name: string; parent_id: string | null; }
interface Item { id: string; item_code: string; item_name: string; stock_group_id: string | null; opening_stock: number; cost_price: number; }
interface Movement { product_id: string | null; item_id: string | null; stock_group_id: string | null; quantity: number; }

interface ItemAgg { item: Item; opening: number; inQty: number; outQty: number; closing: number; }
interface GroupAgg { group: StockGroup | null; opening: number; inQty: number; outQty: number; closing: number; items: ItemAgg[]; childIds: string[]; }

const StockByGroupPage = () => {
  const { fc } = useCurrency();
  const [groups, setGroups] = useState<StockGroup[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchAll = async () => {
    setLoading(true);
    const mvQ = dataClient.from("stock_movements").select("product_id, item_id, stock_group_id, quantity, created_at" as any).limit(20000);
    if (from) mvQ.gte("created_at", from);
    if (to) mvQ.lte("created_at", to + "T23:59:59");
    const [gRes, iRes, mRes] = await Promise.all([
      (dataClient.from as any)("stock_groups").select("id, name, parent_id").order("name"),
      dataClient.from("item_master").select("id, item_code, item_name, stock_group_id, opening_stock, cost_price"),
      mvQ,
    ]);
    setGroups((gRes.data || []) as StockGroup[]);
    setItems(((iRes.data || []) as unknown) as Item[]);
    setMovements(((mRes.data || []) as unknown) as Movement[]);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  const toggle = (id: string) => setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Item-level aggregation
  const itemAggs = useMemo<Map<string, ItemAgg>>(() => {
    const m = new Map<string, ItemAgg>();
    items.forEach((it) => m.set(it.id, { item: it, opening: Number(it.opening_stock) || 0, inQty: 0, outQty: 0, closing: Number(it.opening_stock) || 0 }));
    movements.forEach((mv) => {
      const id = (mv.item_id || mv.product_id) as string | null;
      if (!id || !m.has(id)) return;
      const agg = m.get(id)!;
      const q = Number(mv.quantity) || 0;
      if (q >= 0) agg.inQty += q; else agg.outQty += -q;
      agg.closing += q;
    });
    return m;
  }, [items, movements]);

  // Group hierarchy
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, StockGroup[]>();
    groups.forEach((g) => { const k = g.parent_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(g); });
    return m;
  }, [groups]);

  const itemsByGroup = useMemo(() => {
    const m = new Map<string | null, Item[]>();
    items.forEach((i) => { const k = i.stock_group_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(i); });
    return m;
  }, [items]);

  // Recursively aggregate per group (own items + descendants)
  const groupAggs = useMemo<Map<string, GroupAgg>>(() => {
    const m = new Map<string, GroupAgg>();
    const build = (g: StockGroup): GroupAgg => {
      const own = (itemsByGroup.get(g.id) || []).map((it) => itemAggs.get(it.id)!).filter(Boolean);
      let opening = 0, inQty = 0, outQty = 0, closing = 0;
      own.forEach((a) => { opening += a.opening; inQty += a.inQty; outQty += a.outQty; closing += a.closing; });
      const kids = (childrenOf.get(g.id) || []).map(build);
      kids.forEach((k) => { opening += k.opening; inQty += k.inQty; outQty += k.outQty; closing += k.closing; });
      const agg: GroupAgg = { group: g, opening, inQty, outQty, closing, items: own, childIds: kids.map((k) => k.group!.id) };
      m.set(g.id, agg);
      return agg;
    };
    groups.forEach((g) => { if (!m.has(g.id)) build(g); });
    return m;
  }, [groups, childrenOf, itemsByGroup, itemAggs]);

  const matches = (s: string) => !search || s.toLowerCase().includes(search.toLowerCase());

  const renderGroup = (g: StockGroup, depth: number): React.ReactNode[] => {
    const agg = groupAggs.get(g.id);
    if (!agg) return [];
    const kids = childrenOf.get(g.id) || [];
    const isOpen = expanded.has(g.id);
    const rows: React.ReactNode[] = [];
    rows.push(
      <TableRow key={`g-${g.id}`} className="bg-muted/30">
        <TableCell>
          <div className="flex items-center" style={{ paddingLeft: depth * 20 }}>
            {(kids.length > 0 || agg.items.length > 0) ? (
              <button onClick={() => toggle(g.id)} className="mr-1 text-muted-foreground hover:text-foreground">
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            ) : <span className="w-5 inline-block" />}
            <FolderTree className="w-4 h-4 mr-2 text-primary" />
            <span className="font-semibold">{g.name}</span>
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums font-semibold">{agg.opening}</TableCell>
        <TableCell className="text-right tabular-nums text-emerald-600 font-semibold">{agg.inQty}</TableCell>
        <TableCell className="text-right tabular-nums text-destructive font-semibold">{agg.outQty}</TableCell>
        <TableCell className="text-right tabular-nums font-semibold">{agg.closing}</TableCell>
      </TableRow>
    );
    if (isOpen) {
      kids.forEach((k) => rows.push(...renderGroup(k, depth + 1)));
      agg.items.filter((a) => matches(a.item.item_name) || matches(a.item.item_code)).forEach((a) => {
        rows.push(
          <TableRow key={`i-${a.item.id}`}>
            <TableCell>
              <div className="flex items-center" style={{ paddingLeft: (depth + 1) * 20 + 20 }}>
                <Package className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                <span className="text-sm">{a.item.item_name}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{a.item.item_code}</span>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{a.opening}</TableCell>
            <TableCell className="text-right tabular-nums text-emerald-600">{a.inQty}</TableCell>
            <TableCell className="text-right tabular-nums text-destructive">{a.outQty}</TableCell>
            <TableCell className="text-right tabular-nums">{a.closing}</TableCell>
          </TableRow>
        );
      });
    }
    return rows;
  };

  const roots = childrenOf.get(null) || [];

  // Unassigned items
  const unassignedItems = (itemsByGroup.get(null) || []).map((it) => itemAggs.get(it.id)!).filter(Boolean);
  const unassignedAgg = unassignedItems.reduce(
    (acc, a) => ({ opening: acc.opening + a.opening, inQty: acc.inQty + a.inQty, outQty: acc.outQty + a.outQty, closing: acc.closing + a.closing }),
    { opening: 0, inQty: 0, outQty: 0, closing: 0 }
  );

  // Grand totals
  const grand = roots.reduce(
    (acc, g) => {
      const a = groupAggs.get(g.id)!;
      return { opening: acc.opening + a.opening, inQty: acc.inQty + a.inQty, outQty: acc.outQty + a.outQty, closing: acc.closing + a.closing };
    },
    { ...unassignedAgg }
  );

  const exportCsv = () => {
    const lines = ["Group/Item,Opening,In,Out,Closing"];
    const walk = (g: StockGroup, depth: number) => {
      const a = groupAggs.get(g.id)!;
      lines.push(`"${"  ".repeat(depth)}${g.name}",${a.opening},${a.inQty},${a.outQty},${a.closing}`);
      (childrenOf.get(g.id) || []).forEach((c) => walk(c, depth + 1));
      a.items.forEach((it) => lines.push(`"${"  ".repeat(depth + 1)}${it.item.item_code} ${it.item.item_name}",${it.opening},${it.inQty},${it.outQty},${it.closing}`));
    };
    roots.forEach((g) => walk(g, 0));
    if (unassignedItems.length) {
      lines.push(`"Unassigned",${unassignedAgg.opening},${unassignedAgg.inQty},${unassignedAgg.outQty},${unassignedAgg.closing}`);
      unassignedItems.forEach((it) => lines.push(`"  ${it.item.item_code} ${it.item.item_name}",${it.opening},${it.inQty},${it.outQty},${it.closing}`));
    }
    lines.push(`"TOTAL",${grand.opening},${grand.inQty},${grand.outQty},${grand.closing}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `stock-by-group-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold text-foreground">Stock by Group</h1></div>
        <Button size="sm" variant="outline" onClick={exportCsv}><Download className="w-4 h-4 mr-1" />Export CSV</Button>
      </div>

      <div className="flex gap-3 items-end flex-wrap">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">From</label>
          <DateInput value={from} onChange={(v) => setFrom(v)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">To</label>
          <DateInput value={to} onChange={(v) => setTo(v)} className="w-40" />
        </div>
        <Button size="sm" onClick={fetchAll}>Apply</Button>
        <div className="relative ml-auto w-64">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group / Item</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">In</TableHead>
              <TableHead className="text-right">Out</TableHead>
              <TableHead className="text-right">Closing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            ) : (
              <>
                {roots.flatMap((g) => renderGroup(g, 0))}
                {unassignedItems.length > 0 && (
                  <>
                    <TableRow className="bg-muted/30">
                      <TableCell>
                        <div className="flex items-center">
                          <button onClick={() => toggle("__unassigned__")} className="mr-1 text-muted-foreground hover:text-foreground">
                            {expanded.has("__unassigned__") ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                          <FolderTree className="w-4 h-4 mr-2 text-muted-foreground" />
                          <span className="font-semibold text-muted-foreground">Unassigned</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{unassignedAgg.opening}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 font-semibold">{unassignedAgg.inQty}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive font-semibold">{unassignedAgg.outQty}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{unassignedAgg.closing}</TableCell>
                    </TableRow>
                    {expanded.has("__unassigned__") && unassignedItems.filter((a) => matches(a.item.item_name) || matches(a.item.item_code)).map((a) => (
                      <TableRow key={`i-${a.item.id}`}>
                        <TableCell>
                          <div className="flex items-center pl-10">
                            <Package className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                            <span className="text-sm">{a.item.item_name}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">{a.item.item_code}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{a.opening}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">{a.inQty}</TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">{a.outQty}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.closing}</TableCell>
                      </TableRow>
                    ))}
                  </>
                )}
                <TableRow className="bg-primary/10 border-t-2">
                  <TableCell className="font-bold">TOTAL</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{grand.opening}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold text-emerald-600">{grand.inQty}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold text-destructive">{grand.outQty}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{grand.closing}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </CardContent></Card>

      <div className="text-xs text-muted-foreground">
        {fc(0).replace(/[\d.,]/g, "")} Tip: Items show summed in/out from stock movements within the selected date range. Opening uses item master opening stock.
      </div>
    </div>
  );
};

export default StockByGroupPage;
