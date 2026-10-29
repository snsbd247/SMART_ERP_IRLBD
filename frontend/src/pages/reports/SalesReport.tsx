import { useEffect, useMemo, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Receipt, Printer, Search } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { ReportPrintFooter } from "@/components/reports/ReportPrintFooter";

import { DateInput } from "@/components/ui/date-input";
interface SalesRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  customer_id: string | null;
  total_amount: number;
  net_amount: number;
  discount: number;
  status: string;
  customer_name?: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

export default function SalesReport() {
  const { fc } = useCurrency();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [sRes, cRes] = await Promise.all([
      dataClient.from("sales_invoices")
        .select("id,invoice_number,invoice_date,customer_id,total_amount,net_amount,discount,status")
        .gte("invoice_date", from)
        .lte("invoice_date", to)
        .order("invoice_date", { ascending: false }),
      dataClient.from("customers").select("id,name"),
    ]);
    const cMap: Record<string, string> = {};
    ((cRes.data as any[]) || []).forEach((c) => { cMap[c.id] = c.name; });
    setCustomers(cMap);
    setRows(((sRes.data as any[]) || []).map((r) => ({ ...r, customer_name: cMap[r.customer_id || ""] || "—" })));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (status && r.status !== status) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.invoice_number.toLowerCase().includes(q) && !(r.customer_name || "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, status, search]);

  const totals = useMemo(() => ({
    count: filtered.length,
    gross: filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0),
    discount: filtered.reduce((s, r) => s + Number(r.discount || 0), 0),
    net: filtered.reduce((s, r) => s + Number(r.net_amount || 0), 0),
  }), [filtered]);

  return (
    <div className="p-6 space-y-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Sales Report</h1>
        </div>
        <Button className="print:hidden" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" /> Print
        </Button>
      </div>

      <Card className="print:hidden">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div><Label>From</Label><DateInput value={from} onChange={(v) => setFrom(v)} /></div>
          <div><Label>To</Label><DateInput value={to} onChange={(v) => setTo(v)} /></div>
          <div>
            <Label>Status</Label>
            <select className="w-full h-10 border rounded px-3 bg-background" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label>Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Invoice No or Customer" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="lg:col-span-5 flex justify-end">
            <Button onClick={load} disabled={loading}>{loading ? "Loading..." : "Apply"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Sales Invoices ({from} → {to})</CardTitle>
          <div className="text-sm text-muted-foreground">
            <span className="mr-4">Count: <b className="text-foreground">{totals.count}</b></span>
            <span className="mr-4">Gross: <b className="text-foreground">{fc(totals.gross)}</b></span>
            <span className="mr-4">Discount: <b className="text-foreground">{fc(totals.discount)}</b></span>
            <span>Net: <b className="text-foreground">{fc(totals.net)}</b></span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Invoice No</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No invoices in this range</TableCell></TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.invoice_date}</TableCell>
                    <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                    <TableCell>{r.customer_name}</TableCell>
                    <TableCell><Badge variant={r.status === "confirmed" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right">{fc(Number(r.total_amount || 0))}</TableCell>
                    <TableCell className="text-right">{fc(Number(r.discount || 0))}</TableCell>
                    <TableCell className="text-right font-medium">{fc(Number(r.net_amount || 0))}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <ReportPrintFooter />
    </div>
  );
}
