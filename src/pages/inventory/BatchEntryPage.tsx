import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { ProductCombobox } from "@/components/inventory/ProductCombobox";

export default function BatchEntryPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ item_id: "", batch_no: "", mfg_date: "", exp_date: "", quantity: "", notes: "" });

  const load = async () => {
    const [bRes, pRes] = await Promise.all([
      supabase.from("stock_batches" as any).select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("item_master").select("id, item_code, item_name, cost_price").eq("status", "active"),
    ]);
    setRows((bRes.data as any[]) || []);
    setProducts((pRes.data as any[]) || []);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.item_id || !form.batch_no) { toast({ title: "Item & batch no required", variant: "destructive" }); return; }
    const payload: any = {
      item_id: form.item_id,
      batch_no: form.batch_no,
      mfg_date: form.mfg_date || null,
      exp_date: form.exp_date || null,
      quantity: parseFloat(form.quantity) || 0,
      notes: form.notes || null,
    };
    const { error } = await supabase.from("stock_batches" as any).insert(payload);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setOpen(false);
    setForm({ item_id: "", batch_no: "", mfg_date: "", exp_date: "", quantity: "", notes: "" });
    load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete?")) return;
    await supabase.from("stock_batches" as any).delete().eq("id", id);
    load();
  };

  const itemName = (id: string) => {
    const p = products.find((x) => x.id === id);
    return p ? `${p.item_code} — ${p.item_name}` : "—";
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Batch / Log Entry</h1>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />New Batch</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Batch No</TableHead><TableHead>Item</TableHead>
            <TableHead>MFG Date</TableHead><TableHead>EXP Date</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead className="w-16"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No batches</TableCell></TableRow>
              : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.batch_no}</TableCell>
                  <TableCell>{itemName(r.item_id)}</TableCell>
                  <TableCell>{r.mfg_date || "—"}</TableCell>
                  <TableCell>{r.exp_date || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => del(r.id)}><Trash2 className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Batch</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Item *</Label>
              <ProductCombobox products={products} value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Batch No *</Label><Input value={form.batch_no} onChange={(e) => setForm({ ...form, batch_no: e.target.value })} /></div>
              <div><Label>Quantity</Label><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>MFG Date</Label><Input type="date" value={form.mfg_date} onChange={(e) => setForm({ ...form, mfg_date: e.target.value })} /></div>
              <div><Label>EXP Date</Label><Input type="date" value={form.exp_date} onChange={(e) => setForm({ ...form, exp_date: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
