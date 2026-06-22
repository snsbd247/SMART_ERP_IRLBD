import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { voucherApi } from "@/lib/voucher-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountCombobox } from "@/components/accounts/AccountCombobox";
import { useAccountBalances } from "@/hooks/useAccountBalances";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Check, X, FileText, Trash2, RotateCcw, Pencil, ArrowLeftRight, Lock, Printer, Eye, PlusCircle, History } from "lucide-react";
import { AuditLogViewer } from "@/components/AuditLogViewer";
import { useCurrency } from "@/contexts/CurrencyContext";
import { PrintLayout } from "@/components/PrintLayout";

const formatDateDMY = (d?: string | null) => {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};


const VOUCHER_TYPES = [
  { id: "journal", label: "Journal Voucher", prefix: "JV" },
  { id: "payment", label: "Payment Voucher", prefix: "PV" },
  { id: "receipt", label: "Receipt Voucher", prefix: "RV" },
  { id: "contra", label: "Contra Voucher", prefix: "CV" },
];

interface Account { id: string; account_name: string; account_code: string; }
interface Branch { id: string; name: string; }
interface FinYear { id: string; name: string; }
interface EntryRow { id: string; account_id: string; dr_cr: "dr" | "cr"; debit: number; credit: number; narration: string; }
interface Voucher {
  id: string; voucher_number: string; voucher_type: string; voucher_date: string;
  branch_id: string | null; financial_year_id: string | null; description: string | null;
  total_amount: number; status: string; created_at: string;
  ledger_accounts?: string[];
}

type SuperAdminAction = "delete" | "reopen" | "reverse" | "restore" | "purge" | null;

