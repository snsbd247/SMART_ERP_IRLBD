import { useEffect, useState } from "react";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePermission } from "@/hooks/usePermission";
import { Check, X, FileCheck2, Clock, History } from "lucide-react";
import { formatDateDMY } from "@/lib/date-format";

type Voucher = {
  id: string;
  voucher_number: string;
  voucher_type: string;
  voucher_date: string;
  total_amount: number;
  status: string;
  description?: string | null;
};

type HistoryRow = {
  id: string;
  action: string;
  before_status: string | null;
  after_status: string | null;
  note: string | null;
  actor_name: string | null;
  created_at: string;
};

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const base = (getApiBaseUrl() || "").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/${path.replace(/^\//, "")}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...getLaravelAuthHeaders(),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
  return json as T;
}

export default function VoucherApprovalDashboard() {
  const { can, isSuperAdmin } = usePermission();
  const { toast } = useToast();
  const canAct = isSuperAdmin || can("accounts.edit");

  const [rows, setRows] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<{ v: Voucher; mode: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ v: Voucher; rows: HistoryRow[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const j = await api<any>("vouchers/pending");
      const list = Array.isArray(j) ? j : j?.data?.data ?? j?.data ?? [];
      setRows(list);
    } catch (e: any) {
      toast({ title: "Failed to load", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api(`vouchers/${target.v.id}/${target.mode}`, {
        method: "POST",
        body: JSON.stringify({ note: note || null }),
      });
      toast({ title: `Voucher ${target.mode === "approve" ? "approved" : "rejected"}` });
      setTarget(null); setNote("");
      load();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const showHistory = async (v: Voucher) => {
    try {
      const j = await api<any>(`vouchers/${v.id}/approval-history`);
      setHistory({ v, rows: (Array.isArray(j) ? j : j?.data ?? []) as HistoryRow[] });
    } catch (e: any) {
      toast({ title: "Failed to load history", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5" /> Voucher Approval Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading pending vouchers…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" /> No vouchers pending approval.
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono">{v.voucher_number}</TableCell>
                      <TableCell><Badge variant="outline">{v.voucher_type}</Badge></TableCell>
                      <TableCell>{formatDateDMY(v.voucher_date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(v.total_amount).toLocaleString()}</TableCell>
                      <TableCell className="max-w-xs truncate">{v.description}</TableCell>
                      <TableCell><Badge>{v.status}</Badge></TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => showHistory(v)} title="History">
                          <History className="h-4 w-4" />
                        </Button>
                        <Button size="sm" disabled={!canAct} onClick={() => { setTarget({ v, mode: "approve" }); setNote(""); }}>
                          <Check className="h-4 w-4 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" disabled={!canAct}
                          onClick={() => { setTarget({ v, mode: "reject" }); setNote(""); }}>
                          <X className="h-4 w-4 mr-1" /> Reject
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!canAct && (
            <p className="text-xs text-muted-foreground mt-3">
              You can view this dashboard, but only Super Admin or users with{" "}
              <code>accounts.edit</code> can approve or reject.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Approve/Reject dialog */}
      <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setTarget(null); setNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target?.mode === "approve" ? "Approve" : "Reject"} {target?.v.voucher_number}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
            <Button
              variant={target?.mode === "reject" ? "destructive" : "default"}
              onClick={submit}
              disabled={busy}
            >
              {busy ? "Working…" : target?.mode === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={!!history} onOpenChange={(o) => { if (!o) setHistory(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Approval History — {history?.v.voucher_number}</DialogTitle>
          </DialogHeader>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history?.rows ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell>{r.actor_name ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{r.action}</Badge></TableCell>
                    <TableCell>{r.before_status} → {r.after_status}</TableCell>
                    <TableCell className="max-w-sm truncate">{r.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {(history?.rows.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      No history yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
