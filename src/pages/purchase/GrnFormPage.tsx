import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { nextDocNo, logAudit } from "@/lib/purchase-numbering";
import { Save, ArrowLeft } from "lucide-react";

import { DateInput } from "@/components/ui/date-input";
const GrnFormPage = () => {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const fromPo = sp.get("po");
  const nav = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth() as any;
  const isEdit = !!id;

  const [h, setH] = useState<any>({ grn_date: new Date().toISOString().slice(0, 10), status: "Draft", auto_post: true });
  const [lines, setLines] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [s, b, w, p] = await Promise.all([
        supabase.from("suppliers" as any).select("id,code,name").eq("is_active", true),
        supabase.from("branches").select("id,name"),
        supabase.from("warehouses").select("id,warehouse_name"),
        supabase.from("purchase_orders_v2" as any).select("id,po_no,supplier_id,branch_id,warehouse_id,purchase_type_id,status").in("status", ["approved", "partially_received"]),
      ]);
      setSuppliers(s.data || []); setBranches(b.data || []);
      setWarehouses(w.data || []); setPos(p.data || []);

      if (isEdit) {
        const [{ data: hd }, { data: ls }] = await Promise.all([
          supabase.from("grns_v2" as any).select("*").eq("id", id).single(),
          supabase.from("grn_items_v2" as any).select("*").eq("grn_id", id).order("line_no"),
        ]);
        if (hd) setH(hd);
        setLines((ls || []) as any);
      } else if (fromPo) {
        await loadFromPo(fromPo);
      }
    })();
  }, [id, fromPo]);

  const loadFromPo = async (poId: string) => {
    const [{ data: po }, { data: items }] = await Promise.all([
      supabase.from("purchase_orders_v2" as any).select("*").eq("id", poId).single(),
      supabase.from("purchase_order_items_v2" as any).select("*").eq("po_id", poId).order("line_no"),
    ]);
    if (po) {
      const p = po as any;
      setH((prev: any) => ({
        ...prev,
        po_id: p.id,
        supplier_id: p.supplier_id,
        branch_id: p.branch_id,
        warehouse_id: p.warehouse_id,
        remarks: `Receipt against PO ${p.po_no}`,
      }));
    }
    const newLines = (items || []).map((it: any, idx: number) => {
      const pending = Number(it.quantity) - Number(it.received_qty || 0);
      return {
        po_item_id: it.id,
        line_no: idx + 1,
        item_id: it.item_id,
        item_description: it.item_description,
        unit_id: it.unit_id,
        ordered_qty: it.quantity,
        received_qty: pending,
        accepted_qty: pending,
        rejected_qty: 0,
        unit_cost: it.unit_price,
        line_value: pending * Number(it.unit_price || 0),
        batch_no: "",
      };
    });
    setLines(newLines);
  };

  const updateLine = (i: number, k: string, v: any) => {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l;
      const nl = { ...l, [k]: v };
      if (k === "received_qty" || k === "rejected_qty") {
        nl.accepted_qty = Math.max(0, Number(nl.received_qty || 0) - Number(nl.rejected_qty || 0));
      }
      if (k === "received_qty" || k === "unit_cost" || k === "rejected_qty") {
        nl.line_value = Number(nl.accepted_qty || 0) * Number(nl.unit_cost || 0);
      }
      return nl;
    }));
  };

  const totals = lines.reduce((a, l) => a + Number(l.line_value || 0), 0);
  const grandTotal = totals + Number(h.freight_amount || 0) + Number(h.other_charges || 0);

  const save = async () => {
    if (!h.supplier_id) { toast({ title: "Supplier required", variant: "destructive" }); return; }
    if (lines.length === 0) { toast({ title: "Add at least one line", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = { ...h, subtotal: totals, grand_total: grandTotal };
      let grnId = id;
      if (isEdit) {
        await supabase.from("grns_v2" as any).update(payload).eq("id", id);
        await supabase.from("grn_items_v2" as any).delete().eq("grn_id", id);
      } else {
        payload.grn_no = await nextDocNo("GRN", "grns_v2", "grn_no");
        payload.created_by = user?.id;
        const { data, error } = await supabase.from("grns_v2" as any).insert(payload).select("id,grn_no").single();
        if (error) throw error;
        grnId = (data as any).id;
        await logAudit({ document_type: "GRN", document_id: grnId!, document_no: (data as any).grn_no, action: "created", performed_by: user?.id });
      }
      const linesPayload = lines.map((l, idx) => ({ ...l, grn_id: grnId, line_no: idx + 1 }));
      const { error: le } = await supabase.from("grn_items_v2" as any).insert(linesPayload);
      if (le) throw le;
      toast({ title: "Saved" });
      nav(`/purchase/grns/${grnId}`);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-semibold">{isEdit ? "Edit" : "New"} Goods Receipt Note</h1>
        </div>
        <Button onClick={save} disabled={saving}><Save className="w-4 h-4 mr-1" />Save</Button>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {!isEdit && (
            <div>
              <Label>Receive Against PO</Label>
              <Select value={h.po_id || ""} onValueChange={(v) => loadFromPo(v)}>
                <SelectTrigger><SelectValue placeholder="Select PO…" /></SelectTrigger>
                <SelectContent>{pos.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.po_no}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div><Label>GRN Date</Label><DateInput value={h.grn_date || ""} onChange={(v) => setH({ ...h, grn_date: v })} /></div>
          <div>
            <Label>Supplier *</Label>
            <Select value={h.supplier_id || ""} onValueChange={(v) => setH({ ...h, supplier_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Branch</Label>
            <Select value={h.branch_id || ""} onValueChange={(v) => setH({ ...h, branch_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Warehouse</Label>
            <Select value={h.warehouse_id || ""} onValueChange={(v) => setH({ ...h, warehouse_id: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{warehouses.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.warehouse_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Challan No</Label><Input value={h.challan_no || ""} onChange={(e) => setH({ ...h, challan_no: e.target.value })} /></div>
          <div><Label>Challan Date</Label><DateInput value={h.challan_date || ""} onChange={(v) => setH({ ...h, challan_date: v })} /></div>
          <div><Label>Vehicle No</Label><Input value={h.vehicle_no || ""} onChange={(e) => setH({ ...h, vehicle_no: e.target.value })} /></div>
          <div><Label>Received By</Label><Input value={h.received_by_name || ""} onChange={(e) => setH({ ...h, received_by_name: e.target.value })} /></div>
          <div><Label>Inspected By</Label><Input value={h.inspected_by_name || ""} onChange={(e) => setH({ ...h, inspected_by_name: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Remarks</Label><Input value={h.remarks || ""} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Items</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Item / Description</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Rejected</TableHead>
              <TableHead className="text-right">Accepted</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Batch</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.length === 0 ? <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-4">Pick a PO above to populate lines</TableCell></TableRow>
              : lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell><Input value={l.item_description || ""} onChange={(e) => updateLine(i, "item_description", e.target.value)} /></TableCell>
                  <TableCell className="text-right font-mono">{Number(l.ordered_qty || 0).toLocaleString()}</TableCell>
                  <TableCell><Input type="number" className="text-right" value={l.received_qty} onChange={(e) => updateLine(i, "received_qty", e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="text-right" value={l.rejected_qty} onChange={(e) => updateLine(i, "rejected_qty", e.target.value)} /></TableCell>
                  <TableCell className="text-right font-mono">{Number(l.accepted_qty || 0).toLocaleString()}</TableCell>
                  <TableCell><Input type="number" className="text-right" value={l.unit_cost} onChange={(e) => updateLine(i, "unit_cost", e.target.value)} /></TableCell>
                  <TableCell className="text-right font-mono">{Number(l.line_value || 0).toLocaleString()}</TableCell>
                  <TableCell><Input value={l.batch_no || ""} onChange={(e) => updateLine(i, "batch_no", e.target.value)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-4">
          <div><Label>Freight</Label><Input type="number" value={h.freight_amount || 0} onChange={(e) => setH({ ...h, freight_amount: e.target.value })} /></div>
          <div><Label>Other Charges</Label><Input type="number" value={h.other_charges || 0} onChange={(e) => setH({ ...h, other_charges: e.target.value })} /></div>
          <div className="md:col-span-2 flex items-end justify-end">
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Subtotal: <span className="font-mono">{totals.toLocaleString()}</span></div>
              <div className="text-lg font-semibold">Grand Total: <span className="font-mono">{grandTotal.toLocaleString()}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GrnFormPage;
