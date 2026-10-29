import { useEffect, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Search } from "lucide-react";

const AuditLogPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await dataClient.from("purchase_audit_log" as any)
        .select("*").order("created_at", { ascending: false }).limit(500);
      setRows((data || []) as any); setLoading(false);
    })();
  }, []);

  const filtered = rows.filter(r =>
    !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><ScrollText className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Purchase Audit Log</h1></div>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>When</TableHead><TableHead>Doc Type</TableHead><TableHead>Doc No</TableHead>
            <TableHead>Action</TableHead><TableHead>User</TableHead><TableHead>Notes</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : filtered.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No audit entries</TableCell></TableRow>
            : filtered.map(r => (
              <TableRow key={r.id}>
                <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline">{r.document_type}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{r.document_no || "—"}</TableCell>
                <TableCell><Badge>{r.action}</Badge></TableCell>
                <TableCell>{r.performed_by_name || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.notes || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
};

export default AuditLogPage;
