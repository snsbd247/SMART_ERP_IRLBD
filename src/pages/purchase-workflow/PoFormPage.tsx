import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { newPONumber } from "@/lib/purchase-workflow-utils";
import { logCreate } from "@/lib/audit-utils";
import { usePermission } from "@/hooks/usePermission";
import { PurchaseStatusTracker } from "@/components/purchase-workflow/PurchaseStatusTracker";

interface Row { id: string; pr_item_id: string | null; product_id: string; qty_ordered: number; rate: number; vat_pct: number; }

export default function PoFormPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const prId = sp.get("pr");
  const { user, profile } = useAuth();
  const { userBranchId } = useBranch();
  const { toast } = useToast();
  const { can, isSuperAdmin } = usePermission();
  const canCreate = isSuperAdmin || can("purchase.po.create") || can("purchase.create");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [approvedPRs, setApprovedPRs] = useState<any[]>([]);
  const [selectedPR, setSelectedPR] = useState<string>(prId || "");
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("suppliers").select("id,name").order("name"),
      supabase.from("products").select("id,product_name,product_code,cost_price").eq("status", "active").order("product_name"),
      supabase.from("purchase_requisitions" as any).select("id,pr_number").eq("status", "approved").order("created_at", { ascending: false }),
    ]).then(([s, p, pr]) => {
      setSuppliers((s.data as any) || []);
      setProducts((p.data as any) || []);
      setApprovedPRs((pr.data as any) || []);
    });
  }, []);

  useEffect(() => {
    if (!selectedPR) { setRows([{ id: "1", pr_item_id: null, product_id: "", qty_ordered: 0, rate: 0, vat_pct: 0 }]); return; }
    supabase.from("purchase_requisition_items" as any).select("*").eq("pr_id", selectedPR).then(({ data }) => {
      const prItems = (data as any[]) || [];
      setRows(prItems.map((it, idx) => ({
        id: String(idx + 1), pr_item_id: it.id, product_id: it.product_id,
        qty_ordered: Math.max(0, it.qty_required - it.qty_ordered), rate: 0, vat_pct: 0,
      })));
    });
  }, [selectedPR]);

  const addRow = () => setRows([...rows, { id: String(Date.now()), pr_item_id: null, product_id: "", qty_ordered: 0, rate: 0, vat_pct: 0 }]);
  const delRow = (id: string) => setRows(rows.filter(r => r.id !== id));
  const upd = (id: string, k: keyof Row, v: any) => setRows(rows.map(r => r.id === id ? { ...r, [k]: v } : r));

  const lineTotal = (r: Row) => r.qty_ordered * r.rate;
  const lineVat = (r: Row) => lineTotal(r) * (r.vat_pct / 100);
  const subtotal = rows.reduce((s, r) => s + lineTotal(r), 0);
  const vatAmt = rows.reduce((s, r) => s + lineVat(r), 0);
  const grand = subtotal + vatAmt;

  const save = async () => {
    if (!canCreate) return toast({ title: "Permission denied", description: "Requires purchase.po.create", variant: "destructive" });
    if (!supplierId) return toast({ title: "Select supplier", variant: "destructive" });
    const valid = rows.filter(r => r.product_id && r.qty_ordered > 0 && r.rate > 0);
    if (!valid.length) return toast({ title: "Add items with qty & rate", variant: "destructive" });
    setSaving(true);
    try {
      const po_number = await newPONumber();
      const { data: po, error } = await supabase.from("purchase_orders_v2" as any).insert({
        po_number, po_date: date, supplier_id: supplierId, pr_id: selectedPR || null,
        branch_id: userBranchId || null, subtotal, vat_amount: vatAmt, grand_total: grand,
        status: "open", notes: notes || null, created_by: user?.id || null,
      } as any).select().single();
      if (error) throw error;
      const items = valid.map(r => ({
        po_id: (po as any).id, pr_item_id: r.pr_item_id, product_id: r.product_id,
        qty_ordered: r.qty_ordered, qty_received: 0, rate: r.rate, vat_pct: r.vat_pct, line_total: lineTotal(r) + lineVat(r),
      }));
      const { error: e2 } = await supabase.from("purchase_order_items_v2" as any).insert(items);
      if (e2) throw e2;

      // Update PR items qty_ordered
      for (const r of valid.filter(v => v.pr_item_id)) {
        const { data: it } = await supabase.from("purchase_requisition_items" as any).select("qty_ordered").eq("id", r.pr_item_id).single();
        await supabase.from("purchase_requisition_items" as any).update({ qty_ordered: ((it as any)?.qty_ordered || 0) + r.qty_ordered }).eq("id", r.pr_item_id);
      }
      await logCreate({
        userId: user?.id, userName: profile?.name,
        module: "purchase_order", recordId: (po as any).id,
        newData: { po_number, supplier_id: supplierId, grand_total: grand, pr_id: selectedPR || null },
        details: `PO ${po_number} created (grand ${grand.toFixed(2)})`,
      });
      toast({ title: "PO created", description: po_number });
      nav(`/purchase-workflow/po/${(po as any).id}`);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" onClick={() => nav(-1)}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
      <PurchaseStatusTracker current="po" />
      <Card>
        <CardHeader><CardTitle>New Purchase Order</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div>
              <Label>From Requisition (optional)</Label>
              <Select value={selectedPR || "none"} onValueChange={v => setSelectedPR(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {approvedPRs.map(p => <SelectItem key={p.id} value={p.id}>{p.pr_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <Label>Items</Label>
              <Button size="sm" variant="outline" onClick={addRow}><Plus className="w-3 h-3 mr-1" />Add</Button>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-28">Rate</TableHead>
                <TableHead className="w-20">VAT %</TableHead><TableHead className="w-28 text-right">Total</TableHead><TableHead className="w-12"></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Select value={r.product_id} onValueChange={v => upd(r.id, "product_id", v)}>
                        <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
                        <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.product_code} - {p.product_name}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input type="number" value={r.qty_ordered || ""} onChange={e => upd(r.id, "qty_ordered", Number(e.target.value))} /></TableCell>
                    <TableCell><Input type="number" value={r.rate || ""} onChange={e => upd(r.id, "rate", Number(e.target.value))} /></TableCell>
                    <TableCell><Input type="number" value={r.vat_pct || ""} onChange={e => upd(r.id, "vat_pct", Number(e.target.value))} /></TableCell>
                    <TableCell className="text-right">{(lineTotal(r) + lineVat(r)).toFixed(2)}</TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => delRow(r.id)}><Trash2 className="w-4 h-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end mt-4 text-sm space-y-1 flex-col items-end">
              <div>Subtotal: <b>{subtotal.toFixed(2)}</b></div>
              <div>VAT: <b>{vatAmt.toFixed(2)}</b></div>
              <div className="text-lg">Grand Total: <b>{grand.toFixed(2)}</b></div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => nav(-1)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Create PO"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
