import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Wallet } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { newPaymentNumber, getActiveFinancialYearId } from "@/lib/purchase-workflow-utils";
import { autoPostAccounting, findAccountByName } from "@/lib/accounting-utils";

export default function BillDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { userBranchId } = useBranch();
  const { toast } = useToast();
  const { fc } = useCurrency();
  const [bill, setBill] = useState<any>(null);
  const [grns, setGrns] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [pay, setPay] = useState({ date: new Date().toISOString().slice(0, 10), amount: 0, tds: 0, method: "cash", bankId: "", ref: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!id) return;
    const [b, gl, pl, bk] = await Promise.all([
      supabase.from("purchase_bills" as any).select("*, suppliers(name)").eq("id", id).single(),
      supabase.from("purchase_bill_grns" as any).select("*, grns(grn_number, grn_date)").eq("bill_id", id),
      supabase.from("purchase_bill_payments" as any).select("*").eq("bill_id", id).order("payment_date", { ascending: false }),
      supabase.from("chart_of_accounts").select("id, account_name, account_code").eq("is_active", true),
    ]);
    setBill(b.data); setGrns((gl.data as any) || []); setPayments((pl.data as any) || []); setBanks((bk.data as any) || []);
  };
  useEffect(() => { load(); }, [id]);

  if (!bill) return <div className="p-6">Loading...</div>;
  const outstanding = Number(bill.grand_total) - Number(bill.paid_amount) - Number(bill.tds_amount);

  const savePayment = async () => {
    if (pay.amount <= 0 && pay.tds <= 0) return toast({ title: "Enter amount", variant: "destructive" });
    if (pay.amount + pay.tds > outstanding + 0.01) return toast({ title: "Exceeds outstanding", variant: "destructive" });
    setSaving(true);
    try {
      const payment_number = await newPaymentNumber();
      const { data: p, error } = await supabase.from("purchase_bill_payments" as any).insert({
        payment_number, bill_id: bill.id, payment_date: pay.date,
        amount: pay.amount, tds_amount: pay.tds, payment_method: pay.method,
        bank_account_id: pay.bankId || null, reference_no: pay.ref || null,
        notes: pay.notes || null, created_by: user?.id || null,
      } as any).select().single();
      if (error) throw error;

      // Auto-post: DR AP, CR Bank/Cash, CR TDS Payable
      try {
        const apAcc = await findAccountByName("Accounts Payable");
        const payAcc = pay.bankId || await findAccountByName(pay.method === "cash" ? "Cash" : "Bank");
        const tdsAcc = pay.tds > 0 ? await findAccountByName("TDS Payable") : null;
        if (apAcc && payAcc) {
          const entries: any[] = [
            { account_id: apAcc, debit: pay.amount + pay.tds, credit: 0, narration: `Bill ${bill.bill_number}` },
            { account_id: payAcc, debit: 0, credit: pay.amount, narration: `Payment ${payment_number}` },
          ];
          if (tdsAcc && pay.tds > 0) entries.push({ account_id: tdsAcc, debit: 0, credit: pay.tds, narration: "TDS" });
          else if (pay.tds > 0) entries[1].credit += pay.tds;
          const fy = await getActiveFinancialYearId();
          const v = await autoPostAccounting({
            voucher_type: "payment", voucher_date: pay.date, description: `Bill Payment ${payment_number}`,
            branch_id: userBranchId, financial_year_id: fy, entries, created_by: user?.id,
            reference_type: "purchase_bill_payment", reference_id: (p as any).id,
          });
          await supabase.from("purchase_bill_payments" as any).update({ voucher_id: v.voucherId }).eq("id", (p as any).id);
        }
      } catch (e: any) { console.warn("Auto-post:", e.message); }

      // Update bill totals
      const newPaid = Number(bill.paid_amount) + pay.amount;
      const newTds = Number(bill.tds_amount) + pay.tds;
      const remaining = Number(bill.grand_total) - newPaid - newTds;
      const status = remaining <= 0.01 ? "paid" : newPaid + newTds > 0 ? "partial" : "unpaid";
      await supabase.from("purchase_bills" as any).update({ paid_amount: newPaid, tds_amount: newTds, status }).eq("id", bill.id);

      toast({ title: "Payment recorded", description: payment_number });
      setOpen(false); setPay({ date: new Date().toISOString().slice(0, 10), amount: 0, tds: 0, method: "cash", bankId: "", ref: "", notes: "" });
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" onClick={() => nav("/purchase-workflow/bills")}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{bill.bill_number} <Badge className="ml-2">{bill.status}</Badge></CardTitle>
          {outstanding > 0.01 && <Button onClick={() => setOpen(true)}><Wallet className="w-4 h-4 mr-2" />Record Payment</Button>}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div><span className="text-muted-foreground">Date:</span> {bill.bill_date}</div>
            <div><span className="text-muted-foreground">Supplier:</span> {bill.suppliers?.name}</div>
            <div><span className="text-muted-foreground">Due:</span> {bill.due_date || "-"}</div>
            <div><span className="text-muted-foreground">Supplier Bill #:</span> {bill.supplier_bill_no || "-"}</div>
            <div><span className="text-muted-foreground">Subtotal:</span> {fc(bill.subtotal)}</div>
            <div><span className="text-muted-foreground">VAT:</span> {fc(bill.vat_amount)}</div>
            <div><span className="text-muted-foreground">Grand:</span> <b>{fc(bill.grand_total)}</b></div>
            <div><span className="text-muted-foreground">Outstanding:</span> <b className="text-destructive">{fc(outstanding)}</b></div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Linked GRNs</h3>
            <Table>
              <TableHeader><TableRow><TableHead>GRN #</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {grns.map(g => (
                  <TableRow key={g.id}><TableCell className="font-mono">{g.grns?.grn_number}</TableCell><TableCell>{g.grns?.grn_date}</TableCell><TableCell className="text-right">{fc(g.amount)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Payments</h3>
            <Table>
              <TableHeader><TableRow><TableHead>Payment #</TableHead><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">TDS</TableHead><TableHead>Ref</TableHead></TableRow></TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">{p.payment_number}</TableCell>
                    <TableCell>{p.payment_date}</TableCell>
                    <TableCell>{p.payment_method}</TableCell>
                    <TableCell className="text-right">{fc(p.amount)}</TableCell>
                    <TableCell className="text-right">{fc(p.tds_amount)}</TableCell>
                    <TableCell>{p.reference_no || "-"}</TableCell>
                  </TableRow>
                ))}
                {!payments.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No payments yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} /></div>
              <div>
                <Label>Method</Label>
                <Select value={pay.method} onValueChange={v => setPay({ ...pay, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="mfs">MFS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Amount</Label><Input type="number" value={pay.amount || ""} onChange={e => setPay({ ...pay, amount: Number(e.target.value) })} /></div>
              <div><Label>TDS Deducted</Label><Input type="number" value={pay.tds || ""} onChange={e => setPay({ ...pay, tds: Number(e.target.value) })} /></div>
              <div className="col-span-2">
                <Label>Bank/Cash Account (optional)</Label>
                <Select value={pay.bankId || "none"} onValueChange={v => setPay({ ...pay, bankId: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Auto-detect" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Auto —</SelectItem>
                    {banks.filter(a => /cash|bank/i.test(a.account_name)).map(a => <SelectItem key={a.id} value={a.id}>{a.account_code} - {a.account_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Label>Reference</Label><Input value={pay.ref} onChange={e => setPay({ ...pay, ref: e.target.value })} placeholder="Cheque/Txn #" /></div>
              <div className="col-span-2"><Label>Notes</Label><Input value={pay.notes} onChange={e => setPay({ ...pay, notes: e.target.value })} /></div>
            </div>
            <div className="text-sm text-muted-foreground">Outstanding: <b>{fc(outstanding)}</b></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={savePayment} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
