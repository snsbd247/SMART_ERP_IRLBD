import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";

import { DateInput } from "@/components/ui/date-input";
type PoItem = {
  id: string; product_id: string; product?: { name: string };
  qty_ordered: number; qty_delivered: number; qty_remaining: number;
  rate: number; vat_pct: number;
};

type Row = { include: boolean; qty: number };

export default function VatChallanFormPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [openPos, setOpenPos] = useState<any[]>([]);
  const [poId, setPoId] = useState<string>(sp.get("po") || "");
  const [po, setPo] = useState<any | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [header, setHeader] = useState({
    challan_date: new Date().toISOString().slice(0, 10),
    vehicle_no: "", driver_name: "", notes: "",
  });

  useEffect(() => {
    dataClient
      .from("purchase_orders")
      .select("id, po_number, po_date, customer:customers(id,name), status")
      .is("deleted_at", null)
      .in("status", ["open", "partial"])
      .order("po_date", { ascending: false })
      .then(({ data }) => setOpenPos(data || []));
  }, []);

  useEffect(() => {
    if (!poId) { setPo(null); setRows({}); return; }
    swApi.getPoAvailability(poId).then(({ data }) => {
      setPo(data);
      const init: Record<string, Row> = {};
      (data?.items || []).forEach((it: any) => { init[it.id] = { include: false, qty: 0 }; });
      setRows(init);
    });
  }, [poId]);

  const items: PoItem[] = useMemo(() => (po?.items || []).filter((i: any) => Number(i.qty_remaining) > 0), [po]);
  const totals = useMemo(() => {
    let sub = 0, vat = 0;
    items.forEach((it) => {
      const r = rows[it.id];
      if (!r?.include) return;
      const q = Number(r.qty || 0);
      sub += q * Number(it.rate);
      vat += q * Number(it.rate) * Number(it.vat_pct) / 100;
    });
    return { sub, vat, grand: sub + vat };
  }, [items, rows]);

  const submit = async () => {
    if (!po) return toast({ title: "Select a Purchase Order first", variant: "destructive" });
    const lines = items
      .filter((it) => rows[it.id]?.include && Number(rows[it.id]?.qty) > 0)
      .map((it) => {
        const q = Number(rows[it.id].qty);
        if (q > Number(it.qty_remaining) + 0.0001) {
          throw new Error(`${it.product?.name}: qty ${q} exceeds remaining ${it.qty_remaining}`);
        }
        return {
          product_id: it.product_id,
          purchase_order_item_id: it.id,
          qty: q, rate: Number(it.rate), vat_pct: Number(it.vat_pct),
        };
      });
    if (!lines.length) return toast({ title: "Pick at least one product with qty", variant: "destructive" });

    try {
      const { data, error } = await swApi.createVatChallan({
        challan_date: header.challan_date,
        customer_id: po.customer.id,
        purchase_order_id: po.id,
        vehicle_no: header.vehicle_no || null,
        driver_name: header.driver_name || null,
        source: "manual",
        notes: header.notes || null,
      }, lines);
      if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
      toast({ title: `VAT Challan ${data?.challan_number} created (DCs auto-issued)` });
      nav(`/sales-workflow/vat-challan/${data?.id}`);
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <h1 className="text-2xl font-bold">Issue VAT Challan (Mushak 6.3)</h1>

      <Card className="p-4 grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <Label>Purchase Order</Label>
          <select className="w-full border rounded px-2 h-10 bg-background" value={poId} onChange={(e) => setPoId(e.target.value)}>
            <option value="">— Select PO —</option>
            {openPos.map((p: any) => (
              <option key={p.id} value={p.id}>{p.po_number} • {p.customer?.name} • {p.po_date}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Challan Date</Label>
          <DateInput value={header.challan_date} onChange={(v) => setHeader({ ...header, challan_date: v })} />
        </div>
        <div>
          <Label>Vehicle No</Label>
          <Input value={header.vehicle_no} onChange={(e) => setHeader({ ...header, vehicle_no: e.target.value })} />
        </div>
        <div>
          <Label>Driver Name</Label>
          <Input value={header.driver_name} onChange={(e) => setHeader({ ...header, driver_name: e.target.value })} />
        </div>
        <div>
          <Label>Notes</Label>
          <Input value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
        </div>
      </Card>

      {po && (
        <Card className="p-4">
          <div className="mb-2 text-sm text-muted-foreground">
            Customer: <b>{po.customer?.name}</b> • PO: <b>{po.po_number}</b>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">VAT%</TableHead>
                <TableHead className="text-right w-32">Deliver Now</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => {
                const r = rows[it.id] || { include: false, qty: 0 };
                const lineSub = Number(r.qty || 0) * Number(it.rate);
                const lineVat = lineSub * Number(it.vat_pct) / 100;
                return (
                  <TableRow key={it.id}>
                    <TableCell>
                      <Checkbox checked={r.include} onCheckedChange={(c) => setRows({ ...rows, [it.id]: { include: !!c, qty: c ? (r.qty || it.qty_remaining) : 0 } })} />
                    </TableCell>
                    <TableCell>{it.product?.name}</TableCell>
                    <TableCell className="text-right">{it.qty_ordered}</TableCell>
                    <TableCell className="text-right">{it.qty_delivered}</TableCell>
                    <TableCell className="text-right font-semibold">{it.qty_remaining}</TableCell>
                    <TableCell className="text-right">{Number(it.rate).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{it.vat_pct}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number" step="0.001" min={0} max={it.qty_remaining}
                        disabled={!r.include}
                        value={r.qty}
                        onChange={(e) => setRows({ ...rows, [it.id]: { include: true, qty: Number(e.target.value) } })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell className="text-right">{(lineSub + lineVat).toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
              {items.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">All items already delivered.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          <div className="mt-4 text-right space-y-1">
            <div>Subtotal: {totals.sub.toFixed(2)}</div>
            <div>VAT: {totals.vat.toFixed(2)}</div>
            <div className="text-lg font-bold">Grand Total: {totals.grand.toFixed(2)}</div>
          </div>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => nav(-1)}>Cancel</Button>
        <Button onClick={submit} disabled={!po}>Create VAT Challan + DCs</Button>
      </div>
    </div>
  );
}
