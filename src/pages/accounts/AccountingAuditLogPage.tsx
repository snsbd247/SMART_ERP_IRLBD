import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, RefreshCw } from "lucide-react";

interface Row {
  id: string;
  user_id: string | null;
  user_name: string | null;
  module: string;
  action: string;
  record_id: string | null;
  details: string | null;
  new_data: any;
  ip_address: string | null;
  created_at: string;
}

const ACCOUNTING_ACTIONS = [
  { value: "all", label: "All actions" },
  { value: "reject_inactive_fy", label: "Rejected: Inactive FY" },
  { value: "create", label: "Create" },
  { value: "edit", label: "Edit" },
  { value: "delete", label: "Delete" },
];

export default function AccountingAuditLogPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState("reject_inactive_fy");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      let query: any = supabase
        .from("audit_log" as any)
        .select("id,user_id,user_name,module,action,record_id,details,new_data,ip_address,created_at")
        .eq("module", "accounting")
        .order("created_at", { ascending: false })
        .limit(500);
      if (action !== "all") query = query.eq("action", action);
      if (from) query = query.gte("created_at", `${from}T00:00:00`);
      if (to) query = query.lte("created_at", `${to}T23:59:59`);
      const { data } = await query;
      setRows((data || []) as any);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [action, from, to]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.user_name, r.details, r.record_id, r.new_data?.voucher_type, r.new_data?.financial_year_name]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [rows, q]);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ScrollText className="w-6 h-6" /> Accounting Audit Log
        </h1>
        <p className="text-muted-foreground">Track voucher activity — including rejected posts due to inactive Financial Years.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div>
              <Label>Action</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNTING_ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="md:col-span-1">
              <Label>Search</Label>
              <Input placeholder="user, voucher, FY name" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entries ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>FY</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const isReject = r.action === "reject_inactive_fy";
                  const nd = r.new_data || {};
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(r.created_at).toLocaleString("en-GB")}
                      </TableCell>
                      <TableCell>{r.user_name || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={isReject ? "destructive" : "secondary"}>{r.action}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {nd.voucher_type || "—"}
                        {nd.voucher_date ? <div className="text-muted-foreground">{nd.voucher_date}</div> : null}
                      </TableCell>
                      <TableCell className="text-xs">{nd.financial_year_name || nd.financial_year_id || "—"}</TableCell>
                      <TableCell className="text-xs max-w-md truncate" title={r.details || ""}>
                        {r.details || "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.ip_address || "—"}</TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && !loading && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No entries</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
