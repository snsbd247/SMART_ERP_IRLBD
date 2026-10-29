import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { nextDocNo, getPurchaseSettings, logAudit } from "@/lib/purchase-numbering";
import { Plus, Trash2, Save, Send, ArrowLeft } from "lucide-react";

import { DateInput } from "@/components/ui/date-input";
const PurchaseOrderFormPage = () => {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const fromPr = sp.get("pr");
  const nav = useNavigate();
  const { toast } = useToast();
  const { user, profile } = useAuth() as any;
  const isEdit = !!id;

  const [h, setH] = useState<any>({ po_date: new Date().toISOString().slice(0, 10), currency: "BDT", exchange_rate: 1, status: "draft" });
  const [lines, setLines] = useState<any[]>([]);
  const [prLinks, setPrLinks] = useState<Record<number, string>>({}); // index -> pr_item_id
  const [types, setTypes] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [t, s, b, w, im, u] = await Promise.all([
        dataClient.from("purchase_types" as any).select("id,code").eq("is_active", true),
        dataClient.from("suppliers" as any).select("id,code,name").eq("is_active", true),
        dataClient.from("branches").select("id,name"),
        dataClient.from("warehouses").select("id,name"),
        dataClient.from("item_master").select("id,name,code").limit(1000),
        dataClient.from("units").select("id,abbreviation"),
      ]);
      setTypes(t.data || []); setSuppliers(s.data || []); setBranches(b.data || []);
      setWarehouses(w.data || []); setItems(im.data || []); setUnits(u.data || []);

      if (isEdit) {
        const [{ data: hd }, { data: ls }] = await Promise.all([
          dataClient.from("purchase_orders_v2" as any).select("*").eq("id", id).single(),
          dataClient.from("purchase_order_items_v2" as any).select("*").eq("po_id", id).order("line_no"),
        ]);
        if (hd) setH(hd);
        setLines((ls || []) as any);
      } else if (fromPr) {
        const [{ data: pr }, { data: pls }] = await Promise.all([
          dataClient.from("purchase_requisitions" as any).select("*").eq("id", fromPr).single(),
          dataClient.from("purchase_requisition_items" as any).select("*").eq("pr_id", fromPr).order("line_no"),
        ]);
        if (pr) setH((p: any) => ({ ...p, branch_id: (pr as any).branch_id, warehouse_id: (pr as any).warehouse_id, purchase_type_id: (pr as any).purchase_type_id, remarks: `From PR ${(pr as any).pr_no}` }));
        const newLines = (pls || []).map((l: any, i: number) => ({
          line_no: i + 1, item_id: l.item_id, item_description: l.item_description, unit_id: l.unit_id,
          quantity: Number(l.quantity) - Number(l.ordered_qty || 0), unit_price: l.estimated_price,
          discount_percent: 0, vat_percent: 0, ait_percent: 0, line_total: 0, _pr_item_id: l.id,
        }));
        const linkMap: Record<number, string> = {};
        newLines.forEach((l: any, i: number) => { if (l._pr_item_id) linkMap[i] = l._pr_item_id; });
        setPrLinks(linkMap);
        setLines(newLines.map((l: any) => ({ ...l, line_total: l.quantity * l.unit_price })));
      }
    })();
  }, [id, fromPr]);

  const addLine = () => setLines([...lines, { line_no: lines.length + 1, item_description: "", quantity: 0, unit_price: 0, discount_percent: 0, vat_percent: 0, ait_percent: 0, line_total: 0 }]);
  const updateLine = (i: number, k: string, v: any) => {
    const next = [...lines]; next[i] = { ...next[i], [k]: v };
    const q = Number(next[i].quantity) || 0, p = Number(next[i].unit_price) || 0, d = Number(next[i].discount_percent) || 0;
    next[i].line_total = q * p * (1 - d / 100);
    setLines(next);
  };
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const subtotal = lines.reduce((s, l) => s + Number(l.line_total || 0), 0);
  const vatAmount = lines.reduce((s, l) => s + (Number(l.line_total || 0) * (Number(l.vat_percent) || 0) / 100), 0);
  const aitAmount = lines.reduce((s, l) => s + (Number(l.line_total || 0) * (Number(l.ait_percent) || 0) / 100), 0);
  const freight = Number(h.freight_amount) || 0;
  const discount = Number(h.discount_amount) || 0;
  const other = Number(h.other_charges) || 0;
  const grand = subtotal + vatAmount - aitAmount + freight + other - discount;

  const save = async (submit = false) => {
    if (!h.supplier_id) { toast({ title: "Supplier required", variant: "destructive" }); return; }
    if (lines.length === 0) { toast({ title: "Add lines", variant: "destructive" }); return; }
    setSaving(true);
    try {
      let poId = id, poNo = h.po_no;
      const payload: any = {
        ...h, subtotal, vat_amount: vatAmount, ait_amount: aitAmount, grand_total: grand,
        status: submit ? "pending_approval" : (h.status || "draft"),
        created_by: user?.id,
      };
      delete payload.created_at; delete payload.updated_at;

      if (isEdit) {
        const { error } = await dataClient.from("purchase_orders_v2" as any).update(payload).eq("id", id);
        if (error) throw error;
        await dataClient.from("purchase_order_items_v2" as any).delete().eq("po_id", id);
      } else {
        const settings = await getPurchaseSettings();
        poNo = await nextDocNo(settings?.po_prefix || "PO", "purchase_orders_v2", "po_no");
        payload.po_no = poNo;
        const { data, error } = await dataClient.from("purchase_orders_v2" as any).insert(payload).select().single();
        if (error) throw error;
        poId = (data as any).id;
      }

      const linesPayload = lines.map((l, idx) => ({
        po_id: poId, line_no: idx + 1, item_id: l.item_id || null, item_description: l.item_description,
        unit_id: l.unit_id || null, quantity: Number(l.quantity) || 0, unit_price: Number(l.unit_price) || 0,
        discount_percent: Number(l.discount_percent) || 0, vat_percent: Number(l.vat_percent) || 0,
        ait_percent: Number(l.ait_percent) || 0, line_total: Number(l.line_total) || 0,
      }));
      const { data: insLines, error: e2 } = await dataClient.from("purchase_order_items_v2" as any).insert(linesPayload).select();
      if (e2) throw e2;

      // wire PR ↔ PO links + update PR.ordered_qty
      if (insLines && Object.keys(prLinks).length > 0) {
        const links = (insLines as any[]).map((il: any, i: number) => prLinks[i] ? { po_item_id: il.id, pr_item_id: prLinks[i], linked_qty: Number(lines[i].quantity) || 0 } : null).filter(Boolean);
        if (links.length > 0) await dataClient.from("po_pr_links" as any).insert(links);
        for (const i in prLinks) {
          const prItemId = prLinks[i];
          const { data: pri } = await dataClient.from("purchase_requisition_items" as any).select("ordered_qty,quantity").eq("id", prItemId).single();
          if (pri) {
            const newOrdered = Number((pri as any).ordered_qty || 0) + Number(lines[i].quantity || 0);
            const status = newOrdered >= Number((pri as any).quantity) ? "ordered" : "pending";
            await dataClient.from("purchase_requisition_items" as any).update({ ordered_qty: newOrdered, status }).eq("id", prItemId);
          }
        }
      }

      await logAudit({ document_type: "PO", document_id: poId!, document_no: poNo,
        action: submit ? "SUBMITTED" : (isEdit ? "UPDATED" : "CREATED"),
        performed_by: user?.id, performed_by_name: profile?.name || user?.email });

      toast({ title: submit ? "PO submitted for approval" : "Saved" });
      nav(`/purchase/orders/${poId}`);
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => nav("/purchase/orders")}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-semibold">{isEdit ? `Edit ${h.po_no || ""}` : "New Purchase Order"}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => save(false)} disabled={saving}><Save className="w-4 h-4 mr-1" />Save Draft</Button>
          <Button size="sm" onClick={() => save(true)} disabled={saving}><Send className="w-4 h-4 mr-1" />Submit for Approval</Button>
        </div>
      </div>

      <Card><CardHeader><CardTitle className="text-base">Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1"><Label>PO Date</Label><DateInput value={h.po_date || ""} onChange={(v) => setH({ ...h, po_date: v })} /></div>
          <div className="space-y-1"><Label>Expected Date</Label><DateInput value={h.expected_date || ""} onChange={(v) => setH({ ...h, expected_date: v })} /></div>
          <div className="space-y-1"><Label>Supplier *</Label>
            <Select value={h.supplier_id || ""} onValueChange={(v) => setH({ ...h, supplier_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>{suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Purchase Type</Label>
            <Select value={h.purchase_type_id || "_none"} onValueChange={(v) => setH({ ...h, purchase_type_id: v === "_none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent><SelectItem value="_none">—</SelectItem>{types.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Branch / Factory</Label>
            <Select value={h.branch_id || "_none"} onValueChange={(v) => setH({ ...h, branch_id: v === "_none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent><SelectItem value="_none">—</SelectItem>{branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Warehouse</Label>
            <Select value={h.warehouse_id || "_none"} onValueChange={(v) => setH({ ...h, warehouse_id: v === "_none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent><SelectItem value="_none">—</SelectItem>{warehouses.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Currency</Label><Input value={h.currency || ""} onChange={(e) => setH({ ...h, currency: e.target.value })} /></div>
          <div className="space-y-1"><Label>Exchange Rate</Label><Input type="number" value={h.exchange_rate ?? 1} onChange={(e) => setH({ ...h, exchange_rate: parseFloat(e.target.value) || 1 })} /></div>
          <div className="space-y-1"><Label>Payment Terms</Label><Input value={h.payment_terms || ""} onChange={(e) => setH({ ...h, payment_terms: e.target.value })} /></div>
          <div className="space-y-1"><Label>Delivery Terms</Label><Input value={h.delivery_terms || ""} onChange={(e) => setH({ ...h, delivery_terms: e.target.value })} /></div>
          <div className="space-y-1 col-span-2"><Label>Shipping Address</Label><Input value={h.shipping_address || ""} onChange={(e) => setH({ ...h, shipping_address: e.target.value })} /></div>
          <div className="space-y-1 col-span-2 md:col-span-4"><Label>Remarks</Label><Input value={h.remarks || ""} onChange={(e) => setH({ ...h, remarks: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Lines</CardTitle>
          <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-4 h-4 mr-1" />Add Line</Button>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10">#</TableHead><TableHead>Item</TableHead><TableHead>Description</TableHead>
              <TableHead>Unit</TableHead><TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead><TableHead className="text-right">Disc%</TableHead>
              <TableHead className="text-right">VAT%</TableHead><TableHead className="text-right">AIT%</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead className="w-10"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.length === 0 ? <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">No lines</TableCell></TableRow>
              : lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <Select value={l.item_id || "_none"} onValueChange={(v) => {
                      const it = items.find((x: any) => x.id === v);
                      const next = [...lines]; next[i] = { ...next[i], item_id: v === "_none" ? null : v, item_description: it ? it.name : next[i].item_description };
                      setLines(next);
                    }}>
                      <SelectTrigger className="h-8 w-40"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent><SelectItem value="_none">—</SelectItem>{items.map((x: any) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input className="h-8 min-w-[180px]" value={l.item_description} onChange={(e) => updateLine(i, "item_description", e.target.value)} /></TableCell>
                  <TableCell>
                    <Select value={l.unit_id || "_none"} onValueChange={(v) => updateLine(i, "unit_id", v === "_none" ? null : v)}>
                      <SelectTrigger className="h-8 w-20"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent><SelectItem value="_none">—</SelectItem>{units.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.abbreviation}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input type="number" className="h-8 w-20 text-right" value={l.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="h-8 w-24 text-right" value={l.unit_price} onChange={(e) => updateLine(i, "unit_price", e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="h-8 w-16 text-right" value={l.discount_percent} onChange={(e) => updateLine(i, "discount_percent", e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="h-8 w-16 text-right" value={l.vat_percent} onChange={(e) => updateLine(i, "vat_percent", e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="h-8 w-16 text-right" value={l.ait_percent} onChange={(e) => updateLine(i, "ait_percent", e.target.value)} /></TableCell>
                  <TableCell className="text-right font-mono">{Number(l.line_total || 0).toLocaleString()}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeLine(i)}><Trash2 className="w-3.5 h-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-6">
          <div className="space-y-1"><Label>Freight</Label><Input type="number" value={h.freight_amount ?? 0} onChange={(e) => setH({ ...h, freight_amount: parseFloat(e.target.value) || 0 })} /></div>
          <div className="space-y-1"><Label>Other Charges</Label><Input type="number" value={h.other_charges ?? 0} onChange={(e) => setH({ ...h, other_charges: parseFloat(e.target.value) || 0 })} /></div>
          <div className="space-y-1"><Label>Discount</Label><Input type="number" value={h.discount_amount ?? 0} onChange={(e) => setH({ ...h, discount_amount: parseFloat(e.target.value) || 0 })} /></div>
          <div className="space-y-1 md:col-start-4 text-right">
            <div className="text-xs text-muted-foreground">Subtotal: <span className="font-mono">{subtotal.toLocaleString()}</span></div>
            <div className="text-xs text-muted-foreground">VAT: <span className="font-mono">{vatAmount.toLocaleString()}</span></div>
            <div className="text-xs text-muted-foreground">AIT (−): <span className="font-mono">{aitAmount.toLocaleString()}</span></div>
            <div className="text-base font-semibold">Grand Total: <span className="font-mono">{grand.toLocaleString()}</span></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PurchaseOrderFormPage;
