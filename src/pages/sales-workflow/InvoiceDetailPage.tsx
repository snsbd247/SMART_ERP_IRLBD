import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { PrintTaxInvoice, PrintMoneyReceipt } from "@/components/sales-workflow/SalesWorkflowPrints";

import { DateInput } from "@/components/ui/date-input";
export default function InvoiceDetailPage() {
  const { id } = useParams();
  const [inv, setInv] = useState<any>(null);
  const [pay, setPay] = useState<any>({
    payment_date: new Date().toISOString().slice(0, 10),
    mode: "bank", amount_received: 0, tds_amount: 0, tds_pct: 0,
    tds_certificate_no: "", tds_certificate_date: "", reference: "",
  });
  const [bill, setBill] = useState<any>({
    bill_submitted_at: new Date().toISOString().slice(0, 10),
    payment_terms_days: 30,
    bill_submission_ref: "",
  });
  const load = () => swApi.getInvoice(id!).then(({ data }) => {
    setInv(data);
    if (data?.payment_terms_days) setBill((b: any) => ({ ...b, payment_terms_days: data.payment_terms_days }));
  });
  useEffect(() => { load(); }, [id]);

  const submitPayment = async () => {
    if (!pay.amount_received && !pay.tds_amount) return toast({ title: "Enter amount", variant: "destructive" });
    const { error } = await swApi.recordPayment(id!, pay);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Payment recorded" });
    setPay({ ...pay, amount_received: 0, tds_amount: 0 });
    load();
  };

  const submitBill = async () => {
    if (!bill.bill_submitted_at) return toast({ title: "Enter submission date", variant: "destructive" });
    const { error } = await swApi.submitBill(id!, bill);
    if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
    toast({ title: "Bill marked submitted", description: `Due date calculated.` });
    load();
  };

  if (!inv) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex justify-between">
        <div><h1 className="text-2xl font-bold">{inv.invoice_number}</h1>
          <p className="text-muted-foreground">{inv.customer?.name} • {inv.invoice_date} • Mode: {inv.mode}</p></div>
        <div className="flex items-center gap-2"><PrintTaxInvoice inv={inv} /><Badge>{inv.status}</Badge></div>
      </div>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">Line Items</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Rate</TableHead><TableHead>VAT %</TableHead><TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {inv.items?.map((it: any) => (
              <TableRow key={it.id}><TableCell>{it.product?.name}</TableCell><TableCell>{it.qty}</TableCell><TableCell>{Number(it.rate).toFixed(2)}</TableCell><TableCell>{it.vat_pct}</TableCell><TableCell className="text-right">{Number(it.vat_amount).toFixed(2)}</TableCell><TableCell className="text-right">{Number(it.line_total).toFixed(2)}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="text-right mt-3 space-y-1">
          <div>Subtotal: {Number(inv.subtotal).toFixed(2)}</div>
          <div>VAT: {Number(inv.vat_total).toFixed(2)}</div>
          <div className="font-bold">Grand Total: {Number(inv.grand_total).toFixed(2)}</div>
          <div>Paid: {Number(inv.paid_amount).toFixed(2)} | TDS: {Number(inv.tds_amount).toFixed(2)}</div>
          <div className="text-lg font-bold text-primary">Due: {Number(inv.due_amount).toFixed(2)}</div>
          {inv.bill_submitted_at && (
            <div className="text-sm text-muted-foreground">
              Bill submitted: <span className="font-medium text-foreground">{inv.bill_submitted_at}</span>
              {inv.bill_due_date && <> • Payment due: <span className="font-medium text-foreground">{inv.bill_due_date}</span></>}
              {inv.bill_submission_ref && <> • Ref: <span className="font-medium text-foreground">{inv.bill_submission_ref}</span></>}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Submit Bill to Customer HO</h3>
        {inv.bill_submitted_at ? (
          <p className="text-sm text-muted-foreground">
            Already submitted on <b>{inv.bill_submitted_at}</b>. Payment due on <b>{inv.bill_due_date}</b> ({inv.payment_terms_days} days).
            You can re-submit below to update.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-2">
            Mark this invoice as submitted to the customer's HO / Accounts. Due date will be calculated automatically.
          </p>
        )}
        <div className="grid md:grid-cols-4 gap-3 mt-2">
          <div><Label>Submission Date</Label><DateInput value={bill.bill_submitted_at} onChange={(v) => setBill({ ...bill, bill_submitted_at: v })} /></div>
          <div><Label>Credit Days</Label><Input type="number" min={0} max={365} value={bill.payment_terms_days} onChange={(e) => setBill({ ...bill, payment_terms_days: Number(e.target.value) })} /></div>
          <div className="md:col-span-2"><Label>Customer Receipt / Ref</Label><Input placeholder="e.g. Bill register no." value={bill.bill_submission_ref} onChange={(e) => setBill({ ...bill, bill_submission_ref: e.target.value })} /></div>
        </div>
        <div className="flex justify-end mt-3"><Button onClick={submitBill}>{inv.bill_submitted_at ? "Update Submission" : "Mark Bill Submitted"}</Button></div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Record Payment / TDS</h3>
        <div className="grid md:grid-cols-4 gap-3">
          <div><Label>Date</Label><DateInput value={pay.payment_date} onChange={(v) => setPay({ ...pay, payment_date: v })} /></div>
          <div><Label>Mode</Label>
            <select className="w-full border rounded px-2 h-10 bg-background" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
              <option value="cash">Cash</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="online">Online</option>
            </select>
          </div>
          <div><Label>Amount Received</Label><Input type="number" step="0.01" value={pay.amount_received} onChange={(e) => setPay({ ...pay, amount_received: e.target.value })} /></div>
          <div><Label>TDS Amount</Label><Input type="number" step="0.01" value={pay.tds_amount} onChange={(e) => setPay({ ...pay, tds_amount: e.target.value })} /></div>
          <div><Label>TDS %</Label><Input type="number" step="0.01" value={pay.tds_pct} onChange={(e) => setPay({ ...pay, tds_pct: e.target.value })} /></div>
          <div><Label>TDS Cert No</Label><Input value={pay.tds_certificate_no} onChange={(e) => setPay({ ...pay, tds_certificate_no: e.target.value })} /></div>
          <div><Label>TDS Cert Date</Label><DateInput value={pay.tds_certificate_date} onChange={(v) => setPay({ ...pay, tds_certificate_date: v })} /></div>
          <div><Label>Reference</Label><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
        </div>
        <div className="flex justify-end mt-3"><Button onClick={submitPayment}>Record</Button></div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Payments History</h3>
        <Table>
          <TableHeader><TableRow><TableHead>No</TableHead><TableHead>Date</TableHead><TableHead>Mode</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">TDS</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Receipt</TableHead></TableRow></TableHeader>
          <TableBody>
            {inv.payments?.map((p: any) => (
              <TableRow key={p.id}><TableCell>{p.payment_number}</TableCell><TableCell>{p.payment_date}</TableCell><TableCell>{p.mode}</TableCell><TableCell className="text-right">{Number(p.amount_received).toFixed(2)}</TableCell><TableCell className="text-right">{Number(p.tds_amount).toFixed(2)}</TableCell><TableCell className="text-right">{Number(p.total_settled).toFixed(2)}</TableCell><TableCell className="text-right"><PrintMoneyReceipt payment={p} invoice={inv} /></TableCell></TableRow>
            ))}
            {!inv.payments?.length && <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground">No payments yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Link to="/sales-workflow/invoices"><Button variant="outline">Back</Button></Link>
    </div>
  );
}
