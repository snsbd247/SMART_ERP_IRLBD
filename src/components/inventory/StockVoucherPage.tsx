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
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { ProductCombobox } from "@/components/inventory/ProductCombobox";

export interface StockVoucherConfig {
  title: string;
  entryTable: string;
  itemTable: string;
  sequenceId: string;
  movementType: string;
  referenceType: string;
  /** +1 = stock in, -1 = stock out */
  direction: 1 | -1;
}

interface Item { id: string; item_id: string; quantity: string; unit_cost: string; }
interface Product { id: string; item_code: string; item_name: string; cost_price: number; }

export default function StockVoucherPage({ config }: { config: StockVoucherConfig }) {
  const { user } = useAuth();
  const { userBranchId } = useBranch();
  const { toast } = useToast();
  const [entries, setEntries] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([
    { id: crypto.randomUUID(), item_id: "", quantity: "", unit_cost: "" },
  ]);

  const fetchAll = async () => {
    setLoading(true);
    const [eRes, pRes] = await Promise.all([
      supabase.from(config.entryTable as any).select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("item_master").select("id, item_code, item_name, cost_price").eq("status", "active").order("item_name"),
    ]);
    setEntries((eRes.data as any[]) || []);
    setProducts((pRes.data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  const addRow = () => setItems([...items, { id: crypto.randomUUID(), item_id: "", quantity: "", unit_cost: "" }]);
  const removeRow = (id: string) => setItems(items.filter((r) => r.id !== id));
  const updateRow = (id: string, key: keyof Item, value: string) => {
    setItems(items.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, [key]: value };
      if (key === "item_id") {
        const p = products.find((x) => x.id === value);
        if (p) next.unit_cost = String(p.cost_price);
      }
      return next;
    }));
  };

  const total = items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_cost) || 0), 0);

  const reset = () => {
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setItems([{ id: crypto.randomUUID(), item_id: "", quantity: "", unit_cost: "" }]);
  };

  const handleSave = async () => {
    const valid = items.filter((i) => i.item_id && parseFloat(i.quantity) > 0);
    if (valid.length === 0) {
      toast({ title: "Add at least one item with quantity", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const voucher = await nextNumber(config.sequenceId);
      const branchId = userBranchId || null;

      const { data: entry, error: eErr } = await supabase
        .from(config.entryTable as any)
        .insert({
          voucher_number: voucher,
          entry_date: date,
          branch_id: branchId,
          notes: notes || null,
          status: "posted",
          created_by: user?.id,
        } as any)
        .select()
        .single();
      if (eErr) throw eErr;

      const rows = valid.map((i) => ({
        entry_id: (entry as any).id,
        item_id: i.item_id,
        quantity: parseFloat(i.quantity),
        unit_cost: parseFloat(i.unit_cost) || 0,
      }));
      const { error: iErr } = await supabase.from(config.itemTable as any).insert(rows as any);
      if (iErr) throw iErr;

      await recordBulkStockMovements(
        valid.map((i) => ({ product_id: i.item_id, quantity: parseFloat(i.quantity) })),
        config.movementType,
        config.referenceType,
        voucher,
        branchId,
        config.direction,
      );

      toast({ title: `${config.title} ${voucher} saved` });
      setOpen(false);
      reset();
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">{config.title}</h1>
        <Button size="sm" onClick={() => { reset(); setOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />New {config.title}
        </Button>
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Voucher #</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : entries.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No entries yet</TableCell></TableRow>
            ) : entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs font-medium">{e.voucher_number}</TableCell>
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
          <DialogHeader><DialogTitle>New {config.title}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-2"><Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className="border rounded-md">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-32 text-right">Quantity</TableHead>
                  <TableHead className="w-32 text-right">Unit Cost</TableHead>
                  <TableHead className="w-32 text-right">Total</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {items.map((r) => {
                    const lineTotal = (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_cost) || 0);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <ProductCombobox products={products} value={r.item_id} onChange={(v) => updateRow(r.id, "item_id", v)} />
                        </TableCell>
                        <TableCell><Input type="number" min="0" className="text-right" value={r.quantity} onChange={(e) => updateRow(r.id, "quantity", e.target.value)} /></TableCell>
                        <TableCell><Input type="number" min="0" className="text-right" value={r.unit_cost} onChange={(e) => updateRow(r.id, "unit_cost", e.target.value)} /></TableCell>
                        <TableCell className="text-right tabular-nums">{lineTotal.toFixed(2)}</TableCell>
                        <TableCell>
                          {items.length > 1 && (
                            <Button size="icon" variant="ghost" onClick={() => removeRow(r.id)}><Trash2 className="w-4 h-4" /></Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Button variant="outline" size="sm" onClick={addRow}><Plus className="w-4 h-4 mr-1" />Add Row</Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-semibold">Grand Total</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{total.toFixed(2)}</TableCell>
                    <TableCell />
                  </TableRow>
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
