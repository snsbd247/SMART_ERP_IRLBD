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
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Plus, Pencil, Trash2, Search, Printer, Download, History, ShieldAlert, ExternalLink, Loader2, Copy, Check, FileText, Upload } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { downloadCSV } from "@/lib/csv-export";
import { logCreate, logUpdate, logDelete } from "@/lib/audit-utils";
import { DateInput } from "@/components/ui/date-input";
import {
  buildChallanUrl,
  challanValidationMessage,
  isValidChallanNo,
  validateChallanNo,
} from "@/lib/challan-utils";

type TreasuryType = "salary_tds" | "party_tds" | "vat";
type PartyKind = "employee" | "customer" | "supplier" | "none";

interface TreasuryRow {
  id: string;
  treasury_date: string;
  treasury_type: TreasuryType;
  party_kind: PartyKind | null;
  party_id: string | null;
  party_name_snapshot: string | null;
  tin_snapshot: string | null;
  designation_snapshot: string | null;
  branch_name_snapshot: string | null;
  challan_no: string | null;
  challan_date: string | null;
  bank_name: string | null;
  amount: number;
  challan_base_amount: number | null;
  period_month: string | null;
  mushak_ref: string | null;
  reference_no: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

interface PartyOpt {
  id: string;
  label: string;
  tin?: string | null;
  designation?: string | null;
  branch?: string | null;
}

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
  tin_snapshot: "",
  designation_snapshot: "",
  branch_name_snapshot: "",
  challan_no: "",
  challan_date: "",
  bank_name: "",
  amount: 0,
  challan_base_amount: 0,
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
  const [tableMissing, setTableMissing] = useState(false);
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
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportTab, setReportTab] = useState<"salary" | "party">("salary");
  const [printTarget, setPrintTarget] = useState<TreasuryRow | null>(null);
  const [printPendingId, setPrintPendingId] = useState<string | null>(null);
  const [printOpening, setPrintOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [liveMsg, setLiveMsg] = useState("");

  // ── Bulk Import state ────────────────────────────────────────────────
  type ImportRow = {
    rowNo: number;
    payload: any;
    error?: string;
    partyMatched?: boolean;
  };
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<ImportRow[]>([]);
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0 });
  const bulkCancelRef = useRef(false);

  function openChallanPrint(rawUrl: string) {
    const url = rawUrl; // already normalized via buildChallanUrl
    setPrintOpening(true);
    setPopupBlocked(false);
    try {
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w || w.closed || typeof w.closed === "undefined") {
        setPopupBlocked(true);
        toast({
          title: "Popup blocked",
          description: "Allow popups, then click Retry to open the A-Challan print page.",
          variant: "destructive",
        });
        return;
      }
      setPrintTarget(null);
      setPopupBlocked(false);
    } catch (err: any) {
      setPopupBlocked(true);
      toast({
        title: "Failed to open print link",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPrintOpening(false);
    }
  }

  function requestChallanPrint(r: TreasuryRow) {
    const v = validateChallanNo(r.challan_no);
    if (!v.valid) {
      toast({
        title: "Invalid challan number",
        description: challanValidationMessage(v),
        variant: "destructive",
      });
      return;
    }
    setPrintPendingId(r.id);
    setPopupBlocked(false);
    setCopied(false);
    setLiveMsg("");
    // Brief tick so the spinner is visible before the modal mounts.
    setTimeout(() => {
      setPrintTarget(r);
      setPrintPendingId(null);
    }, 50);
  }

  async function copyChallanUrl(url: string) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setLiveMsg("Challan print URL copied to clipboard.");
      toast({ title: "URL copied", description: "Challan print URL copied to clipboard." });
      setTimeout(() => setCopied(false), 1500);
    } catch (err: any) {
      setLiveMsg("Copy failed. Clipboard not available.");
      toast({
        title: "Copy failed",
        description: err?.message ?? "Clipboard not available",
        variant: "destructive",
      });
    }
  }


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
      const msg = String(error.message || "").toLowerCase();
      const missing =
        msg.includes("does not exist") ||
        msg.includes("not found") ||
        msg.includes("relation") ||
        (error as any).code === "42P01" ||
        (error as any).code === "PGRST205";
      if (missing) {
        setTableMissing(true);
        toast({
          title: "Treasury table not migrated",
          description: "Run `php artisan migrate` on the server to create the treasury_entries table.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Failed to load treasury entries", description: error.message, variant: "destructive" });
      }
    } else {
      setTableMissing(false);
      setRows(((data as unknown) as TreasuryRow[]) || []);
    }
    setLoading(false);
  }

  async function loadParties() {
    const [emp, cus, sup] = await Promise.all([
      supabase.from("employees")
        .select("id, first_name, last_name, employee_code, tin_no, designation_id, branch_id, designation:designations(name), branch:branches(name)")
        .order("first_name"),
      supabase.from("customers").select("id, name, code, tin_no").order("name"),
      supabase.from("suppliers").select("id, name, code, tin_no").order("name"),
    ]);
    setEmployees(((emp.data as any[]) || []).map((e) => ({
      id: e.id,
      label: `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() + (e.employee_code ? ` (${e.employee_code})` : ""),
      tin: e.tin_no ?? null,
      designation: e.designation?.name ?? null,
      branch: e.branch?.name ?? null,
    })));
    setCustomers(((cus.data as any[]) || []).map((c) => ({
      id: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name, tin: c.tin_no ?? null,
    })));
    setSuppliers(((sup.data as any[]) || []).map((s) => ({
      id: s.id, label: s.code ? `${s.code} — ${s.name}` : s.name, tin: s.tin_no ?? null,
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
      tin_snapshot: r.tin_snapshot ?? "",
      designation_snapshot: r.designation_snapshot ?? "",
      branch_name_snapshot: r.branch_name_snapshot ?? "",
      challan_no: r.challan_no ?? "",
      challan_date: r.challan_date ? toDateInputValue(r.challan_date) : "",
      bank_name: r.bank_name ?? "",
      amount: Number(r.amount || 0),
      challan_base_amount: Number(r.challan_base_amount ?? 0),
      period_month: r.period_month ?? "",
      mushak_ref: r.mushak_ref ?? "",
      reference_no: r.reference_no ?? "",
      notes: r.notes ?? "",
    });
    setOpen(true);
  }

  function onTypeChange(t: TreasuryType) {
    const kind: PartyKind = t === "salary_tds" ? "employee" : t === "party_tds" ? "supplier" : "none";
    setForm((f) => ({
      ...f, treasury_type: t, party_kind: kind, party_id: "",
      tin_snapshot: "", designation_snapshot: "", branch_name_snapshot: "",
    }));
  }

  function onPartySelect(kind: PartyKind, id: string) {
    const opt = partyOptions(kind).find((o) => o.id === id);
    setForm((f) => ({
      ...f,
      party_id: id,
      party_name_snapshot: opt?.label ?? "",
      tin_snapshot: opt?.tin ?? "",
      designation_snapshot: opt?.designation ?? "",
      branch_name_snapshot: opt?.branch ?? "",
    }));
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
    const opt = form.party_id ? partyOptions(partyKind).find((o) => o.id === form.party_id) : null;
    const snapshot = opt?.label ?? form.party_name_snapshot ?? null;

    const payload: any = {
      treasury_date: form.treasury_date,
      treasury_type: form.treasury_type,
      party_kind: partyKind,
      party_id: form.party_id || null,
      party_name_snapshot: snapshot,
      tin_snapshot: (form.tin_snapshot || opt?.tin) || null,
      designation_snapshot: (form.designation_snapshot || opt?.designation) || null,
      branch_name_snapshot: (form.branch_name_snapshot || opt?.branch) || null,
      challan_no: form.challan_no || null,
      challan_date: form.challan_date || null,
      bank_name: form.bank_name || null,
      amount: Number(form.amount),
      challan_base_amount: form.challan_base_amount ? Number(form.challan_base_amount) : null,
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

  // ── Bulk Import helpers ──────────────────────────────────────────────
  const BULK_HEADERS = [
    "Date", "Type", "PartyKind", "PartyName", "TIN", "Designation", "Branch",
    "ChallanNo", "ChallanDate", "Bank", "Period", "MushakRef", "Reference",
    "ChallanBaseAmount", "Amount", "Notes",
  ];

  function downloadImportTemplate() {
    const sample = [
      "01-07-2026,salary_tds,employee,John Doe,123456789012,Manager,HQ,CHN-001,02-07-2026,Sonali Bank,2026-07,,REF-1,50000,2500,Sample salary TDS",
      "05-07-2026,party_tds,supplier,ACME Ltd,987654321098,,HQ,CHN-002,06-07-2026,DBBL,2026-07,,REF-2,80000,4000,Sample party TDS",
      "10-07-2026,vat,none,,,,,CHN-003,11-07-2026,City Bank,2026-07,Mushak-9.1/2026-07,REF-3,100000,15000,Sample VAT",
    ].join("\n");
    const blob = new Blob([BULK_HEADERS.join(",") + "\n" + sample], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "treasury-import-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // Minimal RFC4180-ish CSV parser (handles quotes, commas, CRLF).
  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
        } else cell += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(cell); cell = ""; }
        else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(cell); rows.push(row); row = []; cell = "";
        } else cell += c;
      }
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
  }

  function normalizeDateForDb(raw: string): string | null {
    const s = String(raw || "").trim();
    if (!s) return null;
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
    return null;
  }

  function resolveType(v: string): TreasuryType | null {
    const x = String(v || "").trim().toLowerCase().replace(/\s+/g, "_");
    if (["salary_tds", "salary"].includes(x)) return "salary_tds";
    if (["party_tds", "party_bill_tds", "party"].includes(x)) return "party_tds";
    if (["vat", "vat_treasury"].includes(x)) return "vat";
    return null;
  }

  function findPartyId(kind: PartyKind, name: string): string | null {
    if (!name || kind === "none") return null;
    const n = name.trim().toLowerCase();
    const list = partyOptions(kind);
    const hit = list.find((o) => o.label.toLowerCase() === n)
      || list.find((o) => o.label.toLowerCase().includes(n))
      || list.find((o) => n.includes(o.label.toLowerCase()));
    return hit?.id ?? null;
  }

  async function onBulkFileChosen(file: File) {
    setBulkFileName(file.name);
    setBulkRows([]);
    setBulkProgress({ done: 0, total: 0, ok: 0, fail: 0 });
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) { toast({ title: "Empty file", variant: "destructive" }); return; }

    const header = parsed[0].map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name.toLowerCase());
    const required = ["date", "type", "amount"];
    const missing = required.filter((r) => idx(r) === -1);
    if (missing.length) {
      toast({ title: "Missing columns", description: `Required: ${missing.join(", ")}`, variant: "destructive" });
      return;
    }

    const out: ImportRow[] = [];
    const MAX_ROWS = 5000;
    if (parsed.length - 1 > MAX_ROWS) {
      toast({ title: "File too large", description: `Max ${MAX_ROWS} rows per import.`, variant: "destructive" });
      return;
    }
    const seenChallan = new Set<string>();
    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      const get = (k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? "").trim() : "");
      const dateRaw = get("date");
      const date = normalizeDateForDb(dateRaw);
      const type = resolveType(get("type"));
      const amountRaw = get("amount");
      const amount = Number(amountRaw);
      const kindRaw = String(get("partykind") || "").toLowerCase();
      const partyKind: PartyKind =
        (["employee", "customer", "supplier", "none"].includes(kindRaw) ? (kindRaw as PartyKind) : null)
        ?? (type === "salary_tds" ? "employee" : type === "party_tds" ? "supplier" : "none");
      const partyName = get("partyname");
      const partyId = type !== "vat" ? findPartyId(partyKind, partyName) : null;

      const errs: string[] = [];
      if (!date) errs.push(`Invalid date "${dateRaw}" (use DD-MM-YYYY)`);
      if (!type) errs.push(`Invalid type "${get("type")}" (salary_tds | party_tds | vat)`);
      if (!amountRaw || !isFinite(amount) || amount <= 0) errs.push(`Invalid amount "${amountRaw}"`);
      else if (amount > 1_000_000_000) errs.push(`Amount too large (${amount})`);
      if (type && type !== "vat" && !partyName) errs.push("PartyName required");
      if (type === "salary_tds" && partyKind !== "employee") errs.push("salary_tds requires PartyKind=employee");
      if (type === "vat" && partyName) errs.push("VAT entries must not have PartyName");
      const tin = get("tin");
      if (tin && !/^\d{9,15}$/.test(tin.replace(/\s|-/g, ""))) errs.push(`Invalid TIN "${tin}"`);
      const challanNo = get("challanno");
      const challanDate = normalizeDateForDb(get("challandate"));
      if (get("challandate") && !challanDate) errs.push(`Invalid ChallanDate "${get("challandate")}"`);
      if (challanNo) {
        const k = `${challanNo.toLowerCase()}|${challanDate || ""}`;
        if (seenChallan.has(k)) errs.push(`Duplicate ChallanNo+Date "${challanNo}" in file`);
        else seenChallan.add(k);
      }
      const challanBase = Number(get("challanbaseamount") || 0);
      if (get("challanbaseamount") && (!isFinite(challanBase) || challanBase < 0)) {
        errs.push(`Invalid ChallanBaseAmount "${get("challanbaseamount")}"`);
      }
      const period = get("period");
      if (period && !/^\d{4}-\d{2}$/.test(period)) errs.push(`Invalid Period "${period}" (use YYYY-MM)`);

      out.push({
        rowNo: i + 1,
        error: errs.length ? errs.join("; ") : undefined,
        partyMatched: !!partyId,
        payload: {
          treasury_date: date,
          treasury_type: type,
          party_kind: partyKind,
          party_id: partyId,
          party_name_snapshot: partyName || null,
          tin_snapshot: tin || null,
          designation_snapshot: get("designation") || null,
          branch_name_snapshot: get("branch") || null,
          challan_no: challanNo || null,
          challan_date: challanDate,
          bank_name: get("bank") || null,
          amount: isFinite(amount) ? amount : 0,
          challan_base_amount: isFinite(challanBase) && challanBase > 0 ? challanBase : null,
          period_month: period || null,
          mushak_ref: get("mushakref") || null,
          reference_no: get("reference") || null,
          notes: get("notes") || null,
          status: "active",
          created_by: user?.id ?? null,
        },
      });
    }
    setBulkRows(out);
  }

  function downloadErrorReport() {
    const failed = bulkRows.filter((r) => r.error);
    if (!failed.length) { toast({ title: "No errors to export" }); return; }
    const headers = [...BULK_HEADERS, "RowNo", "Error"];
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    failed.forEach((r) => {
      const p = r.payload;
      lines.push([
        p.treasury_date ? formatDateDMY(p.treasury_date) : "",
        p.treasury_type ?? "", p.party_kind ?? "", p.party_name_snapshot ?? "",
        p.tin_snapshot ?? "", p.designation_snapshot ?? "", p.branch_name_snapshot ?? "",
        p.challan_no ?? "", p.challan_date ? formatDateDMY(p.challan_date) : "",
        p.bank_name ?? "", p.period_month ?? "", p.mushak_ref ?? "", p.reference_no ?? "",
        p.challan_base_amount ?? "", p.amount ?? "", p.notes ?? "",
        r.rowNo, r.error,
      ].map(esc).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "treasury-import-errors.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function runBulkImport() {
    if (!canAdd) {
      toast({ title: "Permission denied", description: "treasury.can_add required", variant: "destructive" });
      return;
    }
    const valid = bulkRows.filter((r) => !r.error);
    if (!valid.length) { toast({ title: "No valid rows to import", variant: "destructive" }); return; }
    bulkCancelRef.current = false;
    setBulkImporting(true);
    setBulkProgress({ done: 0, total: valid.length, ok: 0, fail: 0 });

    const CHUNK = 50;
    let ok = 0, fail = 0;
    const updated = [...bulkRows];
    for (let i = 0; i < valid.length; i += CHUNK) {
      if (bulkCancelRef.current) break;
      const slice = valid.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("treasury_entries" as any)
        .insert(slice.map((r) => r.payload))
        .select("id");
      if (error) {
        // Per-row fallback so successful rows still import and errors are attributed.
        for (const s of slice) {
          if (bulkCancelRef.current) break;
          const { data: d2, error: e2 } = await supabase
            .from("treasury_entries" as any)
            .insert(s.payload)
            .select("id")
            .single();
          const ix = updated.findIndex((u) => u.rowNo === s.rowNo);
          if (e2) {
            fail++;
            if (ix >= 0) updated[ix] = { ...updated[ix], error: e2.message };
          } else {
            ok++;
            try {
              await logCreate({
                userId: user?.id, userName: profile?.name || user?.email || undefined,
                module: "treasury", recordId: (d2 as any)?.id, newData: s.payload,
                details: "Bulk import (per-row fallback)",
              });
            } catch { /* ignore */ }
          }
          setBulkProgress({ done: Math.min(i + (slice.indexOf(s) + 1), valid.length), total: valid.length, ok, fail });
        }
      } else {
        ok += slice.length;
        try {
          const ids = ((data as any[]) || []).map((d) => d.id);
          for (let k = 0; k < ids.length; k++) {
            await logCreate({
              userId: user?.id, userName: profile?.name || user?.email || undefined,
              module: "treasury", recordId: ids[k], newData: slice[k].payload,
              details: "Bulk import",
            });
          }
        } catch { /* ignore audit errors */ }
      }
      setBulkProgress({ done: Math.min(i + CHUNK, valid.length), total: valid.length, ok, fail });
    }
    setBulkRows(updated);
    setBulkImporting(false);
    const cancelled = bulkCancelRef.current;
    toast({
      title: cancelled ? "Bulk import cancelled" : "Bulk import finished",
      description: `${ok} added, ${fail} failed, ${bulkRows.length - valid.length} skipped (validation).`,
      variant: fail > 0 ? "destructive" : "default",
    });
    void load();
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

  if (tableMissing) {
    return (
      <div className="p-6">
        <Card><CardContent className="py-12 text-center space-y-3">
          <ShieldAlert className="w-10 h-10 mx-auto text-destructive" />
          <div className="font-semibold text-lg">Database not migrated</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            The <code>treasury_entries</code> table is missing. An administrator must run the latest
            database migrations on the server:
          </p>
          <pre className="text-xs bg-muted p-3 rounded inline-block text-left">cd erp-backend{"\n"}php artisan migrate</pre>
          <div>
            <Button variant="outline" size="sm" onClick={() => { setTableMissing(false); void load(); }}>
              Retry
            </Button>
          </div>
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
          <Button variant="outline" size="sm" onClick={() => { setReportTab("salary"); setReportsOpen(true); }}>
            <FileText className="w-4 h-4 mr-1" /> TDS Reports
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="w-4 h-4 mr-1" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" /> Print</Button>
          {canAdd && (
            <>
              <Button variant="outline" size="sm" onClick={() => { setBulkRows([]); setBulkFileName(""); setBulkProgress({ done: 0, total: 0, ok: 0, fail: 0 }); setBulkOpen(true); }}>
                <Upload className="w-4 h-4 mr-1" /> Bulk Import
              </Button>
              <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Entry</Button>
            </>
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
              <DateInput value={fromDate} onChange={(v) => setFromDate(v)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <DateInput value={toDate} onChange={(v) => setToDate(v)} />
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>TIN</TableHead>
                  <TableHead>Challan</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : pageRows.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No treasury entries found.</TableCell></TableRow>
                ) : pageRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDateDMY(r.treasury_date)}</TableCell>
                    <TableCell><Badge variant="secondary">{TYPE_LABEL[r.treasury_type]}</Badge></TableCell>
                    <TableCell>{r.party_name_snapshot ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{r.tin_snapshot || "—"}</TableCell>
                    <TableCell>
                      {r.challan_no || "—"}
                      {r.challan_date && <div className="text-xs text-muted-foreground">{formatDateDMY(r.challan_date)}</div>}
                    </TableCell>
                    <TableCell>{r.bank_name ?? "—"}</TableCell>
                    <TableCell>{r.period_month ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={!isValidChallanNo(r.challan_no) || printPendingId === r.id}
                        onClick={() => requestChallanPrint(r)}
                        aria-label={
                          isValidChallanNo(r.challan_no)
                            ? `Print A-Challan ${r.challan_no}`
                            : "Print disabled: add a valid challan number"
                        }
                        title={
                          isValidChallanNo(r.challan_no)
                            ? `Print A-Challan ${r.challan_no}`
                            : "Add a valid challan number to print"
                        }
                        data-testid={`print-challan-${r.id}`}
                      >
                        {printPendingId === r.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ExternalLink className="w-4 h-4" aria-hidden="true" />
                        )}
                      </Button>
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
              <DateInput value={form.treasury_date} onChange={(v) => setForm({ ...form, treasury_date: v })} />
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
                <Select value={form.party_id} onValueChange={(v) => onPartySelect("employee", v)}>
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
                  <Select value={form.party_kind} onValueChange={(v) => setForm({ ...form, party_kind: v as PartyKind, party_id: "", tin_snapshot: "", branch_name_snapshot: "" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supplier">Supplier</SelectItem>
                      <SelectItem value="customer">Customer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Party *</Label>
                  <Select value={form.party_id} onValueChange={(v) => onPartySelect(form.party_kind, v)}>
                    <SelectTrigger><SelectValue placeholder={`Select ${form.party_kind}`} /></SelectTrigger>
                    <SelectContent>
                      {partyOptions(form.party_kind).map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {form.treasury_type !== "vat" && form.party_id && (
              <>
                <div>
                  <Label>TIN (auto)</Label>
                  <Input value={form.tin_snapshot} onChange={(e) => setForm({ ...form, tin_snapshot: e.target.value })} placeholder="Auto-filled from party profile" />
                </div>
                {form.treasury_type === "salary_tds" && (
                  <div>
                    <Label>Designation (auto)</Label>
                    <Input value={form.designation_snapshot} onChange={(e) => setForm({ ...form, designation_snapshot: e.target.value })} />
                  </div>
                )}
                <div className={form.treasury_type === "party_tds" ? "" : "md:col-span-2"}>
                  <Label>Branch (auto)</Label>
                  <Input value={form.branch_name_snapshot} onChange={(e) => setForm({ ...form, branch_name_snapshot: e.target.value })} />
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
              <Label>TDS / Treasury Amount *</Label>
              <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Challan Base Amount</Label>
              <Input type="number" step="0.01" value={form.challan_base_amount} onChange={(e) => setForm({ ...form, challan_base_amount: Number(e.target.value) })} placeholder="Bill / gross amount the TDS was deducted from" />
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
              <DateInput value={form.challan_date} onChange={(v) => setForm({ ...form, challan_date: v })} />
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

      {/* Salary TDS / Party TDS Reports */}
      <Dialog open={reportsOpen} onOpenChange={setReportsOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>TDS Reports</DialogTitle></DialogHeader>
          <Tabs value={reportTab} onValueChange={(v) => setReportTab(v as any)}>
            <TabsList>
              <TabsTrigger value="salary">Salary TDS</TabsTrigger>
              <TabsTrigger value="party">Party TDS</TabsTrigger>
            </TabsList>

            <TabsContent value="salary" className="space-y-3">
              {(() => {
                const data = filtered
                  .filter((r) => r.treasury_type === "salary_tds")
                  .map((r) => ({
                    month: r.period_month || (r.treasury_date ? r.treasury_date.slice(0, 7) : ""),
                    challan_no: r.challan_no ?? "",
                    challan_date: r.challan_date ? formatDateDMY(r.challan_date) : "",
                    bank: r.bank_name ?? "",
                    branch: r.branch_name_snapshot ?? "",
                    tin: r.tin_snapshot ?? "",
                    employee: r.party_name_snapshot ?? "",
                    designation: r.designation_snapshot ?? "",
                    challan_amount: Number(r.challan_base_amount ?? 0).toFixed(2),
                    tds_amount: Number(r.amount ?? 0).toFixed(2),
                  }));
                const cols = [
                  { key: "month", label: "MONTH" },
                  { key: "challan_no", label: "CHALLAN NO" },
                  { key: "challan_date", label: "CHALLAN DATE" },
                  { key: "bank", label: "BANK NAME" },
                  { key: "branch", label: "BRANCH" },
                  { key: "tin", label: "TIN" },
                  { key: "employee", label: "EMPLOYEE" },
                  { key: "designation", label: "DESIGNATION" },
                  { key: "challan_amount", label: "CHALLAN AMOUNT" },
                  { key: "tds_amount", label: "TDS AMOUNT" },
                ];
                return (
                  <>
                    <div className="flex justify-between items-center">
                      <div className="text-sm text-muted-foreground">{data.length} entries (uses current page filters)</div>
                      <Button size="sm" variant="outline" onClick={() => downloadCSV(`salary-tds-${new Date().toISOString().slice(0,10)}`, cols, data)}>
                        <Download className="w-4 h-4 mr-1" /> CSV
                      </Button>
                    </div>
                    <div className="overflow-x-auto max-h-[55vh]">
                      <Table>
                        <TableHeader>
                          <TableRow>{cols.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.length === 0 ? (
                            <TableRow><TableCell colSpan={cols.length} className="text-center py-6 text-muted-foreground">No Salary TDS entries.</TableCell></TableRow>
                          ) : data.map((d, i) => (
                            <TableRow key={i}>
                              {cols.map((c) => <TableCell key={c.key} className={c.key.includes("amount") ? "text-right font-mono" : ""}>{(d as any)[c.key] || "—"}</TableCell>)}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                );
              })()}
            </TabsContent>

            <TabsContent value="party" className="space-y-3">
              {(() => {
                const data = filtered
                  .filter((r) => r.treasury_type === "party_tds")
                  .map((r) => ({
                    month: r.period_month || (r.treasury_date ? r.treasury_date.slice(0, 7) : ""),
                    challan_no: r.challan_no ?? "",
                    challan_date: r.challan_date ? formatDateDMY(r.challan_date) : "",
                    bank: r.bank_name ?? "",
                    branch: r.branch_name_snapshot ?? "",
                    tin: r.tin_snapshot ?? "",
                    party: r.party_name_snapshot ?? "",
                    challan_amount: Number(r.challan_base_amount ?? 0).toFixed(2),
                    tds_amount: Number(r.amount ?? 0).toFixed(2),
                  }));
                const cols = [
                  { key: "month", label: "MONTH" },
                  { key: "challan_no", label: "CHALLAN NO" },
                  { key: "challan_date", label: "CHALLAN DATE" },
                  { key: "bank", label: "BANK NAME" },
                  { key: "branch", label: "BRANCH" },
                  { key: "tin", label: "TIN" },
                  { key: "party", label: "PARTY NAME" },
                  { key: "challan_amount", label: "CHALLAN AMOUNT" },
                  { key: "tds_amount", label: "TDS AMOUNT" },
                ];
                return (
                  <>
                    <div className="flex justify-between items-center">
                      <div className="text-sm text-muted-foreground">{data.length} entries (uses current page filters)</div>
                      <Button size="sm" variant="outline" onClick={() => downloadCSV(`party-tds-${new Date().toISOString().slice(0,10)}`, cols, data)}>
                        <Download className="w-4 h-4 mr-1" /> CSV
                      </Button>
                    </div>
                    <div className="overflow-x-auto max-h-[55vh]">
                      <Table>
                        <TableHeader>
                          <TableRow>{cols.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.length === 0 ? (
                            <TableRow><TableCell colSpan={cols.length} className="text-center py-6 text-muted-foreground">No Party TDS entries.</TableCell></TableRow>
                          ) : data.map((d, i) => (
                            <TableRow key={i}>
                              {cols.map((c) => <TableCell key={c.key} className={c.key.includes("amount") ? "text-right font-mono" : ""}>{(d as any)[c.key] || "—"}</TableCell>)}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                );
              })()}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportsOpen(false)}>Close</Button>
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

      {/*
        A-Challan print preview.
        Radix Dialog handles focus trap, Esc-to-close, and Tab cycling.
        We only add an aria-label / aria-describedby + descriptive copy.
      */}
      <Dialog open={!!printTarget} onOpenChange={(o) => { if (!o) setPrintTarget(null); }}>
        <DialogContent className="max-w-2xl" aria-describedby="challan-print-desc" data-testid="challan-print-modal">
          <DialogHeader>
            <DialogTitle>Open A-Challan Print Slip</DialogTitle>
          </DialogHeader>
          {printTarget && isValidChallanNo(printTarget.challan_no) ? (
            <div className="space-y-3 text-sm" id="challan-print-desc">
              <div>
                <div className="text-muted-foreground text-xs">Challan No</div>
                <div className="font-mono">{printTarget.challan_no}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">URL</div>
                <div className="flex items-stretch gap-2">
                  <code
                    data-testid="challan-print-url"
                    className="flex-1 font-mono text-xs break-all bg-muted rounded p-2 border"
                  >
                    {buildChallanUrl(printTarget.challan_no!)}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Copy challan print URL"
                    onClick={() => copyChallanUrl(buildChallanUrl(printTarget.challan_no!))}
                  >
                    {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                    {copied ? "Copied" : "Copy URL"}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The link opens on achallan.gov.bd in a new tab. Make sure popups are allowed.
                Press Esc to close.
              </p>
              {popupBlocked && (
                <div
                  data-testid="challan-popup-blocked"
                  role="alert"
                  className="text-xs text-destructive border border-destructive/30 rounded p-2 bg-destructive/5"
                >
                  Popup was blocked by the browser. Allow popups for this site, then press
                  Retry below.
                </div>
              )}
              <div
                aria-live="polite"
                role="status"
                data-testid="challan-copy-live"
                className="sr-only"
              >
                {liveMsg}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintTarget(null)}>Cancel</Button>
            {printTarget && isValidChallanNo(printTarget.challan_no) ? (
              <Button
                data-testid="challan-print-open"
                disabled={printOpening}
                onClick={() => openChallanPrint(buildChallanUrl(printTarget.challan_no!))}
              >
                {printOpening ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-1" />
                )}
                {printOpening
                  ? "Opening…"
                  : popupBlocked
                    ? "Retry Open"
                    : "Open Print Slip"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkOpen} onOpenChange={(o) => { if (!bulkImporting) setBulkOpen(o); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Bulk Import Treasury Entries</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadImportTemplate}>
                <Download className="w-4 h-4 mr-1" /> Download Template
              </Button>
              <label className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted text-sm">
                <Upload className="w-4 h-4" /> Choose CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onBulkFileChosen(f); e.currentTarget.value = ""; }}
                />
              </label>
              {bulkFileName && <span className="text-muted-foreground text-xs">{bulkFileName}</span>}
            </div>
            <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-1">
              <div><b>Required columns:</b> <code>Date</code>, <code>Type</code>, <code>Amount</code></div>
              <div><b>Optional:</b> PartyKind, PartyName, TIN, Designation, Branch, ChallanNo, ChallanDate, Bank, Period (YYYY-MM), MushakRef, Reference, ChallanBaseAmount, Notes</div>
              <div><b>Type values:</b> <code>salary_tds</code> · <code>party_tds</code> · <code>vat</code> &nbsp; · &nbsp; <b>Dates:</b> <code>DD-MM-YYYY</code> or <code>YYYY-MM-DD</code></div>
              <div className="text-muted-foreground">Max 5,000 rows per file. Imports run in batches of 50; failed batches retry per-row so good rows still save.</div>
            </div>

            {bulkRows.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="text-muted-foreground">
                    {bulkRows.length} rows · <span className="text-emerald-600">{bulkRows.filter((r) => !r.error).length} valid</span> · <span className="text-destructive">{bulkRows.filter((r) => r.error).length} errors</span>
                    {bulkImporting && <> · Importing {bulkProgress.done}/{bulkProgress.total} (ok {bulkProgress.ok}, fail {bulkProgress.fail})</>}
                  </div>
                  {bulkRows.some((r) => r.error) && (
                    <Button variant="outline" size="sm" onClick={downloadErrorReport}>
                      <Download className="w-4 h-4 mr-1" /> Download Error Report
                    </Button>
                  )}
                </div>
                {bulkImporting && (
                  <Progress value={bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0} className="h-2" />
                )}
                <div className="overflow-auto max-h-[45vh] border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Party</TableHead>
                        <TableHead>Challan</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bulkRows.slice(0, 200).map((r) => (
                        <TableRow key={r.rowNo} className={r.error ? "bg-destructive/5" : ""}>
                          <TableCell>{r.rowNo}</TableCell>
                          <TableCell>{r.payload.treasury_date ? formatDateDMY(r.payload.treasury_date) : "—"}</TableCell>
                          <TableCell>{r.payload.treasury_type ?? "—"}</TableCell>
                          <TableCell>
                            {r.payload.party_name_snapshot ?? "—"}
                            {r.payload.treasury_type !== "vat" && r.payload.party_name_snapshot && (
                              <Badge variant={r.partyMatched ? "secondary" : "outline"} className="ml-2 text-[10px]">
                                {r.partyMatched ? "matched" : "snapshot only"}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{r.payload.challan_no ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{Number(r.payload.amount || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-xs">
                            {r.error ? <span className="text-destructive">{r.error}</span> : <span className="text-emerald-600">OK</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                      {bulkRows.length > 200 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground">…showing first 200 rows. Errors for all rows are included in the Error Report.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkImporting}>Close</Button>
            {bulkImporting ? (
              <Button variant="destructive" onClick={() => { bulkCancelRef.current = true; }}>
                Cancel Import
              </Button>
            ) : (
              <Button
                onClick={runBulkImport}
                disabled={bulkRows.filter((r) => !r.error).length === 0}
              >
                Import {bulkRows.filter((r) => !r.error).length} rows
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
