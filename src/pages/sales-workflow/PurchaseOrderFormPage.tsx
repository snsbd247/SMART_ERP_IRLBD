import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";

import { DateInput } from "@/components/ui/date-input";
export default function PurchaseOrderFormPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({
    po_date: new Date().toISOString().slice(0, 10),
    delivery_date: "",
    customer_id: "",
    notes: "",
  });
  const [items, setItems] = useState<any[]>([
    { product_id: "", qty_ordered: 1, rate: 0, vat_pct: 15 },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dataClient.from("customers").select("id,name").order("name").then(({ data }) => setCustomers(data || []));
    dataClient.from("item_master").select("id,name:item_name,sku:item_code").order("item_name").then(({ data }) => setProducts(data || []));
    if (isEdit) {
      swApi.getPO(id!).then(({ data }) => {
        if (!data) return;
        setForm({
          po_date: data.po_date || "",
          delivery_date: data.delivery_date || "",
          customer_id: data.customer_id || "",
          notes: data.notes || "",
        });
        setItems((data.items || []).map((it: any) => ({
          product_id: it.product_id, qty_ordered: it.qty_ordered, rate: it.rate, vat_pct: it.vat_pct,
        })));
      });
    }
  }, [id]);

  const updateItem = (i: number, k: string, v: any) => {
    setItems((arr) => arr.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  };

  const submit = async () => {
    if (!form.customer_id) return toast({ title: "Select customer", variant: "destructive" });
    if (items.some((i) => !i.product_id || !i.qty_ordered)) return toast({ title: "Invalid items", variant: "destructive" });
    setSaving(true);
    const { data, error } = isEdit
      ? await swApi.updatePO(id!, form, items)
      : await swApi.createPO(form, items);
    setSaving(false);
    if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
    toast({ title: isEdit ? "PO updated" : `PO ${(data as any)?.po_number} created` });
    nav(`/sales-workflow/po/${(data as any)?.id || id}`);
  };

  const subtotal = items.reduce((s, i) => s + Number(i.qty_ordered || 0) * Number(i.rate || 0), 0);
  const vat = items.reduce((s, i) => s + Number(i.qty_ordered || 0) * Number(i.rate || 0) * (Number(i.vat_pct || 0) / 100), 0);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold">{isEdit ? "Edit Purchase Order" : "New Purchase Order"}</h1>
      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div><Label>PO Date</Label><DateInput value={form.po_date} onChange={(v) => setForm({ ...form, po_date: v })} /></div>
        <div><Label>Delivery Date</Label><DateInput value={form.delivery_date} onChange={(v) => setForm({ ...form, delivery_date: v })} /></div>
        <div>
          <Label>Customer</Label>
          <select className="w-full border rounded px-2 h-10 bg-background" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">— Select —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-3"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </Card>
      <Card className="p-4">
        <div className="flex justify-between mb-2"><h3 className="font-semibold">Items</h3>
          <Button size="sm" variant="outline" onClick={() => setItems([...items, { product_id: "", qty_ordered: 1, rate: 0, vat_pct: 15 }])}><Plus className="w-4 h-4 mr-1" />Add</Button>
        </div>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                <select className="w-full border rounded px-2 h-9 bg-background" value={it.product_id} onChange={(e) => updateItem(i, "product_id", e.target.value)}>
                  <option value="">— Product —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <Input className="col-span-2" type="number" step="0.001" placeholder="Qty" value={it.qty_ordered} onChange={(e) => updateItem(i, "qty_ordered", e.target.value)} />
              <Input className="col-span-2" type="number" step="0.01" placeholder="Rate" value={it.rate} onChange={(e) => updateItem(i, "rate", e.target.value)} />
              <Input className="col-span-2" type="number" step="0.01" placeholder="VAT %" value={it.vat_pct} onChange={(e) => updateItem(i, "vat_pct", e.target.value)} />
              <div className="col-span-1 text-right text-sm">{(Number(it.qty_ordered) * Number(it.rate)).toFixed(2)}</div>
              <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))}><Trash2 className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>
        <div className="mt-4 text-right space-y-1">
          <div>Subtotal: <span className="font-semibold">{subtotal.toFixed(2)}</span></div>
          <div>VAT: <span className="font-semibold">{vat.toFixed(2)}</span></div>
          <div className="text-lg">Grand Total: <span className="font-bold">{(subtotal + vat).toFixed(2)}</span></div>
        </div>
      </Card>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => nav(-1)}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>{saving ? "Saving..." : isEdit ? "Update PO" : "Create PO"}</Button>
      </div>
    </div>
  );
}
