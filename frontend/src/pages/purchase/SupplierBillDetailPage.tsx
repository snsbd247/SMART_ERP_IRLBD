import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CheckCircle, Edit, Printer, FileText, CreditCard } from "lucide-react";
import { postSupplierBill } from "@/lib/purchase-billing";

const SupplierBillDetailPage = () => {
  const { id } = useParams();
  const [bill, setBill] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [supplier, setSupplier] = useState<any>(null);
  const [allocations, setAllocations] = useState<any[]>([]);

  const load = async () => {
    const { data: h } = await dataClient.from("supplier_bills_v2" as any).select("*").eq("id", id).maybeSingle();
    const { data: it } = await dataClient.from("supplier_bill_items_v2" as any).select("*").eq("bill_id", id).order("sort_order");
    const { data: al } = await dataClient.from("supplier_payment_allocations" as any).select("*,supplier_payments_v2(payment_no,payment_date,payment_method)").eq("bill_id", id);
    setBill(h); setItems((it || []) as any); setAllocations((al || []) as any);
    if ((h as any)?.supplier_id) {
      const { data: s } = await dataClient.from("suppliers" as any).select("*").eq("id", (h as any).supplier_id).maybeSingle();
      setSupplier(s);
    }
  };
  useEffect(() => { if (id) load(); }, [id]);

  const post = async () => {
    if (!bill) return;
    const { data: { user } } = await dataClient.auth.getUser();
    const v = await postSupplierBill(bill, supplier?.purchase_type_id, user?.id);
    if (v) { toast.success("Bill posted to GL"); load(); }
    else toast.error("Posting failed — check COA mapping");
  };

  if (!bill) return <div className="p-6">Loading…</div>;
  const due = Number(bill.grand_total) - Number(bill.paid_amount || 0);

  return (
    <div className="p-6 space-y-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold">Bill {bill.bill_no}</h1>
          <Badge variant={bill.status === "paid" ? "default" : bill.status === "cancelled" ? "destructive" : "outline"}>{bill.status}</Badge>
        </div>
        <div className="flex gap-2">
          {bill.status === "draft" && <Button asChild variant="outline" size="sm"><Link to={`/purchase/bills/${bill.id}/edit`}><Edit className="w-4 h-4 mr-1" />Edit</Link></Button>}
          {bill.status === "draft" && <Button size="sm" onClick={post}><CheckCircle className="w-4 h-4 mr-1" />Post to GL</Button>}
          {bill.status !== "draft" && due > 0 && <Button asChild size="sm"><Link to={`/purchase/payments/new?bill=${bill.id}`}><CreditCard className="w-4 h-4 mr-1" />Pay</Link></Button>}
          <Button className="print:hidden" variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
        </div>
      </div>

      <Card><CardContent className="p-4 grid md:grid-cols-4 gap-3 text-sm">
        <div><div className="text-muted-foreground">Supplier</div><div className="font-medium">{supplier?.name || "—"}</div></div>
        <div><div className="text-muted-foreground">Supplier Invoice #</div><div>{bill.supplier_invoice_no || "—"}</div></div>
        <div><div className="text-muted-foreground">Bill Date</div><div>{bill.bill_date}</div></div>
        <div><div className="text-muted-foreground">Due Date</div><div>{bill.due_date || "—"}</div></div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit</TableHead><TableHead className="text-right">Disc</TableHead>
            <TableHead className="text-right">VAT%</TableHead><TableHead className="text-right">Total</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.map((it, i) => (
              <TableRow key={i}>
                <TableCell>{it.description}</TableCell>
                <TableCell className="text-right font-mono">{it.quantity}</TableCell>
                <TableCell className="text-right font-mono">{Number(it.unit_price).toFixed(2)}</TableCell>
                <TableCell className="text-right font-mono">{Number(it.discount).toFixed(2)}</TableCell>
                <TableCell className="text-right font-mono">{it.vat_rate}</TableCell>
                <TableCell className="text-right font-mono">{Number(it.line_total).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card><CardContent className="p-4 space-y-1 text-sm">
          <div className="font-medium mb-2">Totals</div>
          <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{Number(bill.subtotal).toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Discount</span><span className="font-mono">{Number(bill.discount_amount).toFixed(2)}</span></div>
          <div className="flex justify-between"><span>VAT</span><span className="font-mono">{Number(bill.vat_amount).toFixed(2)}</span></div>
          <div className="flex justify-between"><span>AIT</span><span className="font-mono">{Number(bill.ait_amount).toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Other</span><span className="font-mono">{Number(bill.other_charges).toFixed(2)}</span></div>
          <div className="flex justify-between font-semibold border-t pt-2"><span>Grand Total</span><span className="font-mono">{Number(bill.grand_total).toFixed(2)}</span></div>
          <div className="flex justify-between text-emerald-600"><span>Paid</span><span className="font-mono">{Number(bill.paid_amount || 0).toFixed(2)}</span></div>
          <div className="flex justify-between text-destructive font-semibold"><span>Due</span><span className="font-mono">{due.toFixed(2)}</span></div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="font-medium mb-2">Payments</div>
          {allocations.length === 0 ? <div className="text-sm text-muted-foreground">No payments yet.</div> : (
            <Table>
              <TableHeader><TableRow><TableHead>Pmt #</TableHead><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {allocations.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.supplier_payments_v2?.payment_no}</TableCell>
                    <TableCell>{a.supplier_payments_v2?.payment_date}</TableCell>
                    <TableCell>{a.supplier_payments_v2?.payment_method}</TableCell>
                    <TableCell className="text-right font-mono">{Number(a.allocated_amount).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      </div>
    </div>
  );
};

export default SupplierBillDetailPage;
