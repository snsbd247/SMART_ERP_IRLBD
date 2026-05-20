import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useToast } from "@/hooks/use-toast";
import { nextNumber } from "@/lib/db-utils";
import { recordBulkStockMovements } from "@/lib/transaction-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { ProductCombobox } from "@/components/inventory/ProductCombobox";

interface Row { id: string; item_id: string; system_qty: number; counted_qty: string; }

export default function PhysicalStockPage() {
  const { user } = useAuth();
  const { userBranchId } = useBranch();
  const { toast } = useToast();
  const [entries, setEntries] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { id: crypto.randomUUID(), item_id: "", system_qty: 0, counted_qty: "" },
  ]);

  const fetchAll = async () => {
    setLoading(true);
    const [eRes, pRes, mRes] = await Promise.all([
      supabase.from("physical_stock_entries" as any).select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("item_master").select("id, item_code, item_name, cost_price").eq("status", "active"),
      supabase.from("stock_movements").select("product_id, quantity"),
    ]);
    setEntries((eRes.data as any[]) || []);
    setProducts((pRes.data as any[]) || []);
    const map = new Map<string, number>();
    (mRes.data || []).forEach((m: any) => map.set(m.product_id, (map.get(m.product_id) || 0) + Number(m.quantity)));
    setStockMap(map);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const updateRow = (id: string, key: keyof Row, value: any) => {
    setRows(rows.map((r) => {
      if (r.id !== id) return r;
      const next: Row = { ...r, [key]: value };
      if (key === "item_id") next.system_qty = stockMap.get(value) || 0;
      return next;
    }));
  };
  const addRow = () => setRows([...rows, { id: crypto.randomUUID(), item_id: "", system_qty: 0, counted_qty: "" }]);
  const removeRow = (id: string) => setRows(rows.filter((r) => r.id !== id));

  const handleSave = async () => {
    const valid = rows.filter((r) => r.item_id && r.counted_qty !== "");
    if (valid.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const voucher = await nextNumber("physical_stock");
      const branchId = userBranchId || null;
      const { data: entry, error } = await supabase.from("physical_stock_entries" as any).insert({
        voucher_number: voucher, entry_date: date, branch_id: branchId, notes: notes || null,
        status: "posted", created_by: user?.id,
      } as any).select().single();
      if (error) throw error;

      const itemRows = valid.map((r) => {
        const counted = parseFloat(r.counted_qty) || 0;
        return {
          entry_id: (entry as any).id,
          item_id: r.item_id,
          system_qty: r.system_qty,
          counted_qty: counted,
          difference: counted - r.system_qty,
        };
      });
      const { error: iErr } = await supabase.from("physical_stock_items" as any).insert(itemRows as any);
      if (iErr) throw iErr;

      // Post stock movements for non-zero differences
      const movements = itemRows
        .filter((r) => r.difference !== 0)
        .map((r) => ({ product_id: r.item_id, quantity: r.difference }));
      if (movements.length > 0) {
        await recordBulkStockMovements(movements, "physical_adjustment", "physical_stock_entry", voucher, branchId, 1);
      }

      toast({ title: `Physical Stock ${voucher} saved` });
      setOpen(false);
      setRows([{ id: crypto.randomUUID(), item_id: "", system_qty: 0, counted_qty: "" }]);
      setNotes("");
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Physical Stock</h1>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />New Count</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Voucher #</TableHead><TableHead>Date</TableHead><TableHead>Notes</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              : entries.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No entries</TableCell></TableRow>
              : entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.voucher_number}</TableCell>
                  <TableCell>{e.entry_date}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{e.notes || "—"}</TableCell>
                  <TableCell>{e.status}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>New Physical Stock Count</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div className="space-y-2"><Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <div className="border rounded-md">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-32 text-right">System Qty</TableHead>
                  <TableHead className="w-32 text-right">Counted Qty</TableHead>
                  <TableHead className="w-32 text-right">Difference</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const diff = (parseFloat(r.counted_qty) || 0) - r.system_qty;
                    return (
                      <TableRow key={r.id}>
                        <TableCell><ProductCombobox products={products} value={r.item_id} onChange={(v) => updateRow(r.id, "item_id", v)} /></TableCell>
                        <TableCell className="text-right tabular-nums">{r.system_qty}</TableCell>
                        <TableCell><Input type="number" className="text-right" value={r.counted_qty} onChange={(e) => updateRow(r.id, "counted_qty", e.target.value)} /></TableCell>
                        <TableCell className={`text-right tabular-nums ${diff < 0 ? "text-destructive" : diff > 0 ? "text-green-600" : ""}`}>{diff}</TableCell>
                        <TableCell>
                          {rows.length > 1 && <Button size="icon" variant="ghost" onClick={() => removeRow(r.id)}><Trash2 className="w-4 h-4" /></Button>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow><TableCell colSpan={5}>
                    <Button variant="outline" size="sm" onClick={addRow}><Plus className="w-4 h-4 mr-1" />Add Row</Button>
                  </TableCell></TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
