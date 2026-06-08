import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";

export default function DispatchFormPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState({
    dispatch_date: new Date().toISOString().slice(0, 10),
    customer_id: sp.get("customer") || "",
    vehicle_no: "", driver_name: "", driver_phone: "", notes: "",
  });
  const [openPoItems, setOpenPoItems] = useState<any[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({}); // po_item_id => allocated_qty

  useEffect(() => { supabase.from("customers").select("id,name").order("name").then(({ data }) => setCustomers(data || [])); }, []);

  useEffect(() => {
    if (!form.customer_id) { setOpenPoItems([]); return; }
    supabase.from("purchase_order_items")
      .select("*, product:item_master(name:item_name,sku:item_code), po:purchase_orders!inner(po_number,customer_id,status)")
      .gt("qty_remaining", 0)
      .eq("po.customer_id", form.customer_id)
      .then(({ data }) => setOpenPoItems(data || []));
  }, [form.customer_id]);

  const items = useMemo(() => {
    const byProduct: Record<string, { product_id: string; qty: number; allocations: { po_item_id: string; allocated_qty: number }[] }> = {};
    for (const poi of openPoItems) {
      const v = Number(alloc[poi.id] || 0);
      if (v <= 0) continue;
      if (!byProduct[poi.product_id]) byProduct[poi.product_id] = { product_id: poi.product_id, qty: 0, allocations: [] };
      byProduct[poi.product_id].qty += v;
      byProduct[poi.product_id].allocations.push({ po_item_id: poi.id, allocated_qty: v });
    }
    return Object.values(byProduct);
  }, [alloc, openPoItems]);

  const submit = async () => {
    if (!form.customer_id) return toast({ title: "Select customer", variant: "destructive" });
    if (items.length === 0) return toast({ title: "Allocate at least one PO line", variant: "destructive" });
    const overflow = openPoItems.find((p) => Number(alloc[p.id] || 0) > Number(p.qty_remaining));
    if (overflow) return toast({ title: `Over-allocation on ${overflow.product?.name}`, variant: "destructive" });
    const { data, error } = await swApi.createDispatch(form, items);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: `Dispatch ${data?.dispatch_number} created` });
    nav(`/sales-workflow/dispatch/${data?.id}`);
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold">New Dispatch</h1>
      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div><Label>Date</Label><Input type="date" value={form.dispatch_date} onChange={(e) => setForm({ ...form, dispatch_date: e.target.value })} /></div>
        <div>
          <Label>Customer</Label>
          <select className="w-full border rounded px-2 h-10 bg-background" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">— Select —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><Label>Vehicle No</Label><Input value={form.vehicle_no} onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })} /></div>
        <div><Label>Driver</Label><Input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></div>
        <div><Label>Driver Phone</Label><Input value={form.driver_phone} onChange={(e) => setForm({ ...form, driver_phone: e.target.value })} /></div>
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Allocate from Open POs</h3>
        <Table>
          <TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Product</TableHead><TableHead>Ordered</TableHead><TableHead>Remaining</TableHead><TableHead>Allocate</TableHead></TableRow></TableHeader>
          <TableBody>
            {openPoItems.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.po?.po_number}</TableCell>
                <TableCell>{p.product?.name}</TableCell>
                <TableCell>{p.qty_ordered}</TableCell>
                <TableCell>{p.qty_remaining}</TableCell>
                <TableCell><Input type="number" step="0.001" min="0" max={p.qty_remaining} className="w-24" value={alloc[p.id] || ""} onChange={(e) => setAlloc({ ...alloc, [p.id]: Number(e.target.value) })} /></TableCell>
              </TableRow>
            ))}
            {openPoItems.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">{form.customer_id ? "No open PO items" : "Select customer to load POs"}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => nav(-1)}>Cancel</Button><Button onClick={submit}>Create Dispatch</Button></div>
    </div>
  );
}
