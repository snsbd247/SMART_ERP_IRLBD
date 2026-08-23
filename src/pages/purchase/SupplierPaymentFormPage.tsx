import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { nextDocNo, logAudit } from "@/lib/purchase-numbering";

import { DateInput } from "@/components/ui/date-input";
const SupplierPaymentFormPage = () => {
  const [sp] = useSearchParams();
  const billId = sp.get("bill");
  const nav = useNavigate();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [header, setHeader] = useState<any>({
    payment_no: "", payment_date: new Date().toISOString().slice(0, 10), supplier_id: "", branch_id: "",
    payment_method: "cash", reference_no: "", amount: 0, currency: "BDT", notes: "",
  });

  useEffect(() => {
    (async () => {
      const [s, b] = await Promise.all([
        supabase.from("suppliers" as any).select("id,name").eq("is_active", true),
        supabase.from("branches").select("id,name"),
      ]);
      setSuppliers((s.data || []) as any); setBranches((b.data || []) as any);
      const no = await nextDocNo("PAY", "supplier_payments_v2", "payment_no");
      setHeader((h: any) => ({ ...h, payment_no: no }));
      if (billId) {
        const { data: b1 } = await supabase.from("supplier_bills_v2" as any).select("*").eq("id", billId).maybeSingle();
        if (b1) {
          const due = Number((b1 as any).grand_total) - Number((b1 as any).paid_amount || 0);
          setHeader((h: any) => ({ ...h, supplier_id: (b1 as any).supplier_id, branch_id: (b1 as any).branch_id, amount: due }));
          setSelected({ [billId]: due });
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (!header.supplier_id) return;
    (async () => {
      const { data } = await supabase.from("supplier_bills_v2" as any).select("*")
        .eq("supplier_id", header.supplier_id).in("status", ["posted", "partially_paid"]).order("bill_date", { ascending: true });
      setBills((data || []) as any);
    })();
  }, [header.supplier_id]);

  const totalSelected = Object.values(selected).reduce((s, v) => s + (Number(v) || 0), 0);

  const save = async () => {
    if (!header.supplier_id || !header.amount) { toast.error("Supplier and amount required"); return; }
    if (totalSelected > Number(header.amount)) { toast.error("Allocations exceed payment amount"); return; }
    const { data, error } = await supabase.from("supplier_payments_v2" as any).insert({
      ...header, allocated_amount: totalSelected, status: "draft",
    } as any).select("id").single();
    if (error) return toast.error(error.message);
    const pid = (data as any).id as string;
    const allocs = Object.entries(selected).filter(([, v]) => Number(v) > 0).map(([bill_id, allocated_amount]) => ({ payment_id: pid, bill_id, allocated_amount }));
    if (allocs.length) {
      await supabase.from("supplier_payment_allocations" as any).insert(allocs as any);
      for (const a of allocs) {
        const bill = bills.find((b: any) => b.id === a.bill_id);
        if (bill) {
          const newPaid = Number(bill.paid_amount || 0) + Number(a.allocated_amount);
          await supabase.from("supplier_bills_v2" as any).update({
            paid_amount: newPaid,
            status: newPaid >= Number(bill.grand_total) ? "paid" : "partially_paid",
          }).eq("id", bill.id);
        }
      }
    }
    await logAudit({ document_type: "PAYMENT", document_id: pid, document_no: header.payment_no, action: "created" });
    toast.success("Payment recorded");
    nav(`/purchase/payments/${pid}`);
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">New Supplier Payment</h1>
      <Card><CardContent className="p-4 grid md:grid-cols-4 gap-3">
        <div><Label>Payment #</Label><Input value={header.payment_no} onChange={e => setHeader({ ...header, payment_no: e.target.value })} /></div>
        <div><Label>Date</Label><DateInput value={header.payment_date} onChange={(v) => setHeader({ ...header, payment_date: v })} /></div>
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
        <div><Label>Method</Label>
          <Select value={header.payment_method} onValueChange={v => setHeader({ ...header, payment_method: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem><SelectItem value="bank">Bank Transfer</SelectItem>
              <SelectItem value="cheque">Cheque</SelectItem><SelectItem value="mobile">Mobile Banking</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Reference #</Label><Input value={header.reference_no || ""} onChange={e => setHeader({ ...header, reference_no: e.target.value })} /></div>
        <div><Label>Amount</Label><Input type="number" value={header.amount} onChange={e => setHeader({ ...header, amount: +e.target.value })} /></div>
        <div><Label>Currency</Label><Input value={header.currency} onChange={e => setHeader({ ...header, currency: e.target.value })} /></div>
      </CardContent></Card>

      {bills.length > 0 && (
        <Card><CardContent className="p-0">
          <div className="p-3 text-sm font-medium border-b">Allocate to outstanding bills (FIFO)</div>
          <Table>
            <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>Bill #</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Due</TableHead><TableHead className="w-32">Allocate</TableHead></TableRow></TableHeader>
            <TableBody>
              {bills.map((b: any) => {
                const due = Number(b.grand_total) - Number(b.paid_amount || 0);
                return (
                  <TableRow key={b.id}>
                    <TableCell><Checkbox checked={selected[b.id] != null} onCheckedChange={c => setSelected(s => { const n = { ...s }; if (c) n[b.id] = due; else delete n[b.id]; return n; })} /></TableCell>
                    <TableCell className="font-mono text-xs">{b.bill_no}</TableCell>
                    <TableCell>{b.bill_date}</TableCell>
                    <TableCell className="text-right font-mono">{Number(b.grand_total).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{Number(b.paid_amount || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{due.toFixed(2)}</TableCell>
                    <TableCell><Input type="number" disabled={selected[b.id] == null} value={selected[b.id] ?? ""} onChange={e => setSelected(s => ({ ...s, [b.id]: +e.target.value }))} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="p-3 text-sm flex justify-end gap-6">
            <span>Allocated: <strong className="font-mono">{totalSelected.toFixed(2)}</strong></span>
            <span>Advance: <strong className="font-mono">{Math.max(0, Number(header.amount) - totalSelected).toFixed(2)}</strong></span>
          </div>
        </CardContent></Card>
      )}

      <Card><CardContent className="p-4">
        <Label>Notes</Label>
        <Textarea value={header.notes || ""} onChange={e => setHeader({ ...header, notes: e.target.value })} />
      </CardContent></Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => nav(-1)}>Cancel</Button>
        <Button onClick={save}><Save className="w-4 h-4 mr-1" />Save Payment</Button>
      </div>
    </div>
  );
};

export default SupplierPaymentFormPage;
