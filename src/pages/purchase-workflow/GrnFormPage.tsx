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
import { ArrowLeft, Save } from "lucide-react";
import { genDocNumber, GRN_PREFIX } from "@/lib/purchase-workflow-utils";
import { createStockLedgerEntry } from "@/lib/stock-ledger-utils";

interface Row { po_item_id: string; product_id: string; product_name: string; qty_remaining: number; qty_received: number; rate: number; }

export default function GrnFormPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const initialPo = params.get("po") || "";

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [poId, setPoId] = useState(initialPo);
  const [supplierInvNo, setSupplierInvNo] = useState("");
  const [supplierInvDate, setSupplierInvDate] = useState("");
  const [notes, setNotes] = useState("");
  const [pos, setPos] = useState<any[]>([]);
  const [po, setPo] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("purchase_orders_v2").select("id, po_number, supplier_id, status").in("status", ["sent", "partial_received"]).then(({ data }) => setPos(data || []));
  }, []);
  useEffect(() => { if (poId) loadPo(); }, [poId]);

  const loadPo = async () => {
    const { data: p } = await supabase.from("purchase_orders_v2").select("*").eq("id", poId).single();
    setPo(p);
    const { data: its } = await supabase.from("purchase_order_items_v2").select("*").eq("po_id", poId);
    const pids = (its || []).map((x: any) => x.product_id);
    const { data: prods } = await supabase.from("item_master").select("id, item_name").in("id", pids);
    const nameMap: Record<string, string> = {}; (prods || []).forEach((p: any) => { nameMap[p.id] = p.item_name; });
    setRows((its || []).filter((i: any) => Number(i.qty_ordered) - Number(i.qty_received) > 0).map((i: any) => {
      const rem = Number(i.qty_ordered) - Number(i.qty_received);
      return { po_item_id: i.id, product_id: i.product_id, product_name: nameMap[i.product_id] || "", qty_remaining: rem, qty_received: rem, rate: Number(i.rate) };
    }));
  };

  const total = rows.reduce((s, r) => s + r.qty_received * r.rate, 0);

  const save = async () => {
    if (!poId) return toast({ title: "Select PO", variant: "destructive" });
    const eligible = rows.filter(r => r.qty_received > 0);
    if (!eligible.length) return toast({ title: "Enter received quantities", variant: "destructive" });
    for (const r of eligible) if (r.qty_received > r.qty_remaining) return toast({ title: `Qty exceeds remaining for ${r.product_name}`, variant: "destructive" });
    setSaving(true);
    try {
      const grn_number = await genDocNumber(GRN_PREFIX, "grns");
      const { data: grn, error } = await supabase.from("grns").insert({
        grn_number, grn_date: date, po_id: poId, supplier_id: po.supplier_id,
        supplier_invoice_no: supplierInvNo || null, supplier_invoice_date: supplierInvDate || null,
        total_amount: total, status: "posted", received_by: user?.id, notes, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      const grnId = (grn as any).id;
      const { error: ie } = await supabase.from("grn_items").insert(eligible.map(r => ({
        grn_id: grnId, po_item_id: r.po_item_id, product_id: r.product_id, qty_received: r.qty_received, rate: r.rate, line_total: r.qty_received * r.rate,
      })));
      if (ie) throw ie;
      // Update PO item qty_received + stock ledger
      for (const r of eligible) {
        const { data: poi } = await supabase.from("purchase_order_items_v2").select("qty_received").eq("id", r.po_item_id).single();
        await supabase.from("purchase_order_items_v2").update({ qty_received: Number((poi as any)?.qty_received || 0) + r.qty_received }).eq("id", r.po_item_id);
        try {
          await createStockLedgerEntry({
            transaction_type: "purchase_grn", transaction_id: grnId, item_id: r.product_id,
            quantity_in: r.qty_received, quantity_out: 0, unit_cost: r.rate, reference_number: grn_number, transaction_date: date,
          });
        } catch (e) { console.warn("stock ledger", e); }
      }
      // Update PO status
      const { data: allItems } = await supabase.from("purchase_order_items_v2").select("qty_ordered, qty_received").eq("po_id", poId);
      const fullyReceived = (allItems || []).every((i: any) => Number(i.qty_received) >= Number(i.qty_ordered));
      await supabase.from("purchase_orders_v2").update({ status: fullyReceived ? "received" : "partial_received" }).eq("id", poId);
      toast({ title: "GRN posted", description: grn_number });
      navigate(`/purchase-workflow/grn/${grnId}`);
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <h1 className="text-xl font-bold">New GRN</h1>
      </div>
      <Card><CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><Label>GRN Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><Label>Purchase Order</Label>
          <select className="w-full h-9 border rounded px-2 bg-background text-sm" value={poId} onChange={e => setPoId(e.target.value)}>
            <option value="">Select PO</option>{pos.map(p => <option key={p.id} value={p.id}>{p.po_number}</option>)}
          </select>
        </div>
        <div><Label>Supplier Invoice #</Label><Input value={supplierInvNo} onChange={e => setSupplierInvNo(e.target.value)} /></div>
        <div><Label>Supplier Inv. Date</Label><Input type="date" value={supplierInvDate} onChange={e => setSupplierInvDate(e.target.value)} /></div>
      </CardContent></Card>
      {po && (
        <Card><CardContent className="p-4 space-y-3">
          <h3 className="font-medium">Items to Receive</h3>
          <Table>
            <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="w-28">Receive Qty</TableHead><TableHead className="w-28">Rate</TableHead><TableHead className="text-right">Line Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.product_name}</TableCell>
                  <TableCell className="text-right">{r.qty_remaining}</TableCell>
                  <TableCell><Input type="number" min={0} max={r.qty_remaining} step={0.001} value={r.qty_received} onChange={e => setRows(rows.map((x, idx) => idx === i ? { ...x, qty_received: Number(e.target.value) } : x))} className="h-8" /></TableCell>
                  <TableCell><Input type="number" min={0} step={0.01} value={r.rate} onChange={e => setRows(rows.map((x, idx) => idx === i ? { ...x, rate: Number(e.target.value) } : x))} className="h-8" /></TableCell>
                  <TableCell className="text-right">{(r.qty_received * r.rate).toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">All items already received</TableCell></TableRow>}
            </TableBody>
          </Table>
          <div className="flex justify-end font-semibold">Total: {total.toFixed(2)}</div>
        </CardContent></Card>
      )}
      <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
      <div className="flex justify-end"><Button onClick={save} disabled={saving || !rows.length}><Save className="w-4 h-4 mr-1" />{saving ? "Posting…" : "Post GRN"}</Button></div>
    </div>
  );
}
