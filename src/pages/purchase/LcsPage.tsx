import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Globe, Search, Eye } from "lucide-react";

const LcsPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [r, s] = await Promise.all([
        dataClient.from("lc_documents" as any).select("*").order("created_at", { ascending: false }).limit(500),
        dataClient.from("suppliers" as any).select("id,name"),
      ]);
      setRows((r.data || []) as any); setSuppliers((s.data || []) as any); setLoading(false);
    })();
  }, []);
  const supName = (id: string) => suppliers.find((s: any) => s.id === id)?.name || "—";
  const filtered = rows.filter((r: any) => !q || r.lc_no?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Globe className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Letters of Credit / Import</h1></div>
        <Button size="sm" asChild><Link to="/purchase/lc/new"><Plus className="w-4 h-4 mr-1" />New LC</Link></Button>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search LC #…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>LC #</TableHead><TableHead>Date</TableHead><TableHead>Expiry</TableHead>
            <TableHead>Supplier</TableHead><TableHead>Bank</TableHead>
            <TableHead className="text-right">LC Amount</TableHead><TableHead className="text-right">Landed Cost</TableHead>
            <TableHead>Status</TableHead><TableHead className="w-16">View</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : filtered.length === 0 ? <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No LCs</TableCell></TableRow>
            : filtered.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs"><Link to={`/purchase/lc/${r.id}`} className="text-primary hover:underline">{r.lc_no}</Link></TableCell>
                <TableCell>{r.lc_date}</TableCell>
                <TableCell>{r.expiry_date || "—"}</TableCell>
                <TableCell>{supName(r.supplier_id)}</TableCell>
                <TableCell>{r.bank_name || "—"}</TableCell>
                <TableCell className="text-right font-mono">{Number(r.lc_amount || 0).toLocaleString()} {r.currency}</TableCell>
                <TableCell className="text-right font-mono">{Number(r.landed_cost || 0).toLocaleString()}</TableCell>
                <TableCell><Badge variant={r.status === "closed" ? "default" : "outline"}>{r.status}</Badge></TableCell>
                <TableCell><Button asChild variant="ghost" size="icon" className="h-7 w-7"><Link to={`/purchase/lc/${r.id}`}><Eye className="w-3.5 h-3.5" /></Link></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default LcsPage;
