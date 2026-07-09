import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { voucherApi } from "@/lib/voucher-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDateDMY } from "@/lib/date-format";
import { useCurrency } from "@/contexts/CurrencyContext";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, RotateCcw, Trash2 } from "lucide-react";

const VOUCHER_TYPES = [
  { id: "journal", label: "Journal" },
  { id: "payment", label: "Payment" },
  { id: "receipt", label: "Receipt" },
  { id: "contra", label: "Contra" },
];

interface DeletedVoucher {
  id: string;
  voucher_number: string;
  voucher_type: string;
  voucher_date: string;
  description: string | null;
  total_amount: number;
  status: string;
  deleted_at?: string | null;
}

const DeletedVouchersPage = () => {
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const { fc } = useCurrency();

  const [rows, setRows] = useState<DeletedVoucher[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    try {
      const results = await Promise.all(
        VOUCHER_TYPES.map((t) =>
          voucherApi.list(t.id, true, { page: 1, per_page: 500 }).catch(() => ({ data: [] as any[] }))
        )
      );
      const merged: DeletedVoucher[] = [];
      results.forEach((r) => {
        (r.data || []).forEach((v: any) => {
          if (v?.deleted_at) merged.push(v as DeletedVoucher);
        });
      });
      merged.sort((a, b) => (b.deleted_at || "").localeCompare(a.deleted_at || ""));
      setRows(merged);
      setSelected(new Set());
    } catch (err: any) {
      toast({ title: "Failed to load deleted vouchers", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((v) => {
      if (typeFilter !== "all" && v.voucher_type !== typeFilter) return false;
      if (dateFrom && (v.voucher_date || "") < dateFrom) return false;
      if (dateTo && (v.voucher_date || "") > dateTo) return false;
      if (!q) return true;
      return (
        (v.voucher_number || "").toLowerCase().includes(q)
        || (v.description || "").toLowerCase().includes(q)
        || (v.voucher_type || "").toLowerCase().includes(q)
        || String(v.total_amount ?? "").includes(q)
      );
    });
  }, [rows, search, typeFilter, dateFrom, dateTo]);

  useEffect(() => { setPage(1); }, [search, typeFilter, dateFrom, dateTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  const allSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const someSelected = pageRows.some((r) => selected.has(r.id)) && !allSelected;
  const toggleAll = (checked: boolean) => {
    const next = new Set(selected);
    if (checked) pageRows.forEach((r) => next.add(r.id));
    else pageRows.forEach((r) => next.delete(r.id));
    setSelected(next);
  };
  const toggleRow = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    setSelected(next);
  };
  const clearSelection = () => setSelected(new Set());

  const runBulk = async (kind: "purge" | "restore") => {
    if (selected.size === 0) return;
    if (kind === "purge" && !reason.trim()) {
      toast({ title: "Reason required", description: "Please describe why these vouchers are being permanently deleted.", variant: "destructive" });
      return;
    }
    setBusy(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      try {
        if (kind === "purge") await voucherApi.purge(id, reason.trim() || undefined);
        else await voucherApi.restore(id, reason.trim() || undefined);
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    setPurgeOpen(false);
    setRestoreOpen(false);
    setReason("");
    toast({
      title: kind === "purge" ? "Permanent delete complete" : "Restore complete",
      description: `${ok} succeeded${fail ? `, ${fail} failed` : ""}.`,
      variant: fail ? "destructive" : "default",
    });
    fetchData();
  };

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader><CardTitle>Access denied</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Only a Super Admin can view or manage deleted vouchers.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/accounts/vouchers"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Link>
          </Button>
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-destructive" />
            <h1 className="text-xl font-semibold text-foreground">Deleted Vouchers (Trash)</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear ({selected.size})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={selected.size === 0 || busy}
            onClick={() => { setReason(""); setRestoreOpen(true); }}
          >
            <RotateCcw className="w-4 h-4 mr-1" /> Restore ({selected.size})
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={selected.size === 0 || busy}
            onClick={() => { setReason(""); setPurgeOpen(true); }}
          >
            <Trash2 className="w-4 h-4 mr-1" /> Delete permanently ({selected.size})
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm text-muted-foreground font-normal">
              {loading ? "Loading…" : `${filtered.length} deleted voucher${filtered.length === 1 ? "" : "s"}${selected.size ? ` · ${selected.size} selected` : ""}`}
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                placeholder="Search voucher #, description, amount…"
                className="w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {VOUCHER_TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" className="w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
              <Input type="date" className="w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(c) => toggleAll(Boolean(c))}
                      aria-label="Select all on page"
                    />
                  </TableHead>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Deleted at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                      {rows.length === 0 ? "Trash is empty." : "No vouchers match the current filters."}
                    </TableCell>
                  </TableRow>
                )}
                {pageRows.map((v) => (
                  <TableRow key={v.id} data-state={selected.has(v.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(v.id)}
                        onCheckedChange={(c) => toggleRow(v.id, Boolean(c))}
                        aria-label={`Select ${v.voucher_number}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{v.voucher_number}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{v.voucher_type}</Badge>
                    </TableCell>
                    <TableCell>{formatDateDMY(v.voucher_date)}</TableCell>
                    <TableCell className="max-w-[320px] truncate" title={v.description || ""}>
                      {v.description || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{fc(Number(v.total_amount) || 0)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {v.deleted_at ? formatDateDMY(v.deleted_at) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filtered.length > 0 && (
            <div className="flex items-center justify-end mt-4 gap-3 flex-wrap text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>Rows per page</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Permanently delete {selected.size} voucher{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the selected vouchers and their entries from the database. This action
              CANNOT be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason (required)</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are these being purged?" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !reason.trim()}
              onClick={(e) => { e.preventDefault(); runBulk("purge"); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {selected.size} voucher{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Selected vouchers will be moved back to their previous status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional note" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); runBulk("restore"); }}
            >
              {busy ? "Restoring…" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DeletedVouchersPage;
