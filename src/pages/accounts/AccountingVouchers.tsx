import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { voucherApi } from "@/lib/voucher-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { Checkbox } from "@/components/ui/checkbox";
import { AccountCombobox } from "@/components/accounts/AccountCombobox";
import { useAccountBalances } from "@/hooks/useAccountBalances";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Check, X, FileText, Trash2, RotateCcw, Pencil, ArrowLeftRight, Lock, Printer, Eye, PlusCircle, History, Shuffle, MoreHorizontal, AlertTriangle, ChevronDown } from "lucide-react";
import { VoucherRowActions } from "@/components/accounts/VoucherRowActions";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AuditLogViewer } from "@/components/AuditLogViewer";
import { useCurrency } from "@/contexts/CurrencyContext";
import { PrintLayout } from "@/components/PrintLayout";
import { formatDateDMY, toDateInputValue } from "@/lib/date-format";
import {
  canShowVoucherDeleteAction,
  evaluateVoucherPermission,
  logVoucherPermissionDenial,
  type VoucherType,
} from "@/lib/voucher-permissions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { validateEntryNature } from "@/lib/account-nature";
import { logAudit } from "@/lib/audit-utils";
import { signedOpeningBalance, formatSignedBalance } from "@/lib/balance-format";




const VOUCHER_TYPES = [
  { id: "journal", label: "Journal Voucher", prefix: "JV" },
  { id: "payment", label: "Payment Voucher", prefix: "PV" },
  { id: "receipt", label: "Receipt Voucher", prefix: "RV" },
  { id: "contra", label: "Contra Voucher", prefix: "CV" },
];

interface Account { id: string; account_name: string; account_code: string; }
interface Branch { id: string; name: string; }
interface FinYear { id: string; name: string; start_date?: string; end_date?: string; is_active?: boolean | number; }
interface EntryRow { id: string; account_id: string; dr_cr: "dr" | "cr"; debit: number; credit: number; narration: string; }
interface Voucher {
  id: string; voucher_number: string; voucher_type: string; voucher_date: string;
  branch_id: string | null; financial_year_id: string | null; description: string | null;
  total_amount: number; status: string; created_at: string;
  ledger_accounts?: string[];
  created_by?: string | null;
  creator?: { id?: string; name?: string | null; username?: string | null } | null;
  creator_name?: string | null;
}

type SuperAdminAction = "delete" | "reopen" | "reverse" | "restore" | "purge" | null;

