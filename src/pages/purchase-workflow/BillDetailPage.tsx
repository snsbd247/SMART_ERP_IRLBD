import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Printer } from "lucide-react";
import { genDocNumber, PAY_PREFIX } from "@/lib/purchase-workflow-utils";
import { autoPostAccounting, findAccountByName } from "@/lib/accounting-utils";

export default function BillDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [bill, setBill] = useState<any>(null);
  const [supplier, setSupplier] = useState<any>(null);
  const [grns, setGrns] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState(0);
  const [tdsAmount, setTdsAmount] = useState(0);
  const [payMethod, setPayMethod] = useState("cash");
  const [bankAccountId, setBankAccountId] = useState("");
  const [refNo, setRefNo] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data: b } = await supabase.from("purchase_bills").select("*").eq("id", id).single();
    setBill(b);
    if (b) {
      supabase.from("suppliers").select("*").eq("id", (b as any).supplier_id).single().then(({ data }) => setSupplier(data));
      const { data: links } = await supabase.from("purchase_bill_grns").select("grn_id, amount").eq("bill_id", id);
      const gids = (links || []).map((l: any) => l.grn_id);
      if (gids.length) {
        const { data: gs } = await supabase.from("grns").select("id, grn_number, grn_date, total_amount").in("id", gids);
        setGrns(gs || []);
      } else setGrns([]);
      const { data: pays } = await supabase.from("purchase_bill_payments").select("*").eq("bill_id", id).order("payment_date");
      setPayments(pays || []);
      const due = Number((b as any).grand_total) - Number((b as any).paid_amount);
      setPayAmount(due);
    }
    supabase.from("chart_of_accounts").select("id, account_code, account_name").eq("is_active", true).ilike("account_name", "%bank%").then(({ data }) => setBankAccounts(data || []));
  };
  useEffect(() => { load(); }, [id]);

  const recordPayment = async () => {
    if (payAmount <= 0) return toast({ title: "Enter amount", variant: "destructive" });
    setSaving(true);
    try {
      const payment_number = await genDocNumber(PAY_PREFIX, "purchase_bill_payments");
      const totalDebited = payAmount + tdsAmount;
      // Accounting: DR AP (totalDebited), CR Bank/Cash (payAmount), CR TDS Payable (tdsAmount)
      const apAcc = await findAccountByName("Accounts Payable");
      const bankOrCashName = payMethod === "cash" ? "Cash" : "Bank";
      const bankAcc = bankAccountId || await findAccountByName(bankOrCashName);
      const tdsAcc = tdsAmount > 0 ? (await findAccountByName("TDS Payable")) : null;
      let voucherId: string | null = null;
      if (apAcc && bankAcc) {
        const entries: any[] = [
          { account_id: apAcc, debit: totalDebited, credit: 0, narration: `Payment ${payment_number}` },
          { account_id: bankAcc, debit: 0, credit: payAmount, narration: `Payment ${payment_number}` },
        ];
        if (tdsAmount > 0 && tdsAcc) entries.push({ account_id: tdsAcc, debit: 0, credit: tdsAmount, narration: `TDS on ${payment_number}` });
        else if (tdsAmount > 0) { toast({ title: "TDS Payable account not found; TDS netted to bank" }); entries[1].credit += tdsAmount; }
        const r = await autoPostAccounting({
          voucher_type: "payment", voucher_date: payDate, description: `Bill ${bill.bill_number} payment`, entries, created_by: user?.id,
        });
        voucherId = r.voucherId;
      } else {
        toast({ title: "Saved without accounting", description: "Configure Accounts Payable / Bank ledgers" });
      }
      const { error } = await supabase.from("purchase_bill_payments").insert({
        payment_number, bill_id: id, payment_date: payDate, amount: payAmount, tds_amount: tdsAmount,
        payment_method: payMethod, bank_account_id: bankAccountId || null, reference_no: refNo || null,
        voucher_id: voucherId, created_by: user?.id,
      });
      if (error) throw error;
      const newPaid = Number(bill.paid_amount) + totalDebited;
      const newStatus = newPaid >= Number(bill.grand_total) - 0.01 ? "paid" : "partial";
      await supabase.from("purchase_bills").update({ paid_amount: newPaid, tds_amount: Number(bill.tds_amount) + tdsAmount, status: newStatus }).eq("id", id);
      toast({ title: "Payment recorded" });
      setPayOpen(false); setTdsAmount(0); setRefNo("");
      load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (!bill) return <div className="p-6">Loading…</div>;
  const due = Number(bill.grand_total) - Number(bill.paid_amount);

  return (
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-bold">{bill.bill_number}</h1>
          <Badge>{bill.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
          {bill.status !== "paid" && <Button size="sm" onClick={() => setPayOpen(true)}><Plus className="w-4 h-4 mr-1" />Record Payment</Button>}
        </div>
      </div>
      <Card><CardContent className="p-6 space-y-4">
        <div className="text-center"><h2 className="text-2xl font-bold">PURCHASE BILL</h2><p className="text-sm text-muted-foreground">{bill.bill_number}</p></div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-semibold">Supplier:</div>
            <div>{supplier?.name}</div>
            {supplier?.bin_number && <div>BIN: {supplier.bin_number}</div>}
          </div>
          <div className="text-right">
            <div><span className="text-muted-foreground">Bill Date:</span> {bill.bill_date}</div>
            <div><span className="text-muted-foreground">Due Date:</span> {bill.due_date || "—"}</div>
            <div><span className="text-muted-foreground">Supplier Bill:</span> {bill.supplier_bill_no || "—"}</div>
          </div>
        </div>
        <div>
          <h3 className="font-medium mb-2">Linked GRNs</h3>
          <Table>
            <TableHeader><TableRow><TableHead>GRN #</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{grns.map(g => <TableRow key={g.id}><TableCell>{g.grn_number}</TableCell><TableCell>{g.grn_date}</TableCell><TableCell className="text-right">{Number(g.total_amount).toFixed(2)}</TableCell></TableRow>)}</TableBody>
          </Table>
        </div>
        <div className="flex justify-end text-sm">
          <div className="w-64 space-y-1">
            <div className="flex justify-between"><span>Subtotal</span><span>{Number(bill.subtotal).toFixed(2)}</span></div>
            <div className="flex justify-between"><span>VAT</span><span>{Number(bill.vat_amount).toFixed(2)}</span></div>
            <div className="flex justify-between font-bold border-t pt-1"><span>Grand Total</span><span>{Number(bill.grand_total).toFixed(2)}</span></div>
            <div className="flex justify-between text-emerald-600"><span>Paid</span><span>{Number(bill.paid_amount).toFixed(2)}</span></div>
            <div className="flex justify-between text-red-600 font-bold"><span>Due</span><span>{due.toFixed(2)}</span></div>
          </div>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-2">
        <h3 className="font-medium">Payments</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Payment #</TableHead><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Ref</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">TDS</TableHead></TableRow></TableHeader>
          <TableBody>
            {payments.map(p => (
              <TableRow key={p.id}><TableCell>{p.payment_number}</TableCell><TableCell>{p.payment_date}</TableCell><TableCell>{p.payment_method}</TableCell><TableCell>{p.reference_no || "—"}</TableCell><TableCell className="text-right">{Number(p.amount).toFixed(2)}</TableCell><TableCell className="text-right">{Number(p.tds_amount).toFixed(2)}</TableCell></TableRow>
            ))}
            {payments.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">No payments</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Payment Date</Label><Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></div>
              <div><Label>Method</Label>
                <select className="w-full h-9 border rounded px-2 bg-background text-sm" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                  <option value="cash">Cash</option><option value="bank">Bank</option><option value="cheque">Cheque</option>
                </select>
              </div>
              <div><Label>Amount Paid</Label><Input type="number" min={0} step={0.01} value={payAmount} onChange={e => setPayAmount(Number(e.target.value))} /></div>
              <div><Label>TDS Amount</Label><Input type="number" min={0} step={0.01} value={tdsAmount} onChange={e => setTdsAmount(Number(e.target.value))} /></div>
              {payMethod !== "cash" && (
                <div className="col-span-2"><Label>Bank Ledger</Label>
                  <select className="w-full h-9 border rounded px-2 bg-background text-sm" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
                    <option value="">Auto (lookup "Bank")</option>{bankAccounts.map(b => <option key={b.id} value={b.id}>{b.account_code} — {b.account_name}</option>)}
                  </select>
                </div>
              )}
              <div className="col-span-2"><Label>Reference / Cheque #</Label><Input value={refNo} onChange={e => setRefNo(e.target.value)} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Total settled: {(payAmount + tdsAmount).toFixed(2)} (Amount + TDS)</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button><Button onClick={recordPayment} disabled={saving}>{saving ? "Saving…" : "Save Payment"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
