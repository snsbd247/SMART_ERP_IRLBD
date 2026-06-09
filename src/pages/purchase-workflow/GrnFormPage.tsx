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
import { ArrowLeft } from "lucide-react";
import { newGRNNumber } from "@/lib/purchase-workflow-utils";
import { createStockLedgerEntry } from "@/lib/stock-ledger-utils";

export default function GrnFormPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const initialPo = sp.get("po") || "";
  const { user } = useAuth();
  const { userBranchId } = useBranch();
  const { toast } = useToast();
  const [openPOs, setOpenPOs] = useState<any[]>([]);
  const [poId, setPoId] = useState(initialPo);
  const [po, setPo] = useState<any>(null);
  const [poItems, setPoItems] = useState<any[]>([]);
  const [recv, setRecv] = useState<Record<string, number>>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [supInv, setSupInv] = useState("");
  const [supInvDate, setSupInvDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("purchase_orders_v2" as any).select("id,po_number, suppliers(name)").in("status", ["open", "partial"]).order("created_at", { ascending: false })
      .then(({ data }) => setOpenPOs((data as any) || []));
  }, []);

  useEffect(() => {
    if (!poId) { setPo(null); setPoItems([]); return; }
    Promise.all([
      supabase.from("purchase_orders_v2" as any).select("*, suppliers(name)").eq("id", poId).single(),
      supabase.from("purchase_order_items_v2" as any).select("*, products(product_name, product_code)").eq("po_id", poId),
    ]).then(([p, it]) => {
      setPo(p.data); setPoItems((it.data as any) || []);
      const init: Record<string, number> = {};
      (it.data as any[] || []).forEach(i => { init[i.id] = Math.max(0, i.qty_ordered - i.qty_received); });
      setRecv(init);
    });
  }, [poId]);

  const total = poItems.reduce((s, i) => s + (recv[i.id] || 0) * Number(i.rate), 0);

  const save = async () => {
    if (!po) return toast({ title: "Select a PO", variant: "destructive" });
    const items = poItems.filter(i => (recv[i.id] || 0) > 0);
    if (!items.length) return toast({ title: "Enter received qty", variant: "destructive" });
    for (const i of items) {
      const pending = i.qty_ordered - i.qty_received;
      if (recv[i.id] > pending) return toast({ title: `Qty exceeds pending for ${i.products?.product_name}`, variant: "destructive" });
    }
    setSaving(true);
    try {
      const grn_number = await newGRNNumber();
      const { data: grn, error } = await supabase.from("grns" as any).insert({
        grn_number, grn_date: date, po_id: po.id, supplier_id: po.supplier_id,
        supplier_invoice_no: supInv || null, supplier_invoice_date: supInvDate || null,
        branch_id: userBranchId || null, received_by: user?.id || null,
        total_amount: total, status: "received", notes: notes || null, created_by: user?.id || null,
      } as any).select().single();
      if (error) throw error;

      const grnItems = items.map(i => ({
        grn_id: (grn as any).id, po_item_id: i.id, product_id: i.product_id,
        qty_received: recv[i.id], rate: i.rate, line_total: recv[i.id] * Number(i.rate), qty_billed: 0,
      }));
      const { error: e2 } = await supabase.from("grn_items" as any).insert(grnItems);
      if (e2) throw e2;

      // Update PO item qty_received and stock ledger
      for (const i of items) {
        await supabase.from("purchase_order_items_v2" as any).update({ qty_received: Number(i.qty_received) + recv[i.id] }).eq("id", i.id);
        try {
          await createStockLedgerEntry({
            transaction_type: "grn", transaction_id: (grn as any).id, item_id: i.product_id,
            branch_id: userBranchId || null, quantity_in: recv[i.id], quantity_out: 0,
            unit_cost: Number(i.rate), reference_number: grn_number, transaction_date: date,
          });
        } catch (e) { console.warn("Stock ledger:", e); }
      }

      // Update PO status if all received
      const { data: allItems } = await supabase.from("purchase_order_items_v2" as any).select("qty_ordered,qty_received").eq("po_id", po.id);
      const allDone = (allItems as any[] || []).every(x => x.qty_received >= x.qty_ordered);
      const anyDone = (allItems as any[] || []).some(x => x.qty_received > 0);
      await supabase.from("purchase_orders_v2" as any).update({ status: allDone ? "received" : anyDone ? "partial" : "open" }).eq("id", po.id);

      toast({ title: "GRN created", description: grn_number });
      nav(`/purchase-workflow/grn/${(grn as any).id}`);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" onClick={() => nav(-1)}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
      <Card>
        <CardHeader><CardTitle>New GRN (Goods Receipt)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Label>Purchase Order</Label>
              <Select value={poId} onValueChange={setPoId}>
                <SelectTrigger><SelectValue placeholder="Select PO" /></SelectTrigger>
                <SelectContent>{openPOs.map(p => <SelectItem key={p.id} value={p.id}>{p.po_number} - {p.suppliers?.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>GRN Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><Label>Supplier Invoice/Challan #</Label><Input value={supInv} onChange={e => setSupInv(e.target.value)} /></div>
            <div><Label>Supplier Invoice Date</Label><Input type="date" value={supInvDate} onChange={e => setSupInvDate(e.target.value)} /></div>
          </div>
          {po && (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Ordered</TableHead><TableHead>Already Received</TableHead><TableHead>Pending</TableHead><TableHead className="w-32">Receive Now</TableHead><TableHead>Rate</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {poItems.map(i => {
                    const pending = i.qty_ordered - i.qty_received;
                    return (
                      <TableRow key={i.id}>
                        <TableCell>{i.products?.product_code} - {i.products?.product_name}</TableCell>
                        <TableCell>{i.qty_ordered}</TableCell>
                        <TableCell>{i.qty_received}</TableCell>
                        <TableCell>{pending}</TableCell>
                        <TableCell><Input type="number" max={pending} value={recv[i.id] || ""} onChange={e => setRecv({ ...recv, [i.id]: Number(e.target.value) })} /></TableCell>
                        <TableCell>{i.rate}</TableCell>
                        <TableCell className="text-right">{((recv[i.id] || 0) * Number(i.rate)).toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="text-right text-lg">Total: <b>{total.toFixed(2)}</b></div>
            </>
          )}
          <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => nav(-1)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !po}>{saving ? "Saving..." : "Create GRN"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
