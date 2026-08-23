import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
type Item = { id?: string; item_id?: string; description: string; quantity: number; unit_price: number; discount: number; vat_rate: number; ait_rate: number; line_total: number; grn_item_id?: string };

const empty = (): Item => ({ description: "", quantity: 1, unit_price: 0, discount: 0, vat_rate: 0, ait_rate: 0, line_total: 0 });

const SupplierBillFormPage = () => {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const grnId = sp.get("grn");
  const nav = useNavigate();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [grns, setGrns] = useState<any[]>([]);
  const [header, setHeader] = useState<any>({
    bill_no: "", supplier_invoice_no: "", bill_date: new Date().toISOString().slice(0, 10), due_date: "",
    supplier_id: "", branch_id: "", grn_id: grnId || "", po_id: "", currency: "BDT", exchange_rate: 1,
    discount_amount: 0, other_charges: 0, notes: "",
  });
  const [items, setItems] = useState<Item[]>([empty()]);

  useEffect(() => {
    (async () => {
      const [s, b, g] = await Promise.all([
        supabase.from("suppliers" as any).select("id,name").eq("is_active", true),
        supabase.from("branches").select("id,name"),
        supabase.from("grns_v2" as any).select("id,grn_no,supplier_id,po_id,grand_total").eq("status", "Approved").limit(200),
      ]);
      setSuppliers((s.data || []) as any); setBranches((b.data || []) as any); setGrns((g.data || []) as any);
      if (id) {
        const { data: h } = await supabase.from("supplier_bills_v2" as any).select("*").eq("id", id).maybeSingle();
        const { data: it } = await supabase.from("supplier_bill_items_v2" as any).select("*").eq("bill_id", id).order("sort_order");
        if (h) setHeader(h as any);
        if (it && it.length) setItems(it as any);
      } else {
        const no = await nextDocNo("BILL", "supplier_bills_v2", "bill_no");
        setHeader((h: any) => ({ ...h, bill_no: no }));
        if (grnId) await prefillFromGrn(grnId);
      }
    })();
  }, [id]);

  const prefillFromGrn = async (gid: string) => {
    const { data: g } = await supabase.from("grns_v2" as any).select("*").eq("id", gid).maybeSingle();
    const { data: lines } = await supabase.from("grn_items_v2" as any).select("*").eq("grn_id", gid);
    if (g) setHeader((h: any) => ({ ...h, supplier_id: (g as any).supplier_id, branch_id: (g as any).branch_id, grn_id: gid, po_id: (g as any).po_id }));
    if (lines) setItems((lines as any[]).map((l: any) => ({
      item_id: l.item_id, description: l.description || "", quantity: Number(l.accepted_qty || 0), unit_price: Number(l.unit_cost || 0),
      discount: 0, vat_rate: 0, ait_rate: 0, line_total: Number(l.accepted_qty || 0) * Number(l.unit_cost || 0), grn_item_id: l.id,
    })));
  };

  const calcLine = (it: Item) => +(it.quantity * it.unit_price - it.discount).toFixed(2);
  const updateItem = (idx: number, patch: Partial<Item>) => {
    const next = items.map((it, i) => i === idx ? { ...it, ...patch, line_total: calcLine({ ...it, ...patch } as Item) } : it);
    setItems(next);
  };

  const subtotal = items.reduce((s, it) => s + it.line_total, 0);
  const vat = items.reduce((s, it) => s + (it.line_total * (it.vat_rate || 0) / 100), 0);
  const ait = items.reduce((s, it) => s + (it.line_total * (it.ait_rate || 0) / 100), 0);
  const grand = +(subtotal - Number(header.discount_amount || 0) + vat + Number(header.other_charges || 0)).toFixed(2);

  const save = async () => {
    if (!header.supplier_id) { toast.error("Select supplier"); return; }
    const payload = { ...header, subtotal, vat_amount: vat, ait_amount: ait, grand_total: grand };
    const op = id
      ? supabase.from("supplier_bills_v2" as any).update(payload).eq("id", id).select("id").single()
      : supabase.from("supplier_bills_v2" as any).insert(payload).select("id").single();
    const { data, error } = await op;
    if (error) return toast.error(error.message);
    const billId = (data as any).id as string;
    if (id) await supabase.from("supplier_bill_items_v2" as any).delete().eq("bill_id", billId);
    await supabase.from("supplier_bill_items_v2" as any).insert(items.map((it, i) => ({ ...it, bill_id: billId, sort_order: i })) as any);
    await logAudit({ document_type: "BILL", document_id: billId, document_no: header.bill_no, action: id ? "updated" : "created" });
    toast.success("Bill saved");
    nav(`/purchase/bills/${billId}`);
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">{id ? "Edit Bill" : "New Supplier Bill"}</h1>
      <Card><CardContent className="p-4 grid md:grid-cols-4 gap-3">
        <div><Label>Bill #</Label><Input value={header.bill_no} onChange={e => setHeader({ ...header, bill_no: e.target.value })} /></div>
        <div><Label>Supplier Invoice #</Label><Input value={header.supplier_invoice_no || ""} onChange={e => setHeader({ ...header, supplier_invoice_no: e.target.value })} /></div>
        <div><Label>Bill Date</Label><DateInput value={header.bill_date} onChange={(v) => setHeader({ ...header, bill_date: v })} /></div>
        <div><Label>Due Date</Label><DateInput value={header.due_date || ""} onChange={(v) => setHeader({ ...header, due_date: v })} /></div>
        <div><Label>Supplier</Label>
          <Select value={header.supplier_id || ""} onValueChange={v => setHeader({ ...header, supplier_id: v })}>
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
        <div><Label>From GRN</Label>
          <Select value={header.grn_id || ""} onValueChange={v => { setHeader({ ...header, grn_id: v }); prefillFromGrn(v); }}>
            <SelectTrigger><SelectValue placeholder="(optional)" /></SelectTrigger>
            <SelectContent>{grns.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.grn_no}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Currency</Label><Input value={header.currency} onChange={e => setHeader({ ...header, currency: e.target.value })} /></div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Description</TableHead><TableHead className="w-24">Qty</TableHead>
            <TableHead className="w-28">Unit Price</TableHead><TableHead className="w-24">Discount</TableHead>
            <TableHead className="w-20">VAT %</TableHead><TableHead className="w-20">AIT %</TableHead>
            <TableHead className="text-right w-28">Total</TableHead><TableHead className="w-10"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.map((it, i) => (
              <TableRow key={i}>
                <TableCell><Input value={it.description} onChange={e => updateItem(i, { description: e.target.value })} /></TableCell>
                <TableCell><Input type="number" value={it.quantity} onChange={e => updateItem(i, { quantity: +e.target.value })} /></TableCell>
                <TableCell><Input type="number" value={it.unit_price} onChange={e => updateItem(i, { unit_price: +e.target.value })} /></TableCell>
                <TableCell><Input type="number" value={it.discount} onChange={e => updateItem(i, { discount: +e.target.value })} /></TableCell>
                <TableCell><Input type="number" value={it.vat_rate} onChange={e => updateItem(i, { vat_rate: +e.target.value })} /></TableCell>
                <TableCell><Input type="number" value={it.ait_rate} onChange={e => updateItem(i, { ait_rate: +e.target.value })} /></TableCell>
                <TableCell className="text-right font-mono">{it.line_total.toFixed(2)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setItems(items.filter((_, x) => x !== i))}><Trash2 className="w-3.5 h-3.5" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="p-3"><Button size="sm" variant="outline" onClick={() => setItems([...items, empty()])}><Plus className="w-4 h-4 mr-1" />Add Line</Button></div>
      </CardContent></Card>

      <Card><CardContent className="p-4 grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea value={header.notes || ""} onChange={e => setHeader({ ...header, notes: e.target.value })} />
        </div>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between items-center"><span>Discount</span><Input className="w-32 h-7" type="number" value={header.discount_amount} onChange={e => setHeader({ ...header, discount_amount: +e.target.value })} /></div>
          <div className="flex justify-between"><span>VAT</span><span className="font-mono">{vat.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>AIT (withheld)</span><span className="font-mono">{ait.toFixed(2)}</span></div>
          <div className="flex justify-between items-center"><span>Other Charges</span><Input className="w-32 h-7" type="number" value={header.other_charges} onChange={e => setHeader({ ...header, other_charges: +e.target.value })} /></div>
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

export default SupplierBillFormPage;
