import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Printer, Search } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";

interface PurchaseRow {
  id: string;
  purchase_number: string;
  purchase_date: string;
  supplier_id: string | null;
  total_amount: number;
  status: string;
  payment_method: string | null;
  supplier_name?: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

export default function PurchaseReport() {
  const { fc } = useCurrency();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [pRes, sRes] = await Promise.all([
      supabase.from("purchases")
        .select("id,purchase_number,purchase_date,supplier_id,total_amount,status,payment_method")
        .gte("purchase_date", from)
        .lte("purchase_date", to)
        .order("purchase_date", { ascending: false }),
      supabase.from("suppliers").select("id,name"),
    ]);
    const sMap: Record<string, string> = {};
    ((sRes.data as any[]) || []).forEach((s) => { sMap[s.id] = s.name; });
    setSuppliers(sMap);
    setRows(((pRes.data as any[]) || []).map((r) => ({ ...r, supplier_name: sMap[r.supplier_id || ""] || "—" })));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (status && r.status !== status) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.purchase_number.toLowerCase().includes(q) && !(r.supplier_name || "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, status, search]);

  const totals = useMemo(() => ({
    count: filtered.length,
    amount: filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0),
  }), [filtered]);

  return (
    <div className="p-6 space-y-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Purchase Report</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" /> Print
        </Button>
      </div>

      <Card className="print:hidden">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
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
              <Input className="pl-9" placeholder="Purchase No or Supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="lg:col-span-5 flex justify-end">
            <Button onClick={load} disabled={loading}>{loading ? "Loading..." : "Apply"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Purchases ({from} → {to})</CardTitle>
          <div className="text-sm text-muted-foreground">
            <span className="mr-4">Count: <b className="text-foreground">{totals.count}</b></span>
            <span>Total: <b className="text-foreground">{fc(totals.amount)}</b></span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Purchase No</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No purchases in this range</TableCell></TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.purchase_date}</TableCell>
                    <TableCell className="font-mono text-xs">{r.purchase_number}</TableCell>
                    <TableCell>{r.supplier_name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.payment_method || "—"}</TableCell>
                    <TableCell><Badge variant={r.status === "confirmed" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{fc(Number(r.total_amount || 0))}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
