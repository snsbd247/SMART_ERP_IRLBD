import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, Search, Eye } from "lucide-react";

const STATUSES = ["all", "draft", "submitted", "approved", "rejected", "partial_approved", "closed", "cancelled"];
const statusVariant = (s: string): any =>
  s === "approved" ? "default" : s === "rejected" || s === "cancelled" ? "destructive" : s === "closed" ? "secondary" : "outline";

const RequisitionsPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const load = async () => {
    setLoading(true);
    let query = dataClient.from("purchase_requisitions" as any).select("*").order("created_at", { ascending: false }).limit(500);
    if (status !== "all") query = query.eq("status", status);
    const { data } = await query;
    setRows((data || []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, [status]);

  const filtered = rows.filter((r: any) =>
    !q || r.pr_no?.toLowerCase().includes(q.toLowerCase()) || r.requested_by_name?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Purchase Requisitions</h1></div>
        <Button size="sm" asChild><Link to="/purchase/requisitions/new"><Plus className="w-4 h-4 mr-1" />New PR</Link></Button>
      </div>
      <div className="flex gap-2 items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search PR #…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>PR #</TableHead><TableHead>Date</TableHead><TableHead>Required</TableHead>
            <TableHead>Requested By</TableHead><TableHead>Priority</TableHead>
            <TableHead className="text-right">Est. Total</TableHead>
            <TableHead>Status</TableHead><TableHead className="w-16">View</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No requisitions</TableCell></TableRow>
            : filtered.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs"><Link to={`/purchase/requisitions/${r.id}`} className="text-primary hover:underline">{r.pr_no}</Link></TableCell>
                <TableCell>{r.pr_date}</TableCell>
                <TableCell>{r.required_date || "—"}</TableCell>
                <TableCell>{r.requested_by_name || "—"}</TableCell>
                <TableCell className="capitalize">{r.priority}</TableCell>
                <TableCell className="text-right">{Number(r.total_estimated || 0).toLocaleString()}</TableCell>
                <TableCell><Badge variant={statusVariant(r.status)} className="capitalize">{r.status?.replace("_", " ")}</Badge></TableCell>
                <TableCell><Button asChild variant="ghost" size="icon" className="h-7 w-7"><Link to={`/purchase/requisitions/${r.id}`}><Eye className="w-3.5 h-3.5" /></Link></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default RequisitionsPage;
