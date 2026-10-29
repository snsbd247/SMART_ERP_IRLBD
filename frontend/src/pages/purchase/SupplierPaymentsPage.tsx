import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, CreditCard, Search, Eye } from "lucide-react";

const SupplierPaymentsPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [r, s] = await Promise.all([
        dataClient.from("supplier_payments_v2" as any).select("*").order("created_at", { ascending: false }).limit(500),
        dataClient.from("suppliers" as any).select("id,name"),
      ]);
      setRows((r.data || []) as any); setSuppliers((s.data || []) as any); setLoading(false);
    })();
  }, []);
  const supName = (id: string) => suppliers.find((s: any) => s.id === id)?.name || "—";
  const filtered = rows.filter((r: any) => !q || r.payment_no?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Supplier Payments</h1></div>
        <Button size="sm" asChild><Link to="/purchase/payments/new"><Plus className="w-4 h-4 mr-1" />New Payment</Link></Button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search payment #…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Pmt #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
            <TableHead>Method</TableHead><TableHead>Reference</TableHead>
            <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="w-16">View</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No payments</TableCell></TableRow>
            : filtered.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs"><Link to={`/purchase/payments/${r.id}`} className="text-primary hover:underline">{r.payment_no}</Link></TableCell>
                <TableCell>{r.payment_date}</TableCell>
                <TableCell>{supName(r.supplier_id)}</TableCell>
                <TableCell>{r.payment_method}</TableCell>
                <TableCell>{r.reference_no || "—"}</TableCell>
                <TableCell className="text-right font-mono">{Number(r.amount || 0).toLocaleString()}</TableCell>
                <TableCell><Badge variant={r.status === "posted" ? "default" : "outline"}>{r.status}</Badge></TableCell>
                <TableCell><Button asChild variant="ghost" size="icon" className="h-7 w-7"><Link to={`/purchase/payments/${r.id}`}><Eye className="w-3.5 h-3.5" /></Link></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default SupplierPaymentsPage;
