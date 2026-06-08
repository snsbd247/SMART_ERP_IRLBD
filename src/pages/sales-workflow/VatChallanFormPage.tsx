import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";

export default function VatChallanFormPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({
    challan_date: new Date().toISOString().slice(0, 10),
    customer_id: "", dispatch_id: sp.get("dispatch") || "",
    vehicle_no: "", driver_name: "", source: "manual", notes: "",
  });
  const [items, setItems] = useState<any[]>([{ product_id: "", qty: 1, rate: 0, vat_pct: 15 }]);

  useEffect(() => {
    supabase.from("customers").select("id,name").order("name").then(({ data }) => setCustomers(data || []));
    supabase.from("item_master").select("id,name:item_name").order("item_name").then(({ data }) => setProducts(data || []));
    if (form.dispatch_id) {
      supabase.from("dispatches").select("customer_id,vehicle_no,driver_name").eq("id", form.dispatch_id).maybeSingle().then(({ data }) => {
        if (data) setForm((f) => ({ ...f, customer_id: data.customer_id, vehicle_no: data.vehicle_no || "", driver_name: data.driver_name || "" }));
      });
    }
  }, []);

  const submit = async () => {
    if (!form.customer_id) return toast({ title: "Select customer", variant: "destructive" });
    const payload: any = { ...form, dispatch_id: form.dispatch_id || null };
    const { data, error } = await swApi.createVatChallan(payload, items);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: `VAT Challan ${data?.challan_number} created` });
    nav(`/sales-workflow/vat-challan/${data?.id}`);
  };

  const sub = items.reduce((s, i) => s + Number(i.qty) * Number(i.rate), 0);
  const vat = items.reduce((s, i) => s + Number(i.qty) * Number(i.rate) * (Number(i.vat_pct) / 100), 0);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold">New VAT Challan</h1>
      <Card className="p-4 grid md:grid-cols-3 gap-4">
        <div><Label>Date</Label><Input type="date" value={form.challan_date} onChange={(e) => setForm({ ...form, challan_date: e.target.value })} /></div>
        <div>
          <Label>Customer</Label>
          <select className="w-full border rounded px-2 h-10 bg-background" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">— Select —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><Label>Source</Label>
          <select className="w-full border rounded px-2 h-10 bg-background" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            <option value="manual">Manual</option><option value="import">Imported</option>
          </select>
        </div>
        <div><Label>Vehicle No</Label><Input value={form.vehicle_no} onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })} /></div>
        <div><Label>Driver</Label><Input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></div>
      </Card>
      <Card className="p-4">
        <div className="flex justify-between mb-2"><h3 className="font-semibold">Items (one DC per product)</h3>
          <Button size="sm" variant="outline" onClick={() => setItems([...items, { product_id: "", qty: 1, rate: 0, vat_pct: 15 }])}><Plus className="w-4 h-4 mr-1" />Add</Button></div>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-end">
            <div className="col-span-4">
              <select className="w-full border rounded px-2 h-9 bg-background" value={it.product_id} onChange={(e) => setItems(items.map((x, idx) => idx === i ? { ...x, product_id: e.target.value } : x))}>
                <option value="">— Product —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <Input className="col-span-2" type="number" step="0.001" placeholder="Qty" value={it.qty} onChange={(e) => setItems(items.map((x, idx) => idx === i ? { ...x, qty: e.target.value } : x))} />
            <Input className="col-span-2" type="number" step="0.01" placeholder="Rate" value={it.rate} onChange={(e) => setItems(items.map((x, idx) => idx === i ? { ...x, rate: e.target.value } : x))} />
            <Input className="col-span-2" type="number" step="0.01" placeholder="VAT %" value={it.vat_pct} onChange={(e) => setItems(items.map((x, idx) => idx === i ? { ...x, vat_pct: e.target.value } : x))} />
            <div className="col-span-1 text-right text-sm">{(Number(it.qty) * Number(it.rate)).toFixed(2)}</div>
            <Button className="col-span-1" size="icon" variant="ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        <div className="mt-4 text-right">
          <div>Subtotal: {sub.toFixed(2)}</div><div>VAT: {vat.toFixed(2)}</div>
          <div className="text-lg font-bold">Total: {(sub + vat).toFixed(2)}</div>
        </div>
      </Card>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => nav(-1)}>Cancel</Button><Button onClick={submit}>Create</Button></div>
    </div>
  );
}
