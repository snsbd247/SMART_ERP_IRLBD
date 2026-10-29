import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Receipt, Search, Eye } from "lucide-react";

const STATUSES = ["all", "draft", "posted", "partially_paid", "paid", "cancelled"];

const SupplierBillsPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const load = async () => {
    setLoading(true);
    let query = dataClient.from("supplier_bills_v2" as any).select("*").order("created_at", { ascending: false }).limit(500);
    if (status !== "all") query = query.eq("status", status);
    const [r, s] = await Promise.all([query, dataClient.from("suppliers" as any).select("id,name")]);
    setRows((r.data || []) as any); setSuppliers((s.data || []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, [status]);

  const supName = (id: string) => suppliers.find((s: any) => s.id === id)?.name || "—";
  const filtered = rows.filter((r: any) => !q || r.bill_no?.toLowerCase().includes(q.toLowerCase()) || r.supplier_invoice_no?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Receipt className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Supplier Bills</h1></div>
        <Button size="sm" asChild><Link to="/purchase/bills/new"><Plus className="w-4 h-4 mr-1" />New Bill</Link></Button>
      </div>
      <div className="flex gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search bill / invoice #…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Bill #</TableHead><TableHead>Supplier Inv.</TableHead><TableHead>Date</TableHead>
            <TableHead>Supplier</TableHead><TableHead>Due</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead>
            <TableHead>Status</TableHead><TableHead className="w-16">View</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : filtered.length === 0 ? <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No bills</TableCell></TableRow>
            : filtered.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs"><Link to={`/purchase/bills/${r.id}`} className="text-primary hover:underline">{r.bill_no}</Link></TableCell>
                <TableCell>{r.supplier_invoice_no || "—"}</TableCell>
                <TableCell>{r.bill_date}</TableCell>
                <TableCell>{supName(r.supplier_id)}</TableCell>
                <TableCell>{r.due_date || "—"}</TableCell>
                <TableCell className="text-right font-mono">{Number(r.grand_total || 0).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono">{Number(r.paid_amount || 0).toLocaleString()}</TableCell>
                <TableCell><Badge variant={r.status === "paid" ? "default" : r.status === "cancelled" ? "destructive" : "outline"}>{r.status}</Badge></TableCell>
                <TableCell><Button asChild variant="ghost" size="icon" className="h-7 w-7"><Link to={`/purchase/bills/${r.id}`}><Eye className="w-3.5 h-3.5" /></Link></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default SupplierBillsPage;
