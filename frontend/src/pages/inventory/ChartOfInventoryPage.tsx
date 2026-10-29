import { useEffect, useMemo, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { ChevronRight, ChevronDown, FolderTree, Package, Search } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";

interface StockGroup { id: string; name: string; parent_id: string | null; }
interface Item {
  id: string; item_code: string; item_name: string; item_type: string;
  stock_group_id: string | null; opening_stock: number; cost_price: number; selling_price: number;
}

const ChartOfInventoryPage = () => {
  const { fc } = useCurrency();
  const [groups, setGroups] = useState<StockGroup[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [gRes, iRes] = await Promise.all([
        (dataClient.from as any)("stock_groups").select("id, name, parent_id").order("name"),
        dataClient.from("item_master").select("id, item_code, item_name, item_type, stock_group_id, opening_stock, cost_price, selling_price").order("item_name"),
      ]);
      setGroups((gRes.data || []) as StockGroup[]);
      setItems(((iRes.data || []) as unknown) as Item[]);
      setLoading(false);
    })();
  }, []);

  const childGroups = useMemo(() => {
    const m = new Map<string, StockGroup[]>();
    groups.forEach((g) => {
      const k = g.parent_id || "__root__";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(g);
    });
    return m;
  }, [groups]);

  const itemsByGroup = useMemo(() => {
    const m = new Map<string, Item[]>();
    items.forEach((i) => {
      const k = i.stock_group_id || "__unassigned__";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    });
    return m;
  }, [items]);

  // Compute total opening stock per group including nested children
  const groupTotals = useMemo(() => {
    const totals = new Map<string, number>();
    const computeFor = (groupId: string): number => {
      if (totals.has(groupId)) return totals.get(groupId)!;
      let sum = (itemsByGroup.get(groupId) || []).reduce((s, it) => s + (Number(it.opening_stock) || 0), 0);
      (childGroups.get(groupId) || []).forEach((c) => { sum += computeFor(c.id); });
      totals.set(groupId, sum);
      return sum;
    };
    groups.forEach((g) => computeFor(g.id));
    return totals;
  }, [groups, childGroups, itemsByGroup]);

  const matches = (name: string) => !search || name.toLowerCase().includes(search.toLowerCase());

  const toggle = (id: string) => {
    setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const renderGroup = (group: StockGroup, depth: number): React.ReactNode[] => {
    const kids = childGroups.get(group.id) || [];
    const groupItems = itemsByGroup.get(group.id) || [];
    const hasChildren = kids.length > 0 || groupItems.length > 0;
    const isOpen = expanded.has(group.id);
    const rows: React.ReactNode[] = [];

    rows.push(
      <TableRow key={`g-${group.id}`} className="bg-muted/30">
        <TableCell>
          <div className="flex items-center" style={{ paddingLeft: depth * 20 }}>
            {hasChildren ? (
              <button onClick={() => toggle(group.id)} className="mr-1 text-muted-foreground hover:text-foreground">
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            ) : <span className="w-5" />}
            <FolderTree className="w-4 h-4 mr-2 text-primary" />
            <span className="font-semibold">{group.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">({groupItems.length} items)</span>
          </div>
        </TableCell>
        <TableCell colSpan={3}></TableCell>
        <TableCell className="text-right tabular-nums font-semibold">{groupTotals.get(group.id) || 0}</TableCell>
      </TableRow>
    );

    if (isOpen) {
      kids.forEach((k) => rows.push(...renderGroup(k, depth + 1)));
      groupItems.filter((i) => matches(i.item_name) || matches(i.item_code)).forEach((it) => {
        rows.push(
          <TableRow key={`i-${it.id}`}>
            <TableCell>
              <div className="flex items-center" style={{ paddingLeft: (depth + 1) * 20 + 20 }}>
                <Package className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                <span>{it.item_name}</span>
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">{it.item_code}</TableCell>
            <TableCell className="text-xs capitalize">{it.item_type.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-right tabular-nums">{fc(Number(it.cost_price) || 0)}</TableCell>
            <TableCell className="text-right tabular-nums">{Number(it.opening_stock) || 0}</TableCell>
          </TableRow>
        );
      });
    }
    return rows;
  };

  const rootGroups = childGroups.get("__root__") || [];
  const unassigned = itemsByGroup.get("__unassigned__") || [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><FolderTree className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold text-foreground">Chart of Inventory</h1></div>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group / Item</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Opening Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            ) : (
              <>
                {rootGroups.flatMap((g) => renderGroup(g, 0))}
                {unassigned.length > 0 && (
                  <>
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={4}>
                        <div className="flex items-center">
                          <button onClick={() => toggle("__unassigned__")} className="mr-1 text-muted-foreground hover:text-foreground">
                            {expanded.has("__unassigned__") ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                          <FolderTree className="w-4 h-4 mr-2 text-muted-foreground" />
                          <span className="font-semibold text-muted-foreground">Unassigned</span>
                          <span className="ml-2 text-xs text-muted-foreground">({unassigned.length} items)</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {unassigned.reduce((s, it) => s + (Number(it.opening_stock) || 0), 0)}
                      </TableCell>
                    </TableRow>
                    {expanded.has("__unassigned__") && unassigned.filter((i) => matches(i.item_name) || matches(i.item_code)).map((it) => (
                      <TableRow key={`i-${it.id}`}>
                        <TableCell>
                          <div className="flex items-center pl-10">
                            <Package className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                            <span>{it.item_name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{it.item_code}</TableCell>
                        <TableCell className="text-xs capitalize">{it.item_type.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{fc(Number(it.cost_price) || 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(it.opening_stock) || 0}</TableCell>
                      </TableRow>
                    ))}
                  </>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default ChartOfInventoryPage;
