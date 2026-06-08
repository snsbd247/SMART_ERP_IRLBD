import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";
import { Check, X, Loader2, UserCheck, Mail, Phone, Calendar } from "lucide-react";
import { format } from "date-fns";

interface PendingEmployee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string | null;
  mobile: string | null;
  national_id: string | null;
  address: string | null;
  joining_date: string;
  approval_status: string;
  created_at: string;
  department?: { name: string } | null;
  designation?: { name: string } | null;
  branch?: { name: string } | null;
}

export default function EmployeeApprovalsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<PendingEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<PendingEmployee | null>(null);
  const [reason, setReason] = useState("");

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/v1/employees/pending-approvals`, {
        headers: { Accept: "application/json", ...getLaravelAuthHeaders() },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
      const data = payload?.data ?? payload;
      setRows(Array.isArray(data) ? (data as PendingEmployee[]) : []);
    } catch (err: any) {
      toast({ title: "Failed to load", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const approve = async (emp: PendingEmployee) => {
    setActing(emp.id);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/v1/employees/${emp.id}/approve`, {
        method: "POST",
        headers: { Accept: "application/json", ...getLaravelAuthHeaders() },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
      toast({ title: "Approved", description: `${emp.first_name} ${emp.last_name} added to employee list.` });
      setRows(rows.filter(r => r.id !== emp.id));
    } catch (err: any) {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    } finally {
      setActing(null);
    }
  };

  const reject = async () => {
    if (!rejectFor) return;
    setActing(rejectFor.id);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/v1/employees/${rejectFor.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...getLaravelAuthHeaders() },
        body: JSON.stringify({ reason }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
      toast({ title: "Rejected", description: `Application from ${rejectFor.first_name} ${rejectFor.last_name} rejected.` });
      setRows(rows.filter(r => r.id !== rejectFor.id));
      setRejectFor(null);
      setReason("");
    } catch (err: any) {
      toast({ title: "Rejection failed", description: err.message, variant: "destructive" });
    } finally {
      setActing(null);
    }
  };

  const filtered = rows.filter(r => {
    const q = search.toLowerCase();
    return !q || `${r.first_name} ${r.last_name} ${r.employee_code} ${r.email ?? ""} ${r.mobile ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="w-5 h-5" /> Employee Approvals
                {rows.length > 0 && <Badge variant="secondary">{rows.length} pending</Badge>}
              </CardTitle>
              <CardDescription>Review public registration applications. Approved entries appear in the Employees list.</CardDescription>
            </div>
            <Input
              placeholder="Search name, code, email, mobile…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-72"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <UserCheck className="w-10 h-10 mx-auto mb-2 opacity-40" />
              No pending approvals.
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Department / Designation</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Joining</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.employee_code}</TableCell>
                      <TableCell className="font-medium">{r.first_name} {r.last_name}</TableCell>
                      <TableCell className="text-xs space-y-0.5">
                        {r.email && <div className="flex items-center gap-1"><Mail className="w-3 h-3" />{r.email}</div>}
                        {r.mobile && <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{r.mobile}</div>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{r.department?.name || "—"}</div>
                        <div className="text-muted-foreground text-xs">{r.designation?.name || "—"}</div>
                      </TableCell>
                      <TableCell>{r.branch?.name || "—"}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1"><Calendar className="w-3 h-3" />{r.joining_date}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.created_at ? format(new Date(r.created_at), "dd MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          onClick={() => approve(r)}
                          disabled={acting === r.id}
                        >
                          {acting === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => { setRejectFor(r); setReason(""); }}
                          disabled={acting === r.id}
                        >
                          <X className="w-3.5 h-3.5 mr-1" /> Reject
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejectFor} onOpenChange={o => { if (!o) setRejectFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Application</DialogTitle>
            <DialogDescription>
              {rejectFor && <>Reject application from <strong>{rejectFor.first_name} {rejectFor.last_name}</strong>?</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Incomplete information" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>Cancel</Button>
            <Button variant="destructive" onClick={reject} disabled={acting === rejectFor?.id}>
              {acting === rejectFor?.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <X className="w-4 h-4 mr-2" />}
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
