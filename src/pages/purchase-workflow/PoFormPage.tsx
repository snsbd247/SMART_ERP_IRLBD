import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Save, Trash2, Plus } from "lucide-react";
import { genDocNumber, POV2_PREFIX } from "@/lib/purchase-workflow-utils";

interface Row { pr_item_id: string | null; product_id: string; product_name: string; qty_remaining: number; qty_ordered: number; rate: number; vat_pct: number; }

export default function PoFormPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const prId = params.get("pr");

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [pr, setPr] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("suppliers").select("id, name").eq("status", "approved").then(({ data }) => setSuppliers(data || []));
    supabase.from("item_master").select("id, item_name").order("item_name").then(({ data }) => setProducts(data || []));
    if (prId) loadPr();
  }, [prId]);

  const loadPr = async () => {
    const { data: prData } = await supabase.from("purchase_requisitions").select("*").eq("id", prId).single();
    setPr(prData);
    const { data: its } = await supabase.from("purchase_requisition_items").select("*").eq("pr_id", prId);
    const pids = (its || []).map((x: any) => x.product_id);
    const { data: prods } = await supabase.from("item_master").select("id, item_name").in("id", pids);
    const nameMap: Record<string, string> = {}; (prods || []).forEach((p: any) => { nameMap[p.id] = p.item_name; });
    setRows((its || []).filter((i: any) => Number(i.qty_required) - Number(i.qty_ordered) > 0).map((i: any) => ({
      pr_item_id: i.id, product_id: i.product_id, product_name: nameMap[i.product_id] || "", qty_remaining: Number(i.qty_required) - Number(i.qty_ordered),
      qty_ordered: Number(i.qty_required) - Number(i.qty_ordered), rate: 0, vat_pct: 0,
    })));
  };

  const addBlankRow = () => setRows([...rows, { pr_item_id: null, product_id: "", product_name: "", qty_remaining: 999999, qty_ordered: 1, rate: 0, vat_pct: 0 }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const subtotal = rows.reduce((s, r) => s + r.qty_ordered * r.rate, 0);
  const vat = rows.reduce((s, r) => s + r.qty_ordered * r.rate * (r.vat_pct / 100), 0);
  const grand = subtotal + vat;

  const save = async () => {
    if (!supplierId) return toast({ title: "Select supplier", variant: "destructive" });
    if (!rows.length || rows.some(r => !r.product_id || r.qty_ordered <= 0)) return toast({ title: "Add valid items", variant: "destructive" });
    for (const r of rows) if (r.pr_item_id && r.qty_ordered > r.qty_remaining) return toast({ title: `Qty exceeds remaining for ${r.product_name}`, variant: "destructive" });
    setSaving(true);
    try {
      const po_number = await genDocNumber(POV2_PREFIX, "purchase_orders_v2");
      const { data: po, error } = await supabase.from("purchase_orders_v2").insert({
        po_number, po_date: date, supplier_id: supplierId, pr_id: prId, subtotal, vat_amount: vat, grand_total: grand, status: "sent", notes, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      const poId = (po as any).id;
      const { error: ie } = await supabase.from("purchase_order_items_v2").insert(rows.map(r => ({
        po_id: poId, pr_item_id: r.pr_item_id, product_id: r.product_id, qty_ordered: r.qty_ordered, rate: r.rate, vat_pct: r.vat_pct,
        line_total: r.qty_ordered * r.rate * (1 + r.vat_pct / 100),
      })));
      if (ie) throw ie;
      // Increment PR item qty_ordered
      for (const r of rows) {
        if (r.pr_item_id) {
          const { data: prItem } = await supabase.from("purchase_requisition_items").select("qty_ordered").eq("id", r.pr_item_id).single();
          await supabase.from("purchase_requisition_items").update({ qty_ordered: Number((prItem as any)?.qty_ordered || 0) + r.qty_ordered }).eq("id", r.pr_item_id);
        }
      }
      if (prId) {
        // Check if PR fully consumed
        const { data: prItems } = await supabase.from("purchase_requisition_items").select("qty_required, qty_ordered").eq("pr_id", prId);
        const fully = (prItems || []).every((i: any) => Number(i.qty_ordered) >= Number(i.qty_required));
        await supabase.from("purchase_requisitions").update({ status: fully ? "commercial_processed" : "admin_approved" }).eq("id", prId);
      }
      toast({ title: "PO created", description: po_number });
      navigate(`/purchase-workflow/po/${poId}`);
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <h1 className="text-xl font-bold">New Purchase Order {pr && <span className="text-sm font-normal text-muted-foreground">(from {pr.pr_number})</span>}</h1>
      </div>
      <Card><CardContent className="p-4 grid grid-cols-3 gap-3">
        <div><Label>PO Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><Label>Supplier</Label>
          <select className="w-full h-9 border rounded px-2 bg-background text-sm" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </CardContent></Card>
      <Card><CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-medium">Items</h3><Button size="sm" variant="outline" onClick={addBlankRow}><Plus className="w-3.5 h-3.5 mr-1" />Add Item</Button></div>
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="w-24 text-right">Remaining</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-24">Rate</TableHead><TableHead className="w-20">VAT %</TableHead><TableHead className="text-right w-28">Line Total</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{r.pr_item_id ? r.product_name :
                  <select className="w-full h-8 border rounded px-2 bg-background text-sm" value={r.product_id} onChange={e => { const p = products.find((x: any) => x.id === e.target.value); update(i, { product_id: e.target.value, product_name: p?.item_name || "" }); }}><option value="">Select</option>{products.map(p => <option key={p.id} value={p.id}>{p.item_name}</option>)}</select>
                }</TableCell>
                <TableCell className="text-right text-muted-foreground">{r.pr_item_id ? r.qty_remaining : "—"}</TableCell>
                <TableCell><Input type="number" min={0.001} step={0.001} value={r.qty_ordered} onChange={e => update(i, { qty_ordered: Number(e.target.value) })} className="h-8" /></TableCell>
                <TableCell><Input type="number" min={0} step={0.01} value={r.rate} onChange={e => update(i, { rate: Number(e.target.value) })} className="h-8" /></TableCell>
                <TableCell><Input type="number" min={0} max={100} step={0.01} value={r.vat_pct} onChange={e => update(i, { vat_pct: Number(e.target.value) })} className="h-8" /></TableCell>
                <TableCell className="text-right">{(r.qty_ordered * r.rate * (1 + r.vat_pct / 100)).toFixed(2)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)}><Trash2 className="w-3.5 h-3.5" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-end text-sm space-y-1">
          <div className="w-64 space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span>{subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>VAT</span><span>{vat.toFixed(2)}</span></div>
            <div className="flex justify-between font-bold border-t pt-1"><span>Grand Total</span><span>{grand.toFixed(2)}</span></div>
          </div>
        </div>
      </CardContent></Card>
      <div className="flex justify-end"><Button onClick={save} disabled={saving}><Save className="w-4 h-4 mr-1" />{saving ? "Saving…" : "Save PO"}</Button></div>
    </div>
  );
}
