import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useToast } from "@/hooks/use-toast";
import { nextNumber } from "@/lib/db-utils";
import { recordStockMovement } from "@/lib/transaction-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";
import { ProductCombobox } from "@/components/inventory/ProductCombobox";

export default function FinishedGoodsPage() {
  const { user } = useAuth();
  const { userBranchId } = useBranch();
  const { toast } = useToast();
  const [entries, setEntries] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    const [eRes, pRes] = await Promise.all([
      supabase.from("finished_goods_entries" as any).select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("item_master").select("id, item_code, item_name, cost_price").eq("status", "active"),
    ]);
    setEntries((eRes.data as any[]) || []);
    setProducts((pRes.data as any[]) || []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const handleSave = async () => {
    const q = parseFloat(qty);
    if (!productId || !(q > 0)) {
      toast({ title: "Select product and quantity", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const voucher = await nextNumber("finished_goods");
      const branchId = userBranchId || null;
      const { error } = await supabase.from("finished_goods_entries" as any).insert({
        voucher_number: voucher,
        entry_date: date,
        product_id: productId,
        quantity: q,
        unit_cost: parseFloat(cost) || 0,
        branch_id: branchId,
        notes: notes || null,
        status: "posted",
        created_by: user?.id,
      } as any);
      if (error) throw error;
      await recordStockMovement({
        product_id: productId,
        quantity: q,
        movement_type: "finished_goods",
        reference_type: "finished_goods_entry",
        reference_id: voucher,
        branchId,
      });
      toast({ title: `Finished Goods ${voucher} saved` });
      setOpen(false);
      setProductId(""); setQty(""); setCost(""); setNotes("");
      fetchAll();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Finished Goods</h1>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />New Entry</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Voucher #</TableHead><TableHead>Date</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit Cost</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              : entries.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No entries</TableCell></TableRow>
              : entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.voucher_number}</TableCell>
                  <TableCell>{e.entry_date}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(e.unit_cost).toFixed(2)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{e.notes || "—"}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Finished Goods Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-2"><Label>Product *</Label>
              <ProductCombobox products={products} value={productId} onChange={(v) => {
                setProductId(v);
                const p = products.find((x) => x.id === v);
                if (p) setCost(String(p.cost_price));
              }} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Quantity *</Label>
                <Input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <div className="space-y-2"><Label>Unit Cost</Label>
                <Input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
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
