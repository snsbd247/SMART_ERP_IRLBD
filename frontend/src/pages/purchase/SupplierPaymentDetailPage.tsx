import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CheckCircle, Printer, CreditCard } from "lucide-react";
import { postSupplierPayment } from "@/lib/purchase-billing";

const SupplierPaymentDetailPage = () => {
  const { id } = useParams();
  const [pmt, setPmt] = useState<any>(null);
  const [allocs, setAllocs] = useState<any[]>([]);
  const [supplier, setSupplier] = useState<any>(null);

  const load = async () => {
    const { data: p } = await dataClient.from("supplier_payments_v2" as any).select("*").eq("id", id).maybeSingle();
    const { data: a } = await dataClient.from("supplier_payment_allocations" as any)
      .select("*,supplier_bills_v2(bill_no,bill_date,grand_total)").eq("payment_id", id);
    setPmt(p); setAllocs((a || []) as any);
    if ((p as any)?.supplier_id) {
      const { data: s } = await dataClient.from("suppliers" as any).select("name").eq("id", (p as any).supplier_id).maybeSingle();
      setSupplier(s);
    }
  };
  useEffect(() => { if (id) load(); }, [id]);

  const post = async () => {
    const { data: { user } } = await dataClient.auth.getUser();
    const v = await postSupplierPayment(pmt, user?.id);
    if (v) { toast.success("Payment posted to GL"); load(); }
    else toast.error("Posting failed — check COA mapping (cash/bank/payable)");
  };

  if (!pmt) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 space-y-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <CreditCard className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold">Payment {pmt.payment_no}</h1>
          <Badge variant={pmt.status === "posted" ? "default" : "outline"}>{pmt.status}</Badge>
        </div>
        <div className="flex gap-2">
          {pmt.status === "draft" && <Button size="sm" onClick={post}><CheckCircle className="w-4 h-4 mr-1" />Post to GL</Button>}
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
        </div>
      </div>
      <Card><CardContent className="p-4 grid md:grid-cols-4 gap-3 text-sm">
        <div><div className="text-muted-foreground">Supplier</div><div className="font-medium">{supplier?.name || "—"}</div></div>
        <div><div className="text-muted-foreground">Date</div><div>{pmt.payment_date}</div></div>
        <div><div className="text-muted-foreground">Method</div><div>{pmt.payment_method}</div></div>
        <div><div className="text-muted-foreground">Reference</div><div>{pmt.reference_no || "—"}</div></div>
        <div><div className="text-muted-foreground">Amount</div><div className="font-semibold">{Number(pmt.amount).toFixed(2)} {pmt.currency}</div></div>
        <div><div className="text-muted-foreground">Allocated</div><div>{Number(pmt.allocated_amount || 0).toFixed(2)}</div></div>
        <div><div className="text-muted-foreground">Advance</div><div>{(Number(pmt.amount) - Number(pmt.allocated_amount || 0)).toFixed(2)}</div></div>
      </CardContent></Card>
      <Card><CardContent className="p-0">
        <div className="p-3 text-sm font-medium border-b">Allocated Bills</div>
        <Table>
          <TableHeader><TableRow><TableHead>Bill #</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Bill Total</TableHead><TableHead className="text-right">Allocated</TableHead></TableRow></TableHeader>
          <TableBody>
            {allocs.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No allocations</TableCell></TableRow>
            : allocs.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-xs">{a.supplier_bills_v2?.bill_no}</TableCell>
                <TableCell>{a.supplier_bills_v2?.bill_date}</TableCell>
                <TableCell className="text-right font-mono">{Number(a.supplier_bills_v2?.grand_total || 0).toFixed(2)}</TableCell>
                <TableCell className="text-right font-mono">{Number(a.allocated_amount).toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default SupplierPaymentDetailPage;
