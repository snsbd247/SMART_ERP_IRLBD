/**
 * Treasury Information — standalone register.
 *
 * SAFETY GUARD: This page MUST NOT post to any accounting table
 * (acc_vouchers, voucher_entries, chart_of_accounts) or trigger any
 * journal/auto-post side-effects. It is a pure record-keeping list
 * isolated from the General Ledger. If you need accounting impact,
 * create a separate voucher via AccountingVouchers — do not extend
 * this file. CI guard: see grep below should always return empty.
 *   rg "acc_vouchers|voucher_entries|chart_of_accounts" this file
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatDateDMY, toDateInputValue } from "@/lib/date-format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search, Printer, Download, History, ShieldAlert } from "lucide-react";
import { logCreate, logUpdate, logDelete } from "@/lib/audit-utils";

type TreasuryType = "salary_tds" | "party_tds" | "vat";
type PartyKind = "employee" | "customer" | "supplier" | "none";

interface TreasuryRow {
  id: string;
  treasury_date: string;
  treasury_type: TreasuryType;
  party_kind: PartyKind | null;
  party_id: string | null;
  party_name_snapshot: string | null;
  challan_no: string | null;
  challan_date: string | null;
  bank_name: string | null;
  amount: number;
  period_month: string | null;
  mushak_ref: string | null;
  reference_no: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

interface PartyOpt { id: string; label: string; }

const TYPE_LABEL: Record<TreasuryType, string> = {
  salary_tds: "Salary TDS",
  party_tds: "Party Bill TDS",
  vat: "VAT Treasury",
};

const emptyForm = () => ({
  id: "" as string | "",
  treasury_date: toDateInputValue(new Date()),
  treasury_type: "salary_tds" as TreasuryType,
  party_kind: "employee" as PartyKind,
  party_id: "" as string,
  party_name_snapshot: "",
  challan_no: "",
  challan_date: "",
  bank_name: "",
  amount: 0,
  period_month: "",
  mushak_ref: "",
  reference_no: "",
  notes: "",
});

const PAGE_SIZE = 25;

export default function TreasuryInformationPage() {
  const { user, profile, hasPermission, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  // Treasury-specific permission keys keep this module isolated — granting
  // accounts.* does NOT grant treasury access (except for Super Admin).
  const canView = isSuperAdmin || hasPermission("treasury", "can_view");
  const canAdd = isSuperAdmin || hasPermission("treasury", "can_add");
  const canEdit = isSuperAdmin || hasPermission("treasury", "can_edit");
  const canDelete = isSuperAdmin || hasPermission("treasury", "can_delete");

  const [rows, setRows] = useState<TreasuryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<PartyOpt[]>([]);
  const [customers, setCustomers] = useState<PartyOpt[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOpt[]>([]);

  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TreasuryRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<TreasuryRow | null>(null);
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function openHistory(r: TreasuryRow) {
    setHistoryTarget(r);
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from("audit_log")
      .select("id, action, user_name, details, old_data, new_data, created_at")
      .eq("module", "treasury")
      .eq("record_id", r.id)
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Failed to load history", description: error.message, variant: "destructive" });
    setHistoryRows((data as any[]) || []);
    setHistoryLoading(false);
  }

  useEffect(() => { void load(); void loadParties(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("treasury_entries" as any)
      .select("*")
      .order("treasury_date", { ascending: false });
    if (error) {
      toast({ title: "Failed to load treasury entries", description: error.message, variant: "destructive" });
    } else {
      setRows(((data as unknown) as TreasuryRow[]) || []);
    }
    setLoading(false);
  }

  async function loadParties() {
    const [emp, cus, sup] = await Promise.all([
      supabase.from("employees").select("id, first_name, last_name, employee_code").order("first_name"),
      supabase.from("customers").select("id, name, code").order("name"),
      supabase.from("suppliers").select("id, name, code").order("name"),
    ]);
    setEmployees(((emp.data as any[]) || []).map((e) => ({
      id: e.id,
      label: `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() + (e.employee_code ? ` (${e.employee_code})` : ""),
    })));
    setCustomers(((cus.data as any[]) || []).map((c) => ({
      id: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name,
    })));
    setSuppliers(((sup.data as any[]) || []).map((s) => ({
      id: s.id, label: s.code ? `${s.code} — ${s.name}` : s.name,
    })));
  }

  const partyOptions = (kind: PartyKind): PartyOpt[] => {
    if (kind === "employee") return employees;
    if (kind === "customer") return customers;
    if (kind === "supplier") return suppliers;
    return [];
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterType !== "all" && r.treasury_type !== filterType) return false;
      if (fromDate && r.treasury_date < fromDate) return false;
      if (toDate && r.treasury_date > toDate) return false;
      if (term) {
        const hay = [
          r.challan_no, r.bank_name, r.party_name_snapshot, r.reference_no,
          r.mushak_ref, r.notes, r.period_month, TYPE_LABEL[r.treasury_type],
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, filterType, fromDate, toDate, search]);

  const totalAmount = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.amount || 0), 0),
    [filtered],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [filterType, search, fromDate, toDate]);

  function openAdd() {
    setForm(emptyForm());
    setOpen(true);
  }

  function openEdit(r: TreasuryRow) {
    setForm({
      id: r.id,
      treasury_date: toDateInputValue(r.treasury_date),
      treasury_type: r.treasury_type,
      party_kind: (r.party_kind as PartyKind) ?? (r.treasury_type === "vat" ? "none" : "employee"),
      party_id: r.party_id ?? "",
      party_name_snapshot: r.party_name_snapshot ?? "",
      challan_no: r.challan_no ?? "",
      challan_date: r.challan_date ? toDateInputValue(r.challan_date) : "",
      bank_name: r.bank_name ?? "",
      amount: Number(r.amount || 0),
      period_month: r.period_month ?? "",
      mushak_ref: r.mushak_ref ?? "",
      reference_no: r.reference_no ?? "",
      notes: r.notes ?? "",
    });
    setOpen(true);
  }

  function onTypeChange(t: TreasuryType) {
    const kind: PartyKind = t === "salary_tds" ? "employee" : t === "party_tds" ? "supplier" : "none";
    setForm((f) => ({ ...f, treasury_type: t, party_kind: kind, party_id: "" }));
  }

  async function save() {
    if (!form.treasury_date) {
      toast({ title: "Date required", variant: "destructive" }); return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      toast({ title: "Amount must be greater than 0", variant: "destructive" }); return;
    }
    if (form.treasury_type !== "vat" && !form.party_id) {
      toast({ title: "Please select a party", variant: "destructive" }); return;
    }

    const partyKind: PartyKind = form.treasury_type === "vat" ? "none" : form.party_kind;
    const snapshot = form.party_id
      ? partyOptions(partyKind).find((o) => o.id === form.party_id)?.label ?? form.party_name_snapshot
      : null;

    const payload: any = {
      treasury_date: form.treasury_date,
      treasury_type: form.treasury_type,
      party_kind: partyKind,
      party_id: form.party_id || null,
      party_name_snapshot: snapshot,
      challan_no: form.challan_no || null,
      challan_date: form.challan_date || null,
      bank_name: form.bank_name || null,
      amount: Number(form.amount),
      period_month: form.period_month || null,
      mushak_ref: form.mushak_ref || null,
      reference_no: form.reference_no || null,
      notes: form.notes || null,
    };

    setSaving(true);
    let error: any;
    let savedId = form.id;
    let prevRow: TreasuryRow | undefined;
    if (form.id) {
      if (!canEdit) { setSaving(false); toast({ title: "Permission denied", description: "treasury.can_edit required", variant: "destructive" }); return; }
      prevRow = rows.find((r) => r.id === form.id);
      ({ error } = await supabase.from("treasury_entries" as any).update(payload).eq("id", form.id));
    } else {
      if (!canAdd) { setSaving(false); toast({ title: "Permission denied", description: "treasury.can_add required", variant: "destructive" }); return; }
      payload.created_by = user?.id ?? null;
      payload.status = "active";
      const { data: inserted, error: insErr } = await supabase
        .from("treasury_entries" as any).insert(payload).select().single();
      error = insErr;
      savedId = (inserted as any)?.id ?? "";
    }
    setSaving(false);

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }

    // Audit trail (best-effort; failures must not block UX)
    try {
      const auditCtx = { userId: user?.id, userName: profile?.name || user?.email || undefined, module: "treasury" };
      if (form.id && prevRow) {
        await logUpdate({ ...auditCtx, recordId: form.id, oldData: prevRow as any, newData: payload });
      } else if (savedId) {
        await logCreate({ ...auditCtx, recordId: savedId, newData: payload });
      }
    } catch { /* ignore audit errors */ }

    toast({ title: form.id ? "Treasury entry updated" : "Treasury entry added" });
    setOpen(false);
    void load();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    if (!canDelete) { toast({ title: "Permission denied", description: "treasury.can_delete required", variant: "destructive" }); return; }
    const snapshot = deleteTarget;
    const { error } = await supabase.from("treasury_entries" as any).delete().eq("id", deleteTarget.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      try {
        await logDelete({
          userId: user?.id, userName: profile?.name || user?.email || undefined,
          module: "treasury", recordId: snapshot.id, oldData: snapshot as any,
          details: `Deleted ${TYPE_LABEL[snapshot.treasury_type]} entry of ${snapshot.amount}`,
        });
      } catch { /* ignore */ }
      toast({ title: "Treasury entry deleted" });
      setDeleteTarget(null);
      void load();
    }
  }

  function exportCsv() {
    const headers = ["Date", "Type", "Party", "Challan No", "Challan Date", "Bank", "Period", "Mushak Ref", "Reference", "Amount", "Notes"];
    const lines = [headers.join(",")];
    filtered.forEach((r) => {
      const row = [
        formatDateDMY(r.treasury_date),
        TYPE_LABEL[r.treasury_type],
        r.party_name_snapshot ?? "",
        r.challan_no ?? "",
        r.challan_date ? formatDateDMY(r.challan_date) : "",
        r.bank_name ?? "",
        r.period_month ?? "",
        r.mushak_ref ?? "",
        r.reference_no ?? "",
        Number(r.amount).toFixed(2),
        (r.notes ?? "").replace(/[\r\n,]+/g, " "),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(row.join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `treasury-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!canView) {
    return (
      <div className="p-6">
        <Card><CardContent className="py-12 text-center space-y-2">
          <ShieldAlert className="w-10 h-10 mx-auto text-muted-foreground" />
          <div className="font-semibold">Access denied</div>
          <p className="text-sm text-muted-foreground">You need <code>treasury.can_view</code> permission to view this page.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Treasury Information</h1>
          <p className="text-sm text-muted-foreground">
            Standalone treasury deposit records — not posted to accounting ledgers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="w-4 h-4 mr-1" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" /> Print</Button>
          {canAdd && (
            <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Entry</Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="md:col-span-2">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Challan, bank, party, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="salary_tds">Salary TDS</SelectItem>
                  <SelectItem value="party_tds">Party Bill TDS</SelectItem>
                  <SelectItem value="vat">VAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Challan</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : pageRows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No treasury entries found.</TableCell></TableRow>
                ) : pageRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDateDMY(r.treasury_date)}</TableCell>
                    <TableCell><Badge variant="secondary">{TYPE_LABEL[r.treasury_type]}</Badge></TableCell>
                    <TableCell>{r.party_name_snapshot ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {r.challan_no || "—"}
                      {r.challan_date && <div className="text-xs text-muted-foreground">{formatDateDMY(r.challan_date)}</div>}
                    </TableCell>
                    <TableCell>{r.bank_name ?? "—"}</TableCell>
                    <TableCell>{r.period_month ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openHistory(r)} title="History"><History className="w-4 h-4" /></Button>
                      {canEdit && (
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="Edit"><Pencil className="w-4 h-4" /></Button>
                      )}
                      {canDelete && (
                        <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(r)} title="Delete"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="text-muted-foreground">
              {filtered.length} entries · Total <span className="font-mono font-semibold text-foreground">
                {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>Page {page} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{form.id ? "Edit Treasury Entry" : "Add Treasury Entry"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Date *</Label>
              <Input type="date" value={form.treasury_date} onChange={(e) => setForm({ ...form, treasury_date: e.target.value })} />
            </div>
            <div>
              <Label>Treasury Type *</Label>
              <Select value={form.treasury_type} onValueChange={(v) => onTypeChange(v as TreasuryType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="salary_tds">Salary TDS</SelectItem>
                  <SelectItem value="party_tds">Party Bill TDS</SelectItem>
                  <SelectItem value="vat">VAT Treasury</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.treasury_type === "salary_tds" && (
              <div className="md:col-span-2">
                <Label>Employee *</Label>
                <Select value={form.party_id} onValueChange={(v) => setForm({ ...form, party_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.treasury_type === "party_tds" && (
              <>
                <div>
                  <Label>Party Type *</Label>
                  <Select value={form.party_kind} onValueChange={(v) => setForm({ ...form, party_kind: v as PartyKind, party_id: "" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supplier">Supplier</SelectItem>
                      <SelectItem value="customer">Customer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Party *</Label>
                  <Select value={form.party_id} onValueChange={(v) => setForm({ ...form, party_id: v })}>
                    <SelectTrigger><SelectValue placeholder={`Select ${form.party_kind}`} /></SelectTrigger>
                    <SelectContent>
                      {partyOptions(form.party_kind).map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {form.treasury_type === "vat" && (
              <div>
                <Label>Mushak Reference</Label>
                <Input value={form.mushak_ref} onChange={(e) => setForm({ ...form, mushak_ref: e.target.value })} placeholder="e.g. Mushak-9.1 / 2025-07" />
              </div>
            )}

            <div>
              <Label>Amount *</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Period (Month)</Label>
              <Input placeholder="YYYY-MM" value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} />
            </div>

            <div>
              <Label>Challan No</Label>
              <Input value={form.challan_no} onChange={(e) => setForm({ ...form, challan_no: e.target.value })} />
            </div>
            <div>
              <Label>Challan Date</Label>
              <Input type="date" value={form.challan_date} onChange={(e) => setForm({ ...form, challan_date: e.target.value })} />
            </div>

            <div>
              <Label>Bank Name</Label>
              <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
            </div>
            <div>
              <Label>Reference No</Label>
              <Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
            </div>

            <div className="md:col-span-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete treasury entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the record. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!historyTarget} onOpenChange={(o) => { if (!o) { setHistoryTarget(null); setHistoryRows([]); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Audit Trail — {historyTarget?.party_name_snapshot || (historyTarget ? TYPE_LABEL[historyTarget.treasury_type] : "")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {historyLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading history…</div>
            ) : historyRows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No history yet for this entry.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyRows.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap text-xs">{new Date(h.created_at).toLocaleString()}</TableCell>
                      <TableCell><Badge variant={h.action === "delete" ? "destructive" : "secondary"}>{h.action}</Badge></TableCell>
                      <TableCell className="text-xs">{h.user_name || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {h.details ? <div className="truncate max-w-md" title={h.details}>{h.details}</div> : null}
                        {h.new_data || h.old_data ? (
                          <pre className="mt-1 text-[10px] bg-muted p-1 rounded overflow-x-auto max-w-md">
{JSON.stringify(h.new_data ?? h.old_data, null, 2)}
                          </pre>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setHistoryTarget(null); setHistoryRows([]); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