const AccountingVouchers = () => {
  const { isSuperAdmin, hasPermission, user } = useAuth();
  const { toast } = useToast();
  const { fc } = useCurrency();

  // Centralised permission spec — mirrors backend App\Support\VoucherPermissions.
  const permCtx = { isSuperAdmin, hasPermission };
  const evalPerm = (type: string, action: "view" | "create" | "edit" | "delete") =>
    evaluateVoucherPermission(permCtx, type as VoucherType, action);

  // Per-voucher-type view checks (drives tab visibility)
  const canViewJournal = evalPerm("journal", "view").allowed;
  const canViewPayment = evalPerm("payment", "view").allowed;
  const canViewReceipt = evalPerm("receipt", "view").allowed;
  const canViewContra = evalPerm("contra", "view").allowed;

  const voucherPermMap: Record<string, boolean> = {
    journal: canViewJournal,
    payment: canViewPayment,
    receipt: canViewReceipt,
    contra: canViewContra,
  };

  const canCreateForType = (type: string) => evalPerm(type, "create").allowed;
  const canEditForType = (type: string) => evalPerm(type, "edit").allowed;

  const allowedTypes = VOUCHER_TYPES.filter((vt) => voucherPermMap[vt.id]);
  const TYPE_FILTER_KEY = "accountingVouchers.typeFilter";
  const LAST_NEW_TYPE_KEY = "accountingVouchers.lastNewType";
  const [searchParams, setSearchParams] = useSearchParams();
  const validType = (v: string | null | undefined) =>
    !!v && (v === "all" || VOUCHER_TYPES.some((t) => t.id === v));
  const [typeFilter, setTypeFilterState] = useState<string>(() => {
    const url = searchParams.get("type");
    if (validType(url)) return url as string;
    try {
      const stored = localStorage.getItem(TYPE_FILTER_KEY);
      if (validType(stored)) return stored as string;
    } catch { /* ignore */ }
    return "all";
  });
  const setTypeFilter = (v: string) => {
    setTypeFilterState(v);
    const next = new URLSearchParams(searchParams);
    if (v === "all") next.delete("type"); else next.set("type", v);
    setSearchParams(next, { replace: true });
  };
  useEffect(() => {
    try { localStorage.setItem(TYPE_FILTER_KEY, typeFilter); } catch { /* ignore */ }
  }, [typeFilter]);
  const [newTypePickerOpen, setNewTypePickerOpen] = useState(false);
  // 2-step picker: null = choose type, string = preview selected type
  const [pickerPreviewType, setPickerPreviewType] = useState<string | null>(null);
  const [newVoucherType, setNewVoucherType] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(LAST_NEW_TYPE_KEY);
      if (stored && VOUCHER_TYPES.some((t) => t.id === stored)) return stored;
    } catch { /* ignore */ }
    return allowedTypes[0]?.id || "journal";
  });
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
  const [manualFinYear, setManualFinYear] = useState(false);
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

  // Change-Type (transfer) dialog state
  const [changeTypeVoucher, setChangeTypeVoucher] = useState<Voucher | null>(null);
  const [changeTypeTarget, setChangeTypeTarget] = useState<string>("");
  const [changeTypeReason, setChangeTypeReason] = useState("");
  const [changeTypeSaving, setChangeTypeSaving] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkChangeOpen, setBulkChangeOpen] = useState(false);
  const [bulkTargetType, setBulkTargetType] = useState<string>("");
  const [bulkReason, setBulkReason] = useState("");




  const [voucherAccountsMap, setVoucherAccountsMap] = useState<Record<string, string[]>>({});
  const [showDeleted, setShowDeleted] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditRecordId, setAuditRecordId] = useState<string | undefined>(undefined);

  // Server-side filters + pagination state
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [totalCount, setTotalCount] = useState(0);

  // Debounce search → server (300ms)
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Reset to page 1 whenever filters change.
  useEffect(() => { setPage(1); }, [debouncedSearch, filterFrom, filterTo, typeFilter, showDeleted]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const listParams = {
        search: debouncedSearch || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
      };
      // "all" — fetch each allowed type in parallel and merge client-side.
      // Otherwise use existing per-type paginated call.
      const typesToFetch = typeFilter === "all"
        ? allowedTypes.map((t) => t.id)
        : [typeFilter];

      let vList: Voucher[] = [];
      let totalAcrossTypes = 0;

      if (typeFilter === "all") {
        const results = await Promise.all(
          typesToFetch.map((t) =>
            voucherApi.list(t, showDeleted, { ...listParams, page: 1, per_page: 500 })
          )
        );
        results.forEach((r) => {
          vList = vList.concat((r.data || []) as Voucher[]);
          totalAcrossTypes += Number((r as any).total ?? (r.data || []).length) || 0;
        });
        // sort by date desc, then created_at desc
        vList.sort((a, b) => {
          const d = (b.voucher_date || "").localeCompare(a.voucher_date || "");
          if (d !== 0) return d;
          return (b.created_at || "").localeCompare(a.created_at || "");
        });
        // client-side pagination for merged view
        const start = (page - 1) * perPage;
        const paged = vList.slice(start, start + perPage);
        setVouchers(paged);
        setTotalCount(totalAcrossTypes);
        vList = paged;
      } else {
        const vRes = await voucherApi.list(typeFilter, showDeleted, { ...listParams, page, per_page: perPage });
        vList = (vRes.data || []) as Voucher[];
        setVouchers(vList);
        setTotalCount(Number((vRes as any).total ?? vList.length) || 0);
      }

      const [aRes, bRes, fRes] = await Promise.all([
        voucherApi.listAccounts(),
        voucherApi.listBranches(),
        voucherApi.listFinancialYears(),
      ]);
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
      setTotalCount(0);
      toast({ title: "Error loading vouchers", description: err?.message || "Unable to load accounting vouchers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, showDeleted, debouncedSearch, filterFrom, filterTo, page, perPage, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  const { accounts: accountsWithBal } = useAccountBalances();
  const balanceMap = new Map(accountsWithBal.map((a) => [a.id, { signed: a.signed_balance }]));
  // Dev debug — Opening / Debit / Credit / Closing per account for the form.
  const debugMap = new Map(accountsWithBal.map((a) => [a.id, {
    opening: signedOpeningBalance(a.opening_balance, a.opening_balance_type),
    debit: a.total_debit,
    credit: a.total_credit,
    closing: a.signed_balance,
    account_type: a.account_type,
  }]));


  const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0);
  const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0);
  const isBalanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  const matchingFinYearForDate = useCallback((isoDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return undefined;
    return finYears.find((fy) => fy.is_active && fy.start_date && fy.end_date && fy.start_date <= isoDate && fy.end_date >= isoDate);
  }, [finYears]);

  const handleFormDateChange = (nextDate: string) => {
    setFormDate(nextDate);
    const matching = matchingFinYearForDate(nextDate);
    if (matching) {
      setFormFinYear(matching.id);
      setManualFinYear(false);
    }
  };

  useEffect(() => {
    if (!formDate || !finYears.length || manualFinYear) return;
    const matching = matchingFinYearForDate(formDate);
    if (matching && matching.id !== formFinYear) setFormFinYear(matching.id);
  }, [formDate, finYears, formFinYear, manualFinYear, matchingFinYearForDate]);

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
    const today = new Date().toISOString().slice(0, 10);
    setFormDate(today);
    setFormBranch(""); setFormFinYear(matchingFinYearForDate(today)?.id || ""); setManualFinYear(false); setFormDesc(""); setDescAuto(true);
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
    setFormDate(toDateInputValue(v.voucher_date));
    setFormBranch(v.branch_id || "");
    setFormFinYear(matchingFinYearForDate(toDateInputValue(v.voucher_date))?.id || v.financial_year_id || "");
    setManualFinYear(false);
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
    if (v.status === "draft" || v.status === "rejected" || v.status === "approved") return canEditForType(v.voucher_type);
    return false;
  };

  const canDeleteVoucher = (v: Voucher) => {
    return canShowVoucherDeleteAction({
      isDeleted: Boolean((v as any).deleted_at),
      voucherType: v.voucher_type,
      evaluate: (type) => evalPerm(type, "delete"),
    });
  };

  const handleSave = async (submitForApproval: boolean, resetForNew: boolean = false) => {
    // Guard: voucher_date is required end-to-end. A missing/invalid date
    // silently reverted to the previously saved value in the past — surface
    // it explicitly instead of shipping an empty payload to the backend.
    if (!formDate || !/^\d{4}-\d{2}-\d{2}$/.test(formDate)) {
      toast({
        title: "Voucher date required",
        description: "Please pick a valid date (DD-MM-YYYY) before saving.",
        variant: "destructive",
      });
      return;
    }
    // Block POSTING (submit) when the currently-selected FY is inactive.
    // Save-as-Draft is still allowed so users can preserve work on legacy vouchers.
    const selectedFy = finYears.find((f) => f.id === formFinYear);
    if (submitForApproval && selectedFy && !selectedFy.is_active) {
      toast({
        title: "Posting blocked — Inactive Financial Year",
        description: `${selectedFy.name} is inactive. You may save as draft, but posting requires an active year. Activate it in Settings → Financial Years.`,
        variant: "destructive",
      });
      return;
    }
    const matchingFinYear = matchingFinYearForDate(formDate);
    if (finYears.length > 0 && !matchingFinYear) {
      toast({
        title: "Financial year will be resolved",
        description: `No loaded financial year covers ${formatDateDMY(formDate)}. The server will create/use the matching year while saving.`,
      });
    }
    if (matchingFinYear && formFinYear && formFinYear !== matchingFinYear.id) {
      toast({
        title: "Financial year corrected",
        description: `${formatDateDMY(formDate)} belongs to ${matchingFinYear.name}; saving with the matching year.`,
      });
      setFormFinYear(matchingFinYear.id);
    }
    if (!isBalanced) {
      toast({ title: "Debit and Credit must be equal", variant: "destructive" });
      return;
    }
    const validEntries = entries.filter((e) => e.account_id && (e.debit > 0 || e.credit > 0));
    if (validEntries.length < 2) {
      toast({ title: "At least 2 entries required", variant: "destructive" });
      return;
    }
    // Front-end debit/credit nature validation — blocks hard errors,
    // surfaces contra-side warnings as a non-blocking toast.
    const nature = validateEntryNature(
      validEntries.map((e) => ({ account_id: e.account_id, dr_cr: e.dr_cr, debit: e.debit, credit: e.credit })),
      accountsWithBal.map((a) => ({ id: a.id, account_code: a.account_code, account_name: a.account_name, account_type: a.account_type })),
    );
    if (nature.errors.length > 0) {
      toast({ title: "Entry validation failed", description: nature.errors.map((i) => i.message).join("\n"), variant: "destructive" });
      return;
    }
    if (nature.warnings.length > 0) {
      toast({ title: "Heads up — contra posting", description: nature.warnings.map((i) => i.message).join("\n") });
    }

    const resolvedFinancialYearId = matchingFinYear?.id || (!finYears.length ? formFinYear || null : null);

    setSaving(true);
    try {
      if (editingVoucher) {
        // Editing existing voucher
        if (editingVoucher.status === "approved" && isSuperAdmin && !canEditForType(editingVoucher.voucher_type)) {
          await voucherApi.editApproved({
            id: editingVoucher.id,
            voucher_date: formDate,
            branch_id: formBranch || null,
            financial_year_id: resolvedFinancialYearId,
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
            financial_year_id: resolvedFinancialYearId,
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
          voucher_type: newVoucherType,
          voucher_date: formDate,
          branch_id: formBranch || undefined,
          financial_year_id: resolvedFinancialYearId || undefined,
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
      // Audit log: capture per-account computed balance fields (Opening,
      // Debit, Credit, Closing) used by the form at save time. This makes
      // future Current/Closing mismatches traceable to the exact figures
      // shown to the user when they saved.
      try {
        const affected = validEntries.map((e) => {
          const dbg = debugMap.get(e.account_id);
          return {
            account_id: e.account_id,
            dr_cr: e.dr_cr,
            entry_debit: e.debit,
            entry_credit: e.credit,
            displayed_opening: dbg?.opening ?? null,
            displayed_total_debit: dbg?.debit ?? null,
            displayed_total_credit: dbg?.credit ?? null,
            displayed_closing: dbg?.closing ?? null,
          };
        });
        await logAudit({
          userId: user?.id,
          module: "accounting",
          action: editingVoucher ? "voucher_edit_balance_impact" : "voucher_create_balance_impact",
          recordId: editingVoucher?.id,
          newData: {
            voucher_type: editingVoucher?.voucher_type || newVoucherType,
            voucher_date: formDate,
            total_debit: totalDebit,
            total_credit: totalCredit,
            affected_accounts: affected,
          },
        });
        // Dedicated audit trail entry for voucher_date changes so the
        // "date reverted" class of bug is always traceable to old→new.
        if (editingVoucher) {
          const oldDate = String(editingVoucher.voucher_date || "").slice(0, 10);
          if (oldDate && oldDate !== formDate) {
            await logAudit({
              userId: user?.id,
              module: "accounting",
              action: "voucher_date_changed",
              recordId: editingVoucher.id,
              oldData: { voucher_date: oldDate },
              newData: { voucher_date: formDate, voucher_number: editingVoucher.voucher_number },
            });
          }
        }
      } catch {
        // Audit-log failures must never block voucher save.
      }


      if (resetForNew) {
        resetNewVoucherEntries();
      } else {
        setDialogOpen(false);
        setEditingVoucher(null);
      }
      fetchData();
    } catch (err: any) {
      // Surface backend permission denials (403) with the exact missing
      // permissions and correlation id returned by VoucherPermissions::authorize.
      if (err?.status === 403) {
        const missing: string[] = err?.requiredAnyOf ?? [];
        const cid: string | undefined = err?.correlationId;
        const description = [
          err?.message || "You do not have permission to edit this voucher.",
          missing.length ? `Need ANY of: ${missing.join(", ")}` : null,
          cid ? `ref: ${cid}` : null,
        ].filter(Boolean).join("\n");
        toast({ title: "Edit not allowed", description, variant: "destructive" });
        if (editingVoucher) {
          logVoucherPermissionDenial({
            userId: user?.id,
            voucherType: editingVoucher.voucher_type as VoucherType,
            voucherId: editingVoucher.id,
            action: "edit",
            evaluation: {
              allowed: false,
              reason: err?.message || "Denied by server",
              candidates: missing,
              correlationId: cid || "server",
            },
          });
        }
      } else if (err?.status === 422 && /financial year|inactive/i.test(err?.message || "")) {
        toast({
          title: "Inactive Financial Year",
          description: `${err.message}\nOpen Settings → Financial Years and activate the year, or change the voucher date.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: err?.message, variant: "destructive" });
      }
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
          toast({ title: "Voucher moved to trash", description: "A Super Admin can restore it from the deleted list." });
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

  const openChangeType = (v: Voucher) => {
    setChangeTypeVoucher(v);
    // Preselect first different type the user is allowed to create.
    const first = VOUCHER_TYPES.find((t) => t.id !== v.voucher_type && canCreateForType(t.id));
    setChangeTypeTarget(first?.id ?? "");
    setChangeTypeReason("");
  };

  const handleChangeType = async () => {
    if (!changeTypeVoucher || !changeTypeTarget) return;
    if (!changeTypeReason.trim()) {
      toast({ title: "Reason required", description: "Please enter a reason for the transfer.", variant: "destructive" });
      return;
    }
    setChangeTypeSaving(true);
    try {
      const res: any = await voucherApi.changeType(changeTypeVoucher.id, changeTypeTarget, changeTypeReason.trim());
      const releasedNum = res?.data?.released_number ?? changeTypeVoucher.voucher_number;
      const newNum = res?.data?.new_voucher?.voucher_number ?? "";
      toast({
        title: "Voucher transferred",
        description: `New ${changeTypeTarget} voucher ${newNum} created. Released ${releasedNum} → next same-type entry will reuse it.`,
      });
      setChangeTypeVoucher(null);
      fetchData();
    } catch (err: any) {
      toast({ title: "Transfer failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setChangeTypeSaving(false);
    }
  };

  // ============ Bulk actions ============
  // Clear selection whenever the list changes (tab / filters / page / trash toggle).
  useEffect(() => { setSelectedIds(new Set()); }, [typeFilter, showDeleted, debouncedSearch, filterFrom, filterTo, page, perPage]);

  const isBulkDeletable = (v: Voucher) => canDeleteVoucher(v) && !(v as any).deleted_at;
  const isBulkTransferable = (v: Voucher) =>
    !(v as any).deleted_at
    && v.status !== "transferred"
    && !(v as any).source_module
    && evalPerm(v.voucher_type, "edit").allowed;

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(vouchers.map((v) => v.id)) : new Set());
  };

  const selectedVouchers = vouchers.filter((v) => selectedIds.has(v.id));
  const selectedDeletable = selectedVouchers.filter(isBulkDeletable);
  const selectedTransferable = selectedVouchers.filter(isBulkTransferable);

  const runBulkDelete = async () => {
    if (selectedDeletable.length === 0) return;
    const reason = bulkReason.trim() || "Bulk delete";
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const v of selectedDeletable) {
      try { await voucherApi.deleteApproved(v.id, reason); ok++; }
      catch { fail++; }
    }
    setBulkBusy(false);
    setBulkDeleteOpen(false);
    setBulkReason("");
    setSelectedIds(new Set());
    toast({ title: "Bulk delete complete", description: `${ok} moved to trash${fail ? `, ${fail} failed` : ""}.`, variant: fail ? "destructive" : "default" });
    fetchData();
  };

  const runBulkChangeType = async () => {
    if (!bulkTargetType || selectedTransferable.length === 0) return;
    if (!bulkReason.trim()) { toast({ title: "Reason required", variant: "destructive" }); return; }
    const eligible = selectedTransferable.filter((v) => v.voucher_type !== bulkTargetType && canCreateForType(bulkTargetType));
    if (eligible.length === 0) { toast({ title: "Nothing to transfer", description: "Selected vouchers are already of the target type or you cannot create it.", variant: "destructive" }); return; }
    setBulkBusy(true);
    let ok = 0, fail = 0;
    for (const v of eligible) {
      try { await voucherApi.changeType(v.id, bulkTargetType, bulkReason.trim()); ok++; }
      catch { fail++; }
    }
    setBulkBusy(false);
    setBulkChangeOpen(false);
    setBulkTargetType("");
    setBulkReason("");
    setSelectedIds(new Set());
    toast({ title: "Bulk transfer complete", description: `${ok} transferred${fail ? `, ${fail} failed` : ""}.`, variant: fail ? "destructive" : "default" });
    fetchData();
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
          {allowedTypes.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  New Voucher
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Select Voucher Type</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {allowedTypes.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onSelect={async () => {
                      const check = evalPerm(t.id, "create");
                      if (!check.allowed) {
                        toast({
                          title: "Permission denied",
                          description: `${check.reason} (ref: ${check.correlationId})`,
                          variant: "destructive",
                        });
                        return;
                      }
                      setNewVoucherType(t.id);
                      try { localStorage.setItem(LAST_NEW_TYPE_KEY, t.id); } catch { /* ignore */ }
                      try {
                        await logAudit({
                          userId: user?.id,
                          module: "accounting",
                          action: "voucher_type_approved",
                          newData: { voucher_type: t.id, approved_at: new Date().toISOString() },
                        });
                      } catch { /* ignore */ }
                      openCreate();
                    }}
                  >
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 mr-2 text-xs font-mono font-semibold bg-primary/10 text-primary">
                      {t.prefix}
                    </span>
                    {t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {!dialogOpen && (allowedTypes.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">You do not have permission to view any voucher types.</div>
      ) : (
      <div>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Voucher Type</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Vouchers</SelectItem>
                    {allowedTypes.map((vt) => (
                      <SelectItem key={vt.id} value={vt.id}>{vt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Search</Label>
                <Input
                  placeholder="Voucher #, ledger name, amount, or description"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-72 h-9"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">From</Label>
                <DateInput value={filterFrom} onChange={(v) => setFilterFrom(v)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <DateInput value={filterTo} onChange={(v) => setFilterTo(v)} />
              </div>
              {(filterFrom || filterTo || debouncedSearch.trim()) && (
                <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearchQuery(""); setFilterFrom(""); setFilterTo(""); }}>
                  Clear
                </Button>
              )}
              <div className="ml-auto flex items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Page size</Label>
                  <Select value={String(perPage)} onValueChange={(v) => setPerPage(Number(v))}>
                    <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            {selectedIds.size > 0 && (
              <div className="mb-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span className="font-medium">{selectedIds.size} selected</span>
                <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} disabled={bulkBusy}>Clear</Button>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" disabled={bulkBusy || selectedTransferable.length === 0} onClick={() => { setBulkTargetType(""); setBulkReason(""); setBulkChangeOpen(true); }}>
                    <Shuffle className="w-3.5 h-3.5 mr-1" /> Change Type ({selectedTransferable.length})
                  </Button>
                  <Button size="sm" variant="destructive" disabled={bulkBusy || selectedDeletable.length === 0} onClick={() => { setBulkReason(""); setBulkDeleteOpen(true); }}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete ({selectedDeletable.length})
                  </Button>
                </div>
              </div>
            )}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={vouchers.length > 0 && selectedIds.size === vouchers.length}
                          onCheckedChange={(c) => toggleAll(!!c)}
                          aria-label="Select all vouchers"
                        />
                      </TableHead>
                      <TableHead>Voucher #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Ledger / Accounts</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Entered By</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-56">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
                    ) : vouchers.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">{debouncedSearch.trim() || filterFrom || filterTo ? "No vouchers match your filters" : "No vouchers yet"}</TableCell></TableRow>
                    ) : vouchers.map((v) => (
                      <TableRow key={v.id} data-state={selectedIds.has(v.id) ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(v.id)}
                            onCheckedChange={(c) => toggleRow(v.id, !!c)}
                            aria-label={`Select voucher ${v.voucher_number}`}
                          />
                        </TableCell>
                        <TableCell className="font-geist-mono text-xs font-medium">{v.voucher_number}</TableCell>
                        <TableCell>
                          {(() => {
                            const vt = VOUCHER_TYPES.find((t) => t.id === v.voucher_type);
                            const styles: Record<string, string> = {
                              journal: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
                              payment: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
                              receipt: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
                              contra: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
                            };
                            return (
                              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${styles[v.voucher_type] || "bg-muted text-muted-foreground"}`} title={vt?.label || v.voucher_type}>
                                {vt?.prefix || v.voucher_type}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-sm">{formatDateDMY(v.voucher_date)}</TableCell>
                        <TableCell className="text-sm">{(voucherAccountsMap[v.id] || []).length > 0 ? (voucherAccountsMap[v.id] || []).join(", ") : <span className="text-muted-foreground italic">No ledger entries</span>}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{v.description || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{fc(v.total_amount)}</TableCell>
                        <TableCell className="text-sm">{v.creator?.name || v.creator?.username || v.creator_name || <span className="text-muted-foreground italic">—</span>}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {statusBadge(v.status)}
                            {v.status === "approved" && <Lock className="w-3 h-3 text-muted-foreground" />}
                          </div>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const editEval = evalPerm(v.voucher_type, "edit");
                            const editAllowed = editEval.allowed;
                            const isDeleted = Boolean((v as any).deleted_at);
                            const canReverse = v.status === "approved" && isSuperAdmin;
                            const canChangeType = !isDeleted
                              && v.status !== "transferred"
                              && !(v as any).source_module
                              && editEval.allowed
                              && VOUCHER_TYPES.some((t) => t.id !== v.voucher_type && canCreateForType(t.id));
                            const canRestore = isSuperAdmin && isDeleted;
                            const canPurge = isSuperAdmin && isDeleted;
                            const canDelete = canDeleteVoucher(v) && !isDeleted;
                            const canApproveReject = v.status === "pending" && canEditForType(v.voucher_type);

                            const onEdit = () => {
                              if (editAllowed) return openEdit(v);
                              logVoucherPermissionDenial({
                                userId: user?.id,
                                voucherType: v.voucher_type as VoucherType,
                                voucherId: v.id,
                                action: "edit",
                                evaluation: editEval,
                              });
                              toast({
                                title: "Edit not allowed",
                                description: `${editEval.reason} (ref: ${editEval.correlationId})`,
                                variant: "destructive",
                              });
                            };

                            return (
                              <VoucherRowActions
                                voucherNumber={v.voucher_number}
                                canEdit={editAllowed}
                                editDeniedReason={editAllowed ? undefined : `${editEval.reason} (ref: ${editEval.correlationId})`}
                                editPermissionCid={editEval.correlationId}
                                canReverse={canReverse}
                                canChangeType={canChangeType}
                                canApproveReject={canApproveReject}
                                canDelete={canDelete}
                                canRestore={canRestore}
                                canPurge={canPurge}
                                onView={() => openView(v)}
                                onEdit={onEdit}
                                onPrint={() => openPrintVoucher(v)}
                                onHistory={() => { setAuditRecordId(v.id); setAuditOpen(true); }}
                                onApprove={() => handleApprove(v)}
                                onReject={() => handleReject(v)}
                                onReverse={() => openSuperAdminAction("reverse", v)}
                                onChangeType={() => openChangeType(v)}
                                onDelete={() => openSuperAdminAction("delete", v)}
                                onRestore={() => openSuperAdminAction("restore", v)}
                                onPurge={() => openSuperAdminAction("purge", v)}
                              />
                            );
                          })()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
              <div>
                {totalCount === 0
                  ? "0 results"
                  : `Showing ${(page - 1) * perPage + 1}–${Math.min(page * perPage, totalCount)} of ${totalCount}`}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                <span className="tabular-nums">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
              </div>
            </div>
          </div>
      </div>
      ))}

      {/* Create/Edit Voucher Page */}
      {dialogOpen && (
      <Card className="border-primary/20">
        <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {editingVoucher ? `Edit ${VOUCHER_TYPES.find((v) => v.id === editingVoucher.voucher_type)?.label || "Voucher"} — ${editingVoucher.voucher_number}` : `New ${VOUCHER_TYPES.find((v) => v.id === newVoucherType)?.label}`}
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
                <DateInput value={formDate} onChange={handleFormDateChange} />
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
                <Select value={formFinYear} onValueChange={(v) => { setFormFinYear(v); setManualFinYear(true); }}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {finYears
                      .filter((f) => f.is_active || f.id === formFinYear)
                      .map((f) => <SelectItem key={f.id} value={f.id}>{f.name}{!f.is_active ? " (Inactive)" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                {(() => {
                  const sel = finYears.find((f) => f.id === formFinYear);
                  return sel && !sel.is_active ? (
                    <p className="text-xs text-destructive mt-1">
                      ⚠ {sel.name} is inactive — posting is blocked until it is activated.
                    </p>
                  ) : null;
                })()}
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
                      const dbg = entry.account_id ? debugMap.get(entry.account_id) : undefined;
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
                              Curr Bal : {bal ? formatSignedBalance(bal.signed, fc) : ""}
                            </div>
                            {import.meta.env.DEV && dbg && (
                              <div className="mt-1 rounded border border-dashed border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20 px-2 py-1 text-[10px] font-mono leading-tight text-amber-900 dark:text-amber-200">
                                <div>DEBUG · type={dbg.account_type ?? "—"}</div>
                                <div>Opening: {dbg.opening.toFixed(2)}</div>
                                <div>+ Credit: {dbg.credit.toFixed(2)}</div>
                                <div>− Debit:  {dbg.debit.toFixed(2)}</div>
                                <div>= Closing: {dbg.closing.toFixed(2)}</div>
                              </div>
                            )}
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
            {(() => {
              const _sel = finYears.find((f) => f.id === formFinYear);
              const fyInactive = !!_sel && !_sel.is_active;
              const postDisabled = saving || !isBalanced || fyInactive;
              const postTitle = fyInactive ? `${_sel!.name} is inactive — posting blocked` : undefined;
              return editingVoucher?.status === "approved" ? (
                <Button onClick={() => handleSave(false)} disabled={postDisabled} title={postTitle}>Save Changes</Button>
              ) : (
                <>
                  <Button variant="outline" className="border-amber-500 bg-amber-100 text-amber-900 hover:bg-amber-200 hover:text-amber-900 dark:bg-amber-500/20 dark:text-amber-100 dark:border-amber-400/60 dark:hover:bg-amber-500/30" onClick={() => handleSave(false)} disabled={saving || !isBalanced}>Save as Draft</Button>
                  <Button onClick={() => handleSave(true)} disabled={postDisabled} title={postTitle}>Submit for Approval</Button>
                  <Button variant="default" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleSave(true, true)} disabled={postDisabled} title={postTitle}>Submit &amp; New</Button>
                </>
              );
            })()}
          </div>
        </CardContent>
      </Card>
      )}

      {/* New Voucher Type Picker (2-step: choose → preview → approve) */}
      <Dialog
        open={newTypePickerOpen}
        onOpenChange={(open) => {
          setNewTypePickerOpen(open);
          if (!open) setPickerPreviewType(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {(() => {
            const creatable = VOUCHER_TYPES.filter((t) => canCreateForType(t.id));
            const TYPE_DESCRIPTIONS: Record<string, string> = {
              journal: "Non-cash adjustment. Post debit/credit across any ledger accounts (accruals, transfers, corrections).",
              payment: "Records outgoing cash/bank payment to a supplier, expense, or other party.",
              receipt: "Records incoming cash/bank receipt from a customer or other source.",
              contra: "Internal transfer between cash and bank (or bank to bank) accounts.",
            };
            if (pickerPreviewType) {
              const t = VOUCHER_TYPES.find((x) => x.id === pickerPreviewType);
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>Confirm New {t?.label}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div className="rounded-md border bg-muted/40 p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold bg-primary/10 text-primary">{t?.prefix}</span>
                        <span className="font-medium">{t?.label}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{TYPE_DESCRIPTIONS[pickerPreviewType]}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Approving will open a blank {t?.label.toLowerCase()} entry form. Nothing is posted until you save.
                    </p>
                  </div>
                  <DialogFooter className="gap-2 sm:justify-between">
                    <Button
                      variant="ghost"
                      onClick={() => { setNewTypePickerOpen(false); setPickerPreviewType(null); }}
                    >
                      Cancel
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setPickerPreviewType(null)}>Back</Button>
                      <Button
                        onClick={async () => {
                          // Final permission check — role may have changed since dialog opened.
                          const type = pickerPreviewType;
                          if (!type || !VOUCHER_TYPES.some((v) => v.id === type)) {
                            toast({ title: "Invalid voucher type", description: "Please pick a valid type.", variant: "destructive" });
                            setPickerPreviewType(null);
                            return;
                          }
                          const check = evalPerm(type, "create");
                          if (!check.allowed) {
                            toast({
                              title: "Permission denied",
                              description: `${check.reason} (ref: ${check.correlationId})`,
                              variant: "destructive",
                            });
                            setPickerPreviewType(null);
                            setNewTypePickerOpen(false);
                            return;
                          }
                          // Persist last chosen type.
                          setNewVoucherType(type);
                          try { localStorage.setItem(LAST_NEW_TYPE_KEY, type); } catch { /* ignore */ }
                          // Audit log the approval decision.
                          try {
                            await logAudit({
                              userId: user?.id,
                              module: "accounting",
                              action: "voucher_type_approved",
                              newData: { voucher_type: type, approved_at: new Date().toISOString() },
                            });
                          } catch { /* audit failures must never block */ }
                          setPickerPreviewType(null);
                          setNewTypePickerOpen(false);
                          openCreate();
                        }}
                      >
                        <Check className="w-4 h-4 mr-1" /> Approve &amp; Continue
                      </Button>
                    </div>
                  </DialogFooter>
                </>
              );
            }
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Select Voucher Type</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 py-2">
                  {creatable.map((t) => {
                    const isLast = t.id === newVoucherType;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setPickerPreviewType(t.id)}
                        className={`flex flex-col items-start gap-1 rounded-md border p-4 text-left transition-colors hover:bg-accent hover:border-primary/50 ${isLast ? "border-primary/60 bg-primary/5" : ""}`}
                      >
                        <span className="text-xs font-mono font-semibold text-primary">{t.prefix}</span>
                        <span className="font-medium">{t.label}</span>
                        {isLast && <span className="text-[10px] text-muted-foreground">Last used</span>}
                      </button>
                    );
                  })}
                  {creatable.length === 0 && (
                    <div className="col-span-2 text-center text-muted-foreground text-sm py-4">
                      You do not have permission to create any voucher type.
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

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
          {(superAdminAction === "delete" || superAdminAction === "purge") && (
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <div className="font-medium">
                  {superAdminAction === "purge" ? "Permanent deletion — cannot be undone" : "This will move the voucher to trash"}
                </div>
                <div className="text-destructive/90">
                  {superAdminAction === "purge"
                    ? "The voucher and all its ledger entries will be erased from the database. Reports and audit trails will lose access to this record."
                    : "The voucher will be hidden from reports and ledgers. A Super Admin can restore it later. The action is written to the audit log."}
                  {actionVoucher && (
                    <> Type: <strong>{actionVoucher.voucher_type}</strong> · Amount: <strong>{fc(actionVoucher.total_amount)}</strong>.</>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="voucher-action-reason">Reason (required)</Label>
            <Textarea
              id="voucher-action-reason"
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
        module={["accounting", "accounting_vouchers", "vouchers"]}
        recordId={auditRecordId}
        title={auditRecordId ? "Voucher History" : "Vouchers Audit Log"}
      />

      {/* Change Type (Transfer) Dialog */}
      <Dialog open={!!changeTypeVoucher} onOpenChange={(o) => !o && setChangeTypeVoucher(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Voucher Type (Transfer)</DialogTitle>
          </DialogHeader>
          {changeTypeVoucher && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                <div><span className="font-medium text-foreground">{changeTypeVoucher.voucher_number}</span> — currently <span className="uppercase">{changeTypeVoucher.voucher_type}</span></div>
                <div className="mt-1 text-xs">
                  The old voucher will be marked as <b>transferred</b> (soft-deleted). Its serial <b>{changeTypeVoucher.voucher_number}</b> will be released and used by the next new <b>{changeTypeVoucher.voucher_type}</b> voucher.
                </div>
              </div>
              <div>
                <Label>New Type</Label>
                <Select value={changeTypeTarget} onValueChange={setChangeTypeTarget}>
                  <SelectTrigger><SelectValue placeholder="Select new type" /></SelectTrigger>
                  <SelectContent>
                    {VOUCHER_TYPES.filter((t) => t.id !== changeTypeVoucher.voucher_type && canCreateForType(t.id)).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reason <span className="text-destructive">*</span></Label>
                <Textarea
                  value={changeTypeReason}
                  onChange={(e) => setChangeTypeReason(e.target.value)}
                  placeholder="Why is this voucher being transferred to a different type?"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeTypeVoucher(null)} disabled={changeTypeSaving}>Cancel</Button>
            <Button
              onClick={handleChangeType}
              disabled={changeTypeSaving || !changeTypeTarget || !changeTypeReason.trim()}
            >
              {changeTypeSaving ? "Transferring..." : "Transfer Voucher"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(o) => !bulkBusy && setBulkDeleteOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete {selectedDeletable.length} voucher(s)?</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">
            Selected vouchers will be moved to the trash. Only vouchers you have permission to delete will be processed.
          </div>
          <div className="space-y-1">
            <Label>Reason (optional)</Label>
            <Textarea value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Bulk delete" rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={bulkBusy}>Cancel</Button>
            <Button variant="destructive" onClick={runBulkDelete} disabled={bulkBusy || selectedDeletable.length === 0}>
              {bulkBusy ? "Deleting..." : `Delete ${selectedDeletable.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk change type */}
      <Dialog open={bulkChangeOpen} onOpenChange={(o) => !bulkBusy && setBulkChangeOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change type for {selectedTransferable.length} voucher(s)</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">
            Each selected voucher will be soft-deleted (marked <b>transferred</b>) and re-created under the target type. Original serials are released for reuse.
          </div>
          <div className="space-y-1">
            <Label>Target voucher type</Label>
            <Select value={bulkTargetType} onValueChange={setBulkTargetType}>
              <SelectTrigger><SelectValue placeholder="Select target type" /></SelectTrigger>
              <SelectContent>
                {VOUCHER_TYPES.filter((t) => canCreateForType(t.id)).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Reason (required)</Label>
            <Textarea value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Reason for bulk transfer" rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkChangeOpen(false)} disabled={bulkBusy}>Cancel</Button>
            <Button onClick={runBulkChangeType} disabled={bulkBusy || !bulkTargetType || !bulkReason.trim()}>
              {bulkBusy ? "Transferring..." : "Transfer Selected"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>


  );
};

export default AccountingVouchers;
