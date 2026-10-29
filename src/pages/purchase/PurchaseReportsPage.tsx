import { useEffect, useMemo, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { BarChart3, Printer } from "lucide-react";
import { ReportPrintFooter } from "@/components/reports/ReportPrintFooter";

import { DateInput } from "@/components/ui/date-input";
const PurchaseReportsPage = () => {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [supplierId, setSupplierId] = useState<string>("all");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);

  useEffect(() => {
    dataClient.from("suppliers" as any).select("id,name").eq("is_active", true).then(({ data }) => setSuppliers((data || []) as any));
  }, []);

  useEffect(() => {
    (async () => {
      const f = (q: any) => {
        let r = q.gte("created_at", from).lte("created_at", to + "T23:59:59");
        if (supplierId !== "all") r = r.eq("supplier_id", supplierId);
        return r;
      };
      const [b, p, r, o] = await Promise.all([
        f(dataClient.from("supplier_bills_v2" as any).select("*")),
        f(dataClient.from("supplier_payments_v2" as any).select("*")),
        f(dataClient.from("purchase_returns_v2" as any).select("*")),
        f(dataClient.from("purchase_orders_v2" as any).select("*")),
      ]);
      setBills((b.data || []) as any); setPayments((p.data || []) as any);
      setReturns((r.data || []) as any); setPos((o.data || []) as any);
    })();
  }, [from, to, supplierId]);

  const supName = (id: string) => suppliers.find((s: any) => s.id === id)?.name || "—";

  const totals = useMemo(() => ({
    poCount: pos.length,
    poValue: pos.reduce((s, x) => s + Number(x.grand_total || 0), 0),
    billed: bills.reduce((s, x) => s + Number(x.grand_total || 0), 0),
    paid: payments.reduce((s, x) => s + Number(x.amount || 0), 0),
    returned: returns.reduce((s, x) => s + Number(x.grand_total || 0), 0),
    outstanding: bills.reduce((s, x) => s + (Number(x.grand_total) - Number(x.paid_amount || 0)), 0),
  }), [bills, payments, returns, pos]);

  // Aging buckets for outstanding bills (per supplier)
  const aging = useMemo(() => {
    const buckets: Record<string, { name: string; current: number; b1_30: number; b31_60: number; b61_90: number; b90p: number; total: number }> = {};
    const now = new Date();
    bills.filter(b => b.status !== "paid" && b.status !== "draft").forEach((b: any) => {
      const sid = b.supplier_id || "none";
      const due = Number(b.grand_total) - Number(b.paid_amount || 0);
      if (due <= 0) return;
      const dueDate = b.due_date ? new Date(b.due_date) : new Date(b.bill_date);
      const days = Math.floor((now.getTime() - dueDate.getTime()) / 86400000);
      const k = buckets[sid] ||= { name: supName(sid), current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90p: 0, total: 0 };
      if (days <= 0) k.current += due;
      else if (days <= 30) k.b1_30 += due;
      else if (days <= 60) k.b31_60 += due;
      else if (days <= 90) k.b61_90 += due;
      else k.b90p += due;
      k.total += due;
    });
    return Object.values(buckets).sort((a, b) => b.total - a.total);
  }, [bills, suppliers]);

  const supplierSummary = useMemo(() => {
    const acc: Record<string, { name: string; po: number; billed: number; paid: number; returned: number; outstanding: number }> = {};
    pos.forEach(p => { const k = acc[p.supplier_id] ||= { name: supName(p.supplier_id), po: 0, billed: 0, paid: 0, returned: 0, outstanding: 0 }; k.po += Number(p.grand_total || 0); });
    bills.forEach(b => { const k = acc[b.supplier_id] ||= { name: supName(b.supplier_id), po: 0, billed: 0, paid: 0, returned: 0, outstanding: 0 }; k.billed += Number(b.grand_total || 0); k.outstanding += Number(b.grand_total) - Number(b.paid_amount || 0); });
    payments.forEach(p => { const k = acc[p.supplier_id] ||= { name: supName(p.supplier_id), po: 0, billed: 0, paid: 0, returned: 0, outstanding: 0 }; k.paid += Number(p.amount || 0); });
    returns.forEach(r => { const k = acc[r.supplier_id] ||= { name: supName(r.supplier_id), po: 0, billed: 0, paid: 0, returned: 0, outstanding: 0 }; k.returned += Number(r.grand_total || 0); });
    return Object.values(acc).sort((a, b) => b.billed - a.billed);
  }, [bills, payments, returns, pos, suppliers]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Purchase Reports</h1></div>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
      </div>

      <Card><CardContent className="p-4 grid md:grid-cols-4 gap-3">
        <div><Label>From</Label><DateInput value={from} onChange={(v) => setFrom(v)} /></div>
        <div><Label>To</Label><DateInput value={to} onChange={(v) => setTo(v)} /></div>
        <div className="md:col-span-2"><Label>Supplier</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Suppliers</SelectItem>
              {suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardContent></Card>

      <div className="grid md:grid-cols-6 gap-3">
        {[
          { l: "PO Count", v: totals.poCount },
          { l: "PO Value", v: totals.poValue },
          { l: "Billed", v: totals.billed },
          { l: "Paid", v: totals.paid },
          { l: "Returned", v: totals.returned },
          { l: "Outstanding", v: totals.outstanding },
        ].map(k => (
          <Card key={k.l}><CardContent className="p-3">
            <div className="text-xs text-muted-foreground">{k.l}</div>
            <div className="text-lg font-mono font-semibold">{typeof k.v === "number" ? k.v.toLocaleString() : k.v}</div>
          </CardContent></Card>
        ))}
      </div>

      <Tabs defaultValue="supplier">
        <TabsList>
          <TabsTrigger value="supplier">Supplier-wise</TabsTrigger>
          <TabsTrigger value="aging">Payable Aging</TabsTrigger>
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="returns">Returns</TabsTrigger>
        </TabsList>

        <TabsContent value="supplier">
          <Card><CardContent className="p-0"><Table>
            <TableHeader><TableRow>
              <TableHead>Supplier</TableHead><TableHead className="text-right">PO Value</TableHead>
              <TableHead className="text-right">Billed</TableHead><TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Returned</TableHead><TableHead className="text-right">Outstanding</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {supplierSummary.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No data</TableCell></TableRow>
              : supplierSummary.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right font-mono">{r.po.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{r.billed.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{r.paid.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{r.returned.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-destructive">{r.outstanding.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></CardContent></Card>
        </TabsContent>

        <TabsContent value="aging">
          <Card><CardContent className="p-0"><Table>
            <TableHeader><TableRow>
              <TableHead>Supplier</TableHead><TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">1-30</TableHead><TableHead className="text-right">31-60</TableHead>
              <TableHead className="text-right">61-90</TableHead><TableHead className="text-right">90+</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {aging.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No outstanding</TableCell></TableRow>
              : aging.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right font-mono">{r.current.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{r.b1_30.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{r.b31_60.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{r.b61_90.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-destructive">{r.b90p.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{r.total.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></CardContent></Card>
        </TabsContent>

        <TabsContent value="bills">
          <Card><CardContent className="p-0"><Table>
            <TableHeader><TableRow><TableHead>Bill #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Due</TableHead></TableRow></TableHeader>
            <TableBody>{bills.map((b: any) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono text-xs">{b.bill_no}</TableCell>
                <TableCell>{b.bill_date}</TableCell>
                <TableCell>{supName(b.supplier_id)}</TableCell>
                <TableCell>{b.status}</TableCell>
                <TableCell className="text-right font-mono">{Number(b.grand_total).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono">{Number(b.paid_amount || 0).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono">{(Number(b.grand_total) - Number(b.paid_amount || 0)).toLocaleString()}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></CardContent></Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card><CardContent className="p-0"><Table>
            <TableHeader><TableRow><TableHead>Pmt #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{payments.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.payment_no}</TableCell>
                <TableCell>{p.payment_date}</TableCell>
                <TableCell>{supName(p.supplier_id)}</TableCell>
                <TableCell>{p.payment_method}</TableCell>
                <TableCell className="text-right font-mono">{Number(p.amount).toLocaleString()}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></CardContent></Card>
        </TabsContent>

        <TabsContent value="returns">
          <Card><CardContent className="p-0"><Table>
            <TableHeader><TableRow><TableHead>Return #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{returns.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.return_no}</TableCell>
                <TableCell>{r.return_date}</TableCell>
                <TableCell>{supName(r.supplier_id)}</TableCell>
                <TableCell>{r.reason || "—"}</TableCell>
                <TableCell className="text-right font-mono">{Number(r.grand_total).toLocaleString()}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></CardContent></Card>
        </TabsContent>
      </Tabs>
      <ReportPrintFooter />
    </div>
  );
};

export default PurchaseReportsPage;
