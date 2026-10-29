import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";
import { nextDocNo, logAudit } from "@/lib/purchase-numbering";

import { DateInput } from "@/components/ui/date-input";
type Item = { id?: string; item_id?: string; description: string; quantity: number; unit_cost: number; vat_rate: number; line_total: number; grn_item_id?: string };
const empty = (): Item => ({ description: "", quantity: 1, unit_cost: 0, vat_rate: 0, line_total: 0 });

const PurchaseReturnFormPage = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [grns, setGrns] = useState<any[]>([]);
  const [header, setHeader] = useState<any>({
    return_no: "", return_date: new Date().toISOString().slice(0, 10),
    supplier_id: "", grn_id: "", branch_id: "", warehouse_id: "", reason: "", notes: "",
  });
  const [items, setItems] = useState<Item[]>([empty()]);

  useEffect(() => {
    (async () => {
      const [s, b, w, g] = await Promise.all([
        dataClient.from("suppliers" as any).select("id,name").eq("is_active", true),
        dataClient.from("branches").select("id,name"),
        dataClient.from("warehouses").select("id,name"),
        dataClient.from("grns_v2" as any).select("id,grn_no,supplier_id,branch_id,warehouse_id").eq("status", "Approved").limit(200),
      ]);
      setSuppliers((s.data || []) as any); setBranches((b.data || []) as any);
      setWarehouses((w.data || []) as any); setGrns((g.data || []) as any);
      if (id) {
        const { data: h } = await dataClient.from("purchase_returns_v2" as any).select("*").eq("id", id).maybeSingle();
        const { data: it } = await dataClient.from("purchase_return_items_v2" as any).select("*").eq("return_id", id).order("sort_order");
        if (h) setHeader(h as any);
        if (it && it.length) setItems(it as any);
      } else {
        const no = await nextDocNo("RTN", "purchase_returns_v2", "return_no");
        setHeader((h: any) => ({ ...h, return_no: no }));
      }
    })();
  }, [id]);

  const loadFromGrn = async (gid: string) => {
    const { data: g } = await dataClient.from("grns_v2" as any).select("*").eq("id", gid).maybeSingle();
    const { data: lines } = await dataClient.from("grn_items_v2" as any).select("*").eq("grn_id", gid);
    if (g) setHeader((h: any) => ({ ...h, supplier_id: (g as any).supplier_id, branch_id: (g as any).branch_id, warehouse_id: (g as any).warehouse_id, grn_id: gid }));
    if (lines) setItems((lines as any[]).map((l: any) => ({
      item_id: l.item_id, description: l.description || "", quantity: 0,
      unit_cost: Number(l.unit_cost || 0), vat_rate: 0, line_total: 0, grn_item_id: l.id,
    })));
  };

  const updateItem = (idx: number, patch: Partial<Item>) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const merged = { ...it, ...patch };
      merged.line_total = +(merged.quantity * merged.unit_cost).toFixed(2);
      return merged;
    });
    setItems(next);
  };

  const subtotal = items.reduce((s, it) => s + it.line_total, 0);
  const vat = items.reduce((s, it) => s + (it.line_total * (it.vat_rate || 0) / 100), 0);
  const grand = +(subtotal + vat).toFixed(2);

  const save = async () => {
    if (!header.supplier_id) return toast.error("Select supplier");
    const lines = items.filter(it => it.quantity > 0);
    if (lines.length === 0) return toast.error("Add at least one returned line");
    const payload = { ...header, subtotal, vat_amount: vat, grand_total: grand };
    const op = id
      ? dataClient.from("purchase_returns_v2" as any).update(payload).eq("id", id).select("id").single()
      : dataClient.from("purchase_returns_v2" as any).insert(payload).select("id").single();
    const { data, error } = await op;
    if (error) return toast.error(error.message);
    const rid = (data as any).id as string;
    if (id) await dataClient.from("purchase_return_items_v2" as any).delete().eq("return_id", rid);
    await dataClient.from("purchase_return_items_v2" as any).insert(lines.map((it, i) => ({ ...it, return_id: rid, sort_order: i })) as any);
    await logAudit({ document_type: "RETURN", document_id: rid, document_no: header.return_no, action: id ? "updated" : "created" });
    toast.success("Return saved");
    nav(`/purchase/returns/${rid}`);
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">{id ? "Edit Return" : "New Purchase Return"}</h1>
      <Card><CardContent className="p-4 grid md:grid-cols-4 gap-3">
        <div><Label>Return #</Label><Input value={header.return_no} onChange={e => setHeader({ ...header, return_no: e.target.value })} /></div>
        <div><Label>Date</Label><DateInput value={header.return_date} onChange={(v) => setHeader({ ...header, return_date: v })} /></div>
        <div><Label>From GRN</Label>
          <Select value={header.grn_id || ""} onValueChange={v => { setHeader({ ...header, grn_id: v }); loadFromGrn(v); }}>
            <SelectTrigger><SelectValue placeholder="(optional)" /></SelectTrigger>
            <SelectContent>{grns.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.grn_no}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Supplier</Label>
          <Select value={header.supplier_id} onValueChange={v => setHeader({ ...header, supplier_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Branch</Label>
          <Select value={header.branch_id || ""} onValueChange={v => setHeader({ ...header, branch_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Warehouse</Label>
          <Select value={header.warehouse_id || ""} onValueChange={v => setHeader({ ...header, warehouse_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{warehouses.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2"><Label>Reason</Label><Input value={header.reason || ""} onChange={e => setHeader({ ...header, reason: e.target.value })} /></div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Description</TableHead><TableHead className="w-24">Return Qty</TableHead>
            <TableHead className="w-28">Unit Cost</TableHead><TableHead className="w-20">VAT %</TableHead>
            <TableHead className="text-right w-28">Total</TableHead><TableHead className="w-10"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.map((it, i) => (
              <TableRow key={i}>
                <TableCell><Input value={it.description} onChange={e => updateItem(i, { description: e.target.value })} /></TableCell>
                <TableCell><Input type="number" value={it.quantity} onChange={e => updateItem(i, { quantity: +e.target.value })} /></TableCell>
                <TableCell><Input type="number" value={it.unit_cost} onChange={e => updateItem(i, { unit_cost: +e.target.value })} /></TableCell>
                <TableCell><Input type="number" value={it.vat_rate} onChange={e => updateItem(i, { vat_rate: +e.target.value })} /></TableCell>
                <TableCell className="text-right font-mono">{it.line_total.toFixed(2)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setItems(items.filter((_, x) => x !== i))}><Trash2 className="w-3.5 h-3.5" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="p-3"><Button size="sm" variant="outline" onClick={() => setItems([...items, empty()])}><Plus className="w-4 h-4 mr-1" />Add Line</Button></div>
      </CardContent></Card>

      <Card><CardContent className="p-4 grid md:grid-cols-2 gap-4">
        <div className="space-y-2"><Label>Notes</Label><Textarea value={header.notes || ""} onChange={e => setHeader({ ...header, notes: e.target.value })} /></div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>VAT</span><span className="font-mono">{vat.toFixed(2)}</span></div>
          <div className="flex justify-between font-semibold border-t pt-2"><span>Grand Total</span><span className="font-mono">{grand.toFixed(2)}</span></div>
        </div>
      </CardContent></Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => nav(-1)}>Cancel</Button>
        <Button onClick={save}><Save className="w-4 h-4 mr-1" />Save</Button>
      </div>
    </div>
  );
};

export default PurchaseReturnFormPage;
