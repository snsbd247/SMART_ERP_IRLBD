import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, PackageCheck, Search, Eye } from "lucide-react";

const STATUSES = ["all", "Draft", "Approved", "Cancelled"];

const GrnsPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const load = async () => {
    setLoading(true);
    let query = dataClient.from("grns_v2" as any).select("*").order("created_at", { ascending: false }).limit(500);
    if (status !== "all") query = query.eq("status", status);
    const [r, s] = await Promise.all([query, dataClient.from("suppliers" as any).select("id,name")]);
    setRows((r.data || []) as any); setSuppliers((s.data || []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, [status]);

  const supName = (id: string) => suppliers.find((s: any) => s.id === id)?.name || "—";
  const filtered = rows.filter((r: any) => !q || r.grn_no?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><PackageCheck className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Goods Receipt Notes (GRN)</h1></div>
        <Button size="sm" asChild><Link to="/purchase/grns/new"><Plus className="w-4 h-4 mr-1" />New GRN</Link></Button>
      </div>
      <div className="flex gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search GRN #…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>GRN #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
            <TableHead>Challan</TableHead>
            <TableHead className="text-right">Grand Total</TableHead>
            <TableHead>Status</TableHead><TableHead className="w-16">View</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No GRNs</TableCell></TableRow>
            : filtered.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs"><Link to={`/purchase/grns/${r.id}`} className="text-primary hover:underline">{r.grn_no}</Link></TableCell>
                <TableCell>{r.grn_date}</TableCell>
                <TableCell>{supName(r.supplier_id)}</TableCell>
                <TableCell>{r.challan_no || "—"}</TableCell>
                <TableCell className="text-right font-mono">{Number(r.grand_total || 0).toLocaleString()}</TableCell>
                <TableCell><Badge variant={r.status === "Approved" ? "default" : r.status === "Cancelled" ? "destructive" : "outline"}>{r.status}</Badge></TableCell>
                <TableCell><Button asChild variant="ghost" size="icon" className="h-7 w-7"><Link to={`/purchase/grns/${r.id}`}><Eye className="w-3.5 h-3.5" /></Link></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default GrnsPage;