const AccountingVouchers = () => {
  const { isSuperAdmin, hasPermission } = useAuth();
  const { toast } = useToast();
  const { fc } = useCurrency();

  // Per-voucher-type permission checks
  const canViewJournal = isSuperAdmin || hasPermission("journal.view");
  const canViewPayment = isSuperAdmin || hasPermission("payment.view");
  const canViewReceipt = isSuperAdmin || hasPermission("receipt.view");
  const canViewContra = isSuperAdmin || hasPermission("contra.view");

  const voucherPermMap: Record<string, boolean> = {
    journal: canViewJournal,
    payment: canViewPayment,
    receipt: canViewReceipt,
    contra: canViewContra,
  };

  const canCreateForType = (type: string) =>
    isSuperAdmin || hasPermission(`${type}.create`);
  const canEditForType = (type: string) =>
    isSuperAdmin || hasPermission(`${type}.edit`);
  const canDeleteForType = (type: string) =>
    isSuperAdmin || hasPermission(`${type}.delete`);

  const allowedTypes = VOUCHER_TYPES.filter((vt) => voucherPermMap[vt.id]);
  const defaultTab = allowedTypes.length > 0 ? allowedTypes[0].id : "journal";
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [finYears, setFinYears] = useState<FinYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<Voucher | null>(null);

  // View dialog state
  const [viewVoucher, setViewVoucher] = useState<Voucher | null>(null);
  const [viewEntries, setViewEntries] = useState<any[]>([]);

  // Form state
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formBranch, setFormBranch] = useState("");
  const [formFinYear, setFormFinYear] = useState("");
  const [formDesc, setFormDesc] = useState("");
  // True until the user manually edits the voucher description. While true,
  // the description is auto-derived from entry narrations as "dr | cr".
  const [descAuto, setDescAuto] = useState(true);

  // Build "dr narrations | cr narrations" from current entries.
  const buildAutoDesc = (rows: EntryRow[]) => {
    const dr = rows.filter((e) => e.dr_cr === "dr" && e.narration.trim()).map((e) => e.narration.trim());
    const cr = rows.filter((e) => e.dr_cr === "cr" && e.narration.trim()).map((e) => e.narration.trim());
    if (!dr.length && !cr.length) return "";
    return `${dr.join(", ")} | ${cr.join(", ")}`;
  };
  const [entries, setEntries] = useState<EntryRow[]>([
    { id: "1", account_id: "", dr_cr: "dr", debit: 0, credit: 0, narration: "" },
    { id: "2", account_id: "", dr_cr: "cr", debit: 0, credit: 0, narration: "" },
  ]);
  // Raw text for formula-style input (e.g. "=20+50+80+100"). Keyed by `${entryId}-${field}`.
  const [rawAmounts, setRawAmounts] = useState<Record<string, string>>({});

  // Print state
  const [printVoucher, setPrintVoucher] = useState<Voucher | null>(null);
  const [printEntries, setPrintEntries] = useState<any[]>([]);

  // Super admin action state
  const [superAdminAction, setSuperAdminAction] = useState<SuperAdminAction>(null);
  const [actionVoucher, setActionVoucher] = useState<Voucher | null>(null);
  const [actionReason, setActionReason] = useState("");

  const [voucherAccountsMap, setVoucherAccountsMap] = useState<Record<string, string[]>>({});
  const [showDeleted, setShowDeleted] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditRecordId, setAuditRecordId] = useState<string | undefined>(undefined);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [vRes, aRes, bRes, fRes] = await Promise.all([
        voucherApi.list(activeTab, showDeleted),
        voucherApi.listAccounts(),
        voucherApi.listBranches(),
        voucherApi.listFinancialYears(),
      ]);
      const vList = (vRes.data || []) as Voucher[];
      setVouchers(vList);
      setAccounts((aRes.data || []) as Account[]);
      setBranches((bRes.data || []) as Branch[]);
      setFinYears((fRes.data || []) as FinYear[]);

      const ledgerMap = vList.reduce<Record<string, string[]>>((map, voucher) => {
        map[voucher.id] = Array.isArray(voucher.ledger_accounts) ? voucher.ledger_accounts : [];
        return map;
      }, {});
      setVoucherAccountsMap(ledgerMap);
    } catch (err: any) {
      setVouchers([]);
      setVoucherAccountsMap({});
      toast({ title: "Error loading vouchers", description: err?.message || "Unable to load accounting vouchers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [activeTab, showDeleted, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const { accounts: accountsWithBal } = useAccountBalances();
  const balanceMap = new Map(accountsWithBal.map((a) => [a.id, { amt: a.closing_balance, type: a.closing_balance_type }]));

  const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0);
  const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0);
  const isBalanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  const addEntry = () => {
    setEntries((prev) => [...prev, { id: String(Date.now()), account_id: "", dr_cr: "cr", debit: 0, credit: 0, narration: "" }]);
  };

  const resetNewVoucherEntries = () => {
    const idBase = Date.now();
    setEditingVoucher(null);
    setFormDesc(""); setDescAuto(true);
    setRawAmounts({});
    // NOTE: intentionally keep formDate, formBranch, formFinYear so the user
    // can quickly enter the next voucher without re-selecting them.
    setEntries([
      { id: `${idBase}-1`, account_id: "", dr_cr: "dr", debit: 0, credit: 0, narration: "" },
      { id: `${idBase}-2`, account_id: "", dr_cr: "cr", debit: 0, credit: 0, narration: "" },
    ]);
    setDialogOpen(true);
  };

  const removeEntry = (id: string) => {
    if (entries.length <= 2) return;
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const applyFormulaToEntry = (entry: EntryRow, val: number) => {
    const field: "debit" | "credit" = entry.dr_cr === "dr" ? "debit" : "credit";
    const oppField: "debit" | "credit" = field === "debit" ? "credit" : "debit";
    const oppDrCr: "dr" | "cr" = entry.dr_cr === "dr" ? "cr" : "dr";
    setEntries((prev) => {
      // find a counter-row to auto-fill (opposite dr/cr with empty amount)
      const counter = prev.find((r) => r.id !== entry.id && r.dr_cr === oppDrCr && !r[oppField]);
      const updates: Record<string, number> = {};
      const next = prev.map((r) => {
        if (r.id === entry.id) { updates[`${r.id}-${field}`] = val; return { ...r, [field]: val }; }
        if (counter && r.id === counter.id) { updates[`${r.id}-${oppField}`] = val; return { ...r, [oppField]: val }; }
        return r;
      });
      setRawAmounts((p) => {
        const np = { ...p };
        for (const k in updates) np[k] = String(updates[k]);
        return np;
      });
      return next;
    });
  };

  const updateEntry = (id: string, field: keyof EntryRow, value: any) => {
    setEntries((prev) => {
      const next = prev.map((e) => {
        if (e.id !== id) return e;
        const n: EntryRow = { ...e, [field]: value };
        if (field === "dr_cr") {
          if (value === "dr") n.credit = 0;
          else n.debit = 0;
        }
        return n;
      });
      if ((field === "narration" || field === "dr_cr") && descAuto) {
        setFormDesc(buildAutoDesc(next));
      }
      return next;
    });
  };

  // ── Formula-style amount input helpers ──
  // Accepts "=20+50+80+100", bare numbers, or Bengali digits. Returns NaN on invalid.
  const evalFormula = (raw: string): number => {
    if (raw === undefined || raw === null) return 0;
    const bnMap = "০১২৩৪৫৬৭৮৯";
    let t = String(raw).replace(/[০-৯]/g, (d) => String(bnMap.indexOf(d))).trim();
    if (!t) return 0;
    if (t.startsWith("=")) t = t.slice(1).trim();
    if (!t) return 0;
    if (!/^[\d+\-*/().\s]+$/.test(t)) return NaN;
    try {
      // eslint-disable-next-line no-new-func
      const v = Function(`"use strict"; return (${t})`)();
      return typeof v === "number" && isFinite(v) ? v : NaN;
    } catch { return NaN; }
  };

  const commitAmount = (entryId: string, field: "debit" | "credit") => {
    const key = `${entryId}-${field}`;
    const raw = rawAmounts[key];
    if (raw === undefined) return;
    const val = evalFormula(raw);
    if (!isFinite(val) || isNaN(val)) {
      toast({ title: "Invalid formula", description: "Use numbers and + - * / only, e.g. =20+50+80", variant: "destructive" });
      return;
    }
    // Update source value + mirror to single empty opposite row (if any)
    const oppField: "debit" | "credit" = field === "debit" ? "credit" : "debit";
    const oppDrCr = field === "debit" ? "cr" : "dr";
    setEntries((prev) => {
      const updated = prev.map((e) => e.id === entryId ? { ...e, [field]: val } : e);
      const sourceTotal = updated.filter((e) => e.dr_cr === (field === "debit" ? "dr" : "cr")).reduce((s, e) => s + (Number(e[field]) || 0), 0);
      const oppRows = updated.filter((e) => e.dr_cr === oppDrCr);
      const oppTotal = oppRows.reduce((s, e) => s + (Number(e[oppField]) || 0), 0);
      // Mirror only when opposite side has exactly one row and it's empty/zero
      if (oppRows.length === 1 && oppTotal === 0) {
        return updated.map((e) => e.dr_cr === oppDrCr ? { ...e, [oppField]: sourceTotal } : e);
      }
      return updated;
    });
    setRawAmounts((p) => { const n = { ...p }; delete n[key]; return n; });
  };

  const openCreate = () => {
    setEditingVoucher(null);
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormBranch(""); setFormFinYear(""); setFormDesc(""); setDescAuto(true);
    setEntries([
      { id: "1", account_id: "", dr_cr: "dr", debit: 0, credit: 0, narration: "" },
      { id: "2", account_id: "", dr_cr: "cr", debit: 0, credit: 0, narration: "" },
    ]);
    setDialogOpen(true);
  };

  const openView = async (v: Voucher) => {
    const { entries: data } = await voucherApi.get(v.id);
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    setViewEntries((data || []).map((e: any) => {
      const account = e.account || e.chart_of_accounts || accountMap.get(e.account_id);
      return { ...e, account_name: account?.account_name || "—", account_code: account?.account_code || "" };
    }));
    setViewVoucher(v);
  };

  const openEdit = async (v: Voucher) => {
    const { entries: data } = await voucherApi.get(v.id);
    setEditingVoucher(v);
    setFormDate(v.voucher_date);
    setFormBranch(v.branch_id || "");
    setFormFinYear(v.financial_year_id || "");
    setFormDesc(v.description || ""); setDescAuto(false);
    setEntries((data || []).map((e: any) => ({
      id: e.id,
      account_id: e.account_id,
      dr_cr: (Number(e.debit) > 0 ? "dr" : "cr") as "dr" | "cr",
      debit: Number(e.debit),
      credit: Number(e.credit),
      narration: e.narration || "",
    })));
    setDialogOpen(true);
  };

  const canEditVoucher = (v: Voucher) => {
    if (v.status === "draft" || v.status === "rejected") return canEditForType(activeTab);
    if (v.status === "approved") return isSuperAdmin;
    return false;
  };

  const canDeleteVoucher = (v: Voucher) => {
    // Super Admin can permanently delete a voucher in ANY status.
    if (isSuperAdmin) return true;
    if (v.status === "draft" || v.status === "rejected") return canDeleteForType(activeTab);
    return false;
  };

  const handleSave = async (submitForApproval: boolean, resetForNew: boolean = false) => {
    if (!isBalanced) {
      toast({ title: "Debit and Credit must be equal", variant: "destructive" });
      return;
    }
    const validEntries = entries.filter((e) => e.account_id && (e.debit > 0 || e.credit > 0));
    if (validEntries.length < 2) {
      toast({ title: "At least 2 entries required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editingVoucher) {
        // Editing existing voucher
        if (editingVoucher.status === "approved" && isSuperAdmin) {
          await voucherApi.editApproved({
            id: editingVoucher.id,
            description: formDesc,
            entries: validEntries.map((e) => ({
              account_id: e.account_id,
              debit: e.debit,
              credit: e.credit,
              narration: e.narration,
            })),
          });
          toast({ title: "Approved voucher updated (Super Admin override)" });
        } else {
          await voucherApi.update({
            id: editingVoucher.id,
            voucher_date: formDate,
            branch_id: formBranch || null,
            financial_year_id: formFinYear || null,
            description: formDesc,
            entries: validEntries.map((e) => ({
              account_id: e.account_id,
              debit: e.debit,
              credit: e.credit,
              narration: e.narration,
            })),
            submit: submitForApproval,
          });
          toast({ title: "Voucher updated successfully" });
        }
      } else {
        await voucherApi.create({
          voucher_type: activeTab,
          voucher_date: formDate,
          branch_id: formBranch || undefined,
          financial_year_id: formFinYear || undefined,
          description: formDesc,
          entries: validEntries.map((e) => ({
            account_id: e.account_id,
            debit: e.debit,
            credit: e.credit,
            narration: e.narration,
          })),
          submit: submitForApproval,
        });
        toast({ title: "Voucher created successfully" });
      }
      if (resetForNew) {
        resetNewVoucherEntries();
      } else {
        setDialogOpen(false);
        setEditingVoucher(null);
      }
      fetchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (v: Voucher) => {
    try {
      await voucherApi.approve(v.id);
      toast({ title: "Voucher approved" });
      fetchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleReject = async (v: Voucher) => {
    try {
      await voucherApi.reject(v.id);
      toast({ title: "Voucher rejected" });
      fetchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const openSuperAdminAction = (action: SuperAdminAction, voucher: Voucher) => {
    setSuperAdminAction(action);
    setActionVoucher(voucher);
    setActionReason("");
  };

  const handleSuperAdminAction = async () => {
    if (!actionVoucher || !superAdminAction) return;
    try {
      switch (superAdminAction) {
        case "delete":
          await voucherApi.deleteApproved(actionVoucher.id, actionReason);
          toast({ title: "Voucher moved to trash", description: "Super Admin can restore it from the deleted list." });
          break;
        case "restore":
          await voucherApi.restore(actionVoucher.id, actionReason);
          toast({ title: "Voucher restored" });
          break;
        case "reopen":
          await voucherApi.reopen(actionVoucher.id, actionReason);
          toast({ title: "Voucher reopened for correction" });
          break;
        case "reverse":
          await voucherApi.reverse(actionVoucher.id, actionReason);
          toast({ title: "Reversal voucher created" });
          break;
        case "purge":
          await voucherApi.purge(actionVoucher.id, actionReason);
          toast({ title: "Voucher permanently deleted" });
          break;
      }
      setSuperAdminAction(null);
      setActionVoucher(null);
      fetchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const openPrintVoucher = async (v: Voucher) => {
    const { entries: data } = await voucherApi.get(v.id);
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    setPrintEntries((data || []).map((e: any) => {
      const account = e.account || e.chart_of_accounts || accountMap.get(e.account_id);
      return { ...e, account_name: account?.account_name || "—", account_code: account?.account_code || "" };
    }));
    setPrintVoucher(v);
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      draft: "outline", pending: "secondary", approved: "default", rejected: "destructive",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  const actionLabels: Record<string, { title: string; desc: string; confirm: string }> = {
    delete: { title: "Delete Voucher", desc: "This will move the voucher to the trash. It will no longer appear in reports or ledgers. Only a Super Admin can restore it later. This action is logged.", confirm: "Move to Trash" },
    restore: { title: "Restore Voucher", desc: "This will restore the voucher to its previous status and make it visible in reports again. This action is logged.", confirm: "Restore Voucher" },
    reopen: { title: "Reopen Voucher", desc: "This will change the voucher status back to draft, allowing it to be edited and re-submitted. This action will be logged.", confirm: "Reopen Voucher" },
    reverse: { title: "Reverse Voucher", desc: "This will create a new reversal voucher with swapped debit/credit entries to offset the original transaction. Both vouchers will remain in the system.", confirm: "Create Reversal" },
    purge: { title: "Permanently Delete Voucher", desc: "This will PERMANENTLY delete the voucher and all its entries from the database. This action CANNOT be undone. Only proceed if you are absolutely sure.", confirm: "Delete Permanently" },
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Accounting Vouchers</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setAuditRecordId(undefined); setAuditOpen(true); }}
            title="View voucher audit log"
          >
            <History className="w-4 h-4 mr-1" />
            Audit Log
          </Button>
          {isSuperAdmin && (
            <Button
              variant={showDeleted ? "default" : "outline"}
              size="sm"
              onClick={() => setShowDeleted((v) => !v)}
              title="Show soft-deleted vouchers"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              {showDeleted ? "Showing Trash" : "Show Deleted"}
            </Button>
          )}
          {canCreateForType(activeTab) && (
            <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1" />New Voucher</Button>
          )}
        </div>
      </div>

      {!dialogOpen && (allowedTypes.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">You do not have permission to view any voucher types.</div>
      ) : (
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {allowedTypes.map((vt) => (
            <TabsTrigger key={vt.id} value={vt.id}>{vt.label}</TabsTrigger>
          ))}
        </TabsList>

        {VOUCHER_TYPES.map((vt) => {
          const q = searchQuery.trim().toLowerCase();
          const filteredVouchers = q
            ? vouchers.filter((v) =>
                [v.voucher_number, v.voucher_date, v.description || "", v.status, String(v.total_amount), (voucherAccountsMap[v.id] || []).join(" ")]
                  .some((f) => f.toLowerCase().includes(q))
              )
            : vouchers;
          return (
          <TabsContent key={vt.id} value={vt.id}>
            <div className="mb-3">
              <Input
                placeholder="Search by voucher #, date, description, status, or amount..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm h-9"
              />
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Voucher #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Ledger / Accounts</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-56">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
                    ) : filteredVouchers.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{q ? "No vouchers match your search" : "No vouchers yet"}</TableCell></TableRow>
                    ) : filteredVouchers.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-geist-mono text-xs font-medium">{v.voucher_number}</TableCell>
                        <TableCell className="text-sm">{formatDateDMY(v.voucher_date)}</TableCell>
                        <TableCell className="text-sm">{(voucherAccountsMap[v.id] || []).length > 0 ? (voucherAccountsMap[v.id] || []).join(", ") : <span className="text-muted-foreground italic">No ledger entries</span>}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{v.description || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{fc(v.total_amount)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {statusBadge(v.status)}
                            {v.status === "approved" && <Lock className="w-3 h-3 text-muted-foreground" />}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {/* View - always visible */}
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="View voucher" onClick={() => openView(v)} title="View">
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            {/* Edit - based on role & status */}
                            {canEditVoucher(v) && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit voucher" onClick={() => openEdit(v)} title="Edit">
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {/* Print - always visible */}
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Print voucher" onClick={() => openPrintVoucher(v)} title="Print">
                              <Printer className="w-3.5 h-3.5" />
                            </Button>
                            {/* Reverse - approved vouchers, super admin or admin */}
                            {v.status === "approved" && isSuperAdmin && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Reverse voucher" onClick={() => openSuperAdminAction("reverse", v)} title="Reverse">
                                <ArrowLeftRight className="w-3.5 h-3.5 text-primary" />
                              </Button>
                            )}
                            {/* History */}
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="View history" onClick={() => { setAuditRecordId(v.id); setAuditOpen(true); }} title="View history">
                              <History className="w-3.5 h-3.5 text-muted-foreground" />
                            </Button>
                            {/* Restore - super admin only, deleted vouchers */}
                            {isSuperAdmin && (v as any).deleted_at && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Restore voucher" onClick={() => openSuperAdminAction("restore", v)} title="Restore">
                                <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                              </Button>
                            )}
                            {/* Permanent delete - super admin only, deleted vouchers */}
                            {isSuperAdmin && (v as any).deleted_at && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Permanently delete voucher" onClick={() => openSuperAdminAction("purge", v)} title="Delete permanently">
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            )}
                            {/* Delete - based on role & status, not for already-deleted */}
                            {canDeleteVoucher(v) && !(v as any).deleted_at && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete voucher" onClick={() => openSuperAdminAction("delete", v)} title="Delete">
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            )}
                            {/* Admin: Approve/Reject pending */}
                            {v.status === "pending" && canEditForType(activeTab) && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Approve voucher" onClick={() => handleApprove(v)} title="Approve">
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Reject voucher" onClick={() => handleReject(v)} title="Reject">
                                  <X className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          );
        })}
      </Tabs>
      ))}

      {/* Create/Edit Voucher Page */}
      {dialogOpen && (
      <Card className="border-primary/20">
        <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {editingVoucher ? `Edit ${VOUCHER_TYPES.find((v) => v.id === editingVoucher.voucher_type)?.label || "Voucher"} — ${editingVoucher.voucher_number}` : `New ${VOUCHER_TYPES.find((v) => v.id === activeTab)?.label}`}
            {editingVoucher?.status === "approved" && isSuperAdmin && <Badge variant="outline" className="ml-2 text-xs">Super Admin Override</Badge>}
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setDialogOpen(false); setEditingVoucher(null); }}>
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-4">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={formBranch} onValueChange={setFormBranch}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Financial Year</Label>
                <Select value={formFinYear} onValueChange={setFormFinYear}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {finYears.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Entry Grid */}
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Voucher Entries</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-sky-100/70 dark:bg-sky-950/30">
                      <TableHead className="w-[100px] text-center font-semibold">Dr./Cr.</TableHead>
                      <TableHead className="font-semibold">
                        <div className="flex items-center justify-center gap-2">
                          <span>Particulars</span>
                          <button type="button" onClick={addEntry} className="text-primary hover:opacity-80" title="Add entry">
                            <PlusCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </TableHead>
                      <TableHead className="w-[15%] text-center font-semibold">Debit</TableHead>
                      <TableHead className="w-[15%] text-center font-semibold">Credit</TableHead>
                      <TableHead className="w-[18%] text-center font-semibold">Narration</TableHead>
                      <TableHead className="w-[90px] text-center font-semibold">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry, idx) => {
                      const bal = entry.account_id ? balanceMap.get(entry.account_id) : undefined;
                      const isLast = idx === entries.length - 1;
                      return (
                        <TableRow key={entry.id} className="align-top">
                          <TableCell className="pt-3">
                            <Select value={entry.dr_cr} onValueChange={(v) => updateEntry(entry.id, "dr_cr", v)}>
                              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="dr">Dr</SelectItem>
                                <SelectItem value="cr">Cr</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="pt-3">
                            <AccountCombobox
                              accounts={accounts}
                              value={entry.account_id}
                              onChange={(v) => updateEntry(entry.id, "account_id", v)}
                            />
                            <div className="mt-1 text-xs text-muted-foreground">
                              Curr Bal : {bal ? `${fc(bal.amt)} ${bal.type === "debit" ? "Dr" : "Cr"}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="pt-3">
                            <Input
                              type="text" inputMode="decimal"
                              className="h-9 text-right tabular-nums"
                              placeholder="0 or =20+50"
                              value={rawAmounts[`${entry.id}-debit`] ?? (entry.debit ? String(entry.debit) : "")}
                              disabled={entry.dr_cr !== "dr"}
                              onChange={(e) => setRawAmounts((p) => ({ ...p, [`${entry.id}-debit`]: e.target.value }))}
                              onBlur={() => commitAmount(entry.id, "debit")}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
                            />
                          </TableCell>
                          <TableCell className="pt-3">
                            <Input
                              type="text" inputMode="decimal"
                              className="h-9 text-right tabular-nums"
                              placeholder="0 or =20+50"
                              value={rawAmounts[`${entry.id}-credit`] ?? (entry.credit ? String(entry.credit) : "")}
                              disabled={entry.dr_cr !== "cr"}
                              onChange={(e) => setRawAmounts((p) => ({ ...p, [`${entry.id}-credit`]: e.target.value }))}
                              onBlur={() => commitAmount(entry.id, "credit")}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
                            />
                          </TableCell>
                          <TableCell className="pt-3">
                            <Input className="h-9 text-xs" placeholder="Narration (optional, =50+60+80 auto-sums)" value={entry.narration}
                              onChange={(e) => updateEntry(entry.id, "narration", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== "Tab") return;
                                const txt = (e.currentTarget as HTMLInputElement).value.trim();
                                if (!txt.startsWith("=")) return;
                                const val = evalFormula(txt);
                                if (!isFinite(val) || isNaN(val) || val <= 0) return;
                                if (e.key === "Enter") e.preventDefault();
                                applyFormulaToEntry(entry, val);
                              }}
                              onBlur={(e) => {
                                const txt = e.target.value.trim();
                                if (!txt.startsWith("=")) return;
                                const val = evalFormula(txt);
                                if (!isFinite(val) || isNaN(val) || val <= 0) return;
                                applyFormulaToEntry(entry, val);
                              }} />
                          </TableCell>
                          <TableCell className="pt-3">
                            <div className="flex items-center justify-center gap-1">
                              {isLast && (
                                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Add row" onClick={addEntry} title="Add row">
                                  <Plus className="w-4 h-4 text-primary" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete row" onClick={() => removeEntry(entry.id)} disabled={entries.length <= 2} title="Delete">
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-emerald-100/70 dark:bg-emerald-950/30 font-semibold">
                      <TableCell />
                      <TableCell className="text-right">
                        Total :
                        {!isBalanced && totalDebit > 0 && (
                          <span className="ml-3 text-xs text-destructive font-normal">Diff: {Math.abs(totalDebit - totalCredit).toLocaleString()}</span>
                        )}
                        {isBalanced && <span className="ml-3 text-xs text-emerald-700 font-normal">✓ Balanced</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{totalDebit.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{totalCredit.toLocaleString()}</TableCell>
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={formDesc} onChange={(e) => { setFormDesc(e.target.value); setDescAuto(false); }} placeholder="Voucher narration (auto: dr | cr)" />
            </div>
            
            
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingVoucher(null); }}>Cancel</Button>
            {editingVoucher?.status === "approved" ? (
              <Button onClick={() => handleSave(false)} disabled={saving || !isBalanced}>Save Changes</Button>
            ) : (
              <>
                <Button variant="outline" className="border-amber-500 bg-amber-100 text-amber-900 hover:bg-amber-200 hover:text-amber-900 dark:bg-amber-500/20 dark:text-amber-100 dark:border-amber-400/60 dark:hover:bg-amber-500/30" onClick={() => handleSave(false)} disabled={saving || !isBalanced}>Save as Draft</Button>
                <Button onClick={() => handleSave(true)} disabled={saving || !isBalanced}>Submit for Approval</Button>
                <Button variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleSave(true, true)} disabled={saving || !isBalanced}>Submit &amp; New</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {/* Super Admin Confirmation Dialog */}
      <AlertDialog open={!!superAdminAction} onOpenChange={() => setSuperAdminAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {superAdminAction && actionLabels[superAdminAction]?.title}
              {actionVoucher && ` — ${actionVoucher.voucher_number}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {superAdminAction && actionLabels[superAdminAction]?.desc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>Reason (required)</Label>
            <Textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Provide a reason for this action..."
              className="resize-none h-20"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSuperAdminAction}
              disabled={superAdminAction !== "restore" && !actionReason.trim()}
              className={(superAdminAction === "delete" || superAdminAction === "purge") ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {superAdminAction && actionLabels[superAdminAction]?.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print Preview */}
      {printVoucher && (
        <PrintLayout
          open={!!printVoucher}
          onClose={() => setPrintVoucher(null)}
          title={VOUCHER_TYPES.find((vt) => vt.id === printVoucher.voucher_type)?.label || "Voucher"}
          docNumber={printVoucher.voucher_number}
          docDate={formatDateDMY(printVoucher.voucher_date)}
          branch={printVoucher.branch_id ? branchMap.get(printVoucher.branch_id) : undefined}
          notes={printVoucher.description || undefined}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "16px" }}>
            <thead>
              <tr>
                <th style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "left", padding: "8px 10px", border: "1px solid #ddd", fontSize: "11px" }}>#</th>
                <th style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "left", padding: "8px 10px", border: "1px solid #ddd", fontSize: "11px" }}>Account Code</th>
                <th style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "left", padding: "8px 10px", border: "1px solid #ddd", fontSize: "11px" }}>Account Name</th>
                <th style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "right", padding: "8px 10px", border: "1px solid #ddd", fontSize: "11px" }}>Debit</th>
                <th style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "right", padding: "8px 10px", border: "1px solid #ddd", fontSize: "11px" }}>Credit</th>
                <th style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "left", padding: "8px 10px", border: "1px solid #ddd", fontSize: "11px" }}>Narration</th>
              </tr>
            </thead>
            <tbody>
              {printEntries.map((entry: any, idx: number) => (
                <tr key={idx}>
                  <td style={{ padding: "6px 10px", border: "1px solid #ddd" }}>{idx + 1}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #ddd", fontFamily: "monospace", fontSize: "11px" }}>{entry.account_code}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #ddd" }}>{entry.account_name}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #ddd", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(entry.debit) > 0 ? fc(Number(entry.debit)) : ""}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #ddd", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(entry.credit) > 0 ? fc(Number(entry.credit)) : ""}</td>
                  <td style={{ padding: "6px 10px", border: "1px solid #ddd", fontSize: "11px", color: "#666" }}>{entry.narration || ""}</td>
                </tr>
              ))}
              <tr style={{ background: "#f0f0f0", fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: "8px 10px", border: "1px solid #ddd", textAlign: "right" }}>Total</td>
                <td style={{ padding: "8px 10px", border: "1px solid #ddd", textAlign: "right" }}>{fc(printEntries.reduce((s: number, e: any) => s + Number(e.debit), 0))}</td>
                <td style={{ padding: "8px 10px", border: "1px solid #ddd", textAlign: "right" }}>{fc(printEntries.reduce((s: number, e: any) => s + Number(e.credit), 0))}</td>
                <td style={{ padding: "8px 10px", border: "1px solid #ddd" }}></td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: "12px", marginTop: "8px" }}>
            <strong>Status:</strong> {printVoucher.status.charAt(0).toUpperCase() + printVoucher.status.slice(1)}
          </div>
        </PrintLayout>
      )}
      {/* View Voucher Dialog */}
      <Dialog open={!!viewVoucher} onOpenChange={() => setViewVoucher(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewVoucher && VOUCHER_TYPES.find((vt) => vt.id === viewVoucher.voucher_type)?.label} — {viewVoucher?.voucher_number}
              {viewVoucher && statusBadge(viewVoucher.status)}
            </DialogTitle>
          </DialogHeader>
          {viewVoucher && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-muted-foreground">Date:</span> <span className="font-medium">{formatDateDMY(viewVoucher.voucher_date)}</span></div>
                <div><span className="text-muted-foreground">Branch:</span> <span className="font-medium">{viewVoucher.branch_id ? branchMap.get(viewVoucher.branch_id) || "—" : "—"}</span></div>
                <div><span className="text-muted-foreground">Amount:</span> <span className="font-medium">{fc(viewVoucher.total_amount)}</span></div>
              </div>
              {viewVoucher.description && (
                <div className="text-sm"><span className="text-muted-foreground">Description:</span> {viewVoucher.description}</div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Account Code</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead>Narration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewEntries.map((e: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className="font-geist-mono text-xs">{e.account_code}</TableCell>
                      <TableCell>{e.account_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(e.debit) > 0 ? fc(Number(e.debit)) : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(e.credit) > 0 ? fc(Number(e.credit)) : ""}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{e.narration || ""}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell colSpan={3} className="text-right">Total</TableCell>
                    <TableCell className="text-right tabular-nums">{fc(viewEntries.reduce((s: number, e: any) => s + Number(e.debit), 0))}</TableCell>
                    <TableCell className="text-right tabular-nums">{fc(viewEntries.reduce((s: number, e: any) => s + Number(e.credit), 0))}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewVoucher(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AuditLogViewer
        open={auditOpen}
        onOpenChange={setAuditOpen}
        module="vouchers"
        recordId={auditRecordId}
        title={auditRecordId ? "Voucher History" : "Vouchers Audit Log"}
      />
    </div>
  );
};

export default AccountingVouchers;
