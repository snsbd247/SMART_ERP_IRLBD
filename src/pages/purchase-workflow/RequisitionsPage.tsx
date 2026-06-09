import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Eye } from "lucide-react";
import { genDocNumber, PR_PREFIX } from "@/lib/purchase-workflow-utils";

interface Item { product_id: string; qty_required: number; remarks: string; }

const statusColor: Record<string, string> = {
  pending_admin: "bg-amber-500/15 text-amber-700",
  admin_approved: "bg-emerald-500/15 text-emerald-700",
  commercial_processed: "bg-blue-500/15 text-blue-700",
  rejected: "bg-red-500/15 text-red-700",
  closed: "bg-muted text-muted-foreground",
};

export default function RequisitionsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([{ product_id: "", qty_required: 1, remarks: "" }]);

  const load = async () => {
    const { data } = await supabase.from("purchase_requisitions").select("*").order("created_at", { ascending: false });
    setRows(data || []);
  };
  useEffect(() => { load(); supabase.from("item_master").select("id, item_name, item_code").order("item_name").then(({ data }) => setProducts(data || [])); }, []);

  const addItem = () => setItems([...items, { product_id: "", qty_required: 1, remarks: "" }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<Item>) => setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const save = async () => {
    if (items.some(i => !i.product_id || i.qty_required <= 0)) {
      toast({ title: "Fill all items", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const pr_number = await genDocNumber(PR_PREFIX, "purchase_requisitions");
      const { data: pr, error } = await supabase.from("purchase_requisitions").insert({
        pr_number, pr_date: date, notes, status: "pending_admin", requested_by: user?.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      const { error: itemsErr } = await supabase.from("purchase_requisition_items").insert(
        items.map(i => ({ pr_id: (pr as any).id, product_id: i.product_id, qty_required: i.qty_required, remarks: i.remarks || null }))
      );
      if (itemsErr) throw itemsErr;
      toast({ title: "Requisition created", description: pr_number });
      setOpen(false); setItems([{ product_id: "", qty_required: 1, remarks: "" }]); setNotes("");
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Purchase Requisitions</h1>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1" />New Requisition</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>PR #</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead><TableHead className="w-24">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell><Link to={`/purchase-workflow/requisitions/${r.id}`} className="text-primary hover:underline">{r.pr_number}</Link></TableCell>
                <TableCell>{r.pr_date}</TableCell>
                <TableCell><Badge className={statusColor[r.status] || ""}>{r.status}</Badge></TableCell>
                <TableCell className="truncate max-w-xs">{r.notes || "—"}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/purchase-workflow/requisitions/${r.id}`)}><Eye className="w-3.5 h-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No requisitions</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>New Purchase Requisition</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>PR Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
              <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1"><Label>Items</Label><Button variant="outline" size="sm" onClick={addItem}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button></div>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="w-24">Qty</TableHead><TableHead>Remarks</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell><select className="w-full h-8 border rounded px-2 bg-background text-sm" value={it.product_id} onChange={e => updateItem(i, { product_id: e.target.value })}><option value="">Select product</option>{products.map(p => <option key={p.id} value={p.id}>{p.item_name}</option>)}</select></TableCell>
                      <TableCell><Input type="number" min={0.001} step={0.001} value={it.qty_required} onChange={e => updateItem(i, { qty_required: Number(e.target.value) })} className="h-8" /></TableCell>
                      <TableCell><Input value={it.remarks} onChange={e => updateItem(i, { remarks: e.target.value })} className="h-8" /></TableCell>
                      <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(i)}><Trash2 className="w-3.5 h-3.5" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
