import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getApiBaseUrl, getLaravelAuthHeaders, isLaravelMode } from "@/lib/laravel-auth";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Download, Upload, Database, Clock, Trash2, AlertTriangle, CheckCircle, XCircle, Settings, RefreshCw, Shield, Cloud, HardDrive, Sparkles, FileJson, Loader2 } from "lucide-react";

const API_BASE = getApiBaseUrl() || "";
const USE_LARAVEL = isLaravelMode();

interface BackupRecord {
  id: string; file_name: string; file_size: number; backup_type: string; format: string;
  status: string; tables_count: number; records_count: number; storage_path: string | null;
  gdrive_file_id?: string | null; gdrive_view_link?: string | null;
  created_at: string; error_message: string | null;
}

interface BackupSettings {
  auto_backup_enabled: boolean; schedule_interval: string; retention_days: number;
  last_auto_backup_at: string | null;
  gdrive_enabled?: boolean;
  gdrive_client_id?: string | null;
  gdrive_client_secret_set?: boolean;
  gdrive_refresh_token_set?: boolean;
  gdrive_account_email?: string | null;
  gdrive_folder_id?: string | null;
  gdrive_folder_name?: string | null;
  gdrive_format?: string | null;
  last_gdrive_backup_at?: string | null;
  last_gdrive_error?: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function getAuthHeaders(): Record<string, string> {
  return getLaravelAuthHeaders();
}

async function laravelApiCall(url: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { ...getAuthHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || "Request failed");
  }
  return res;
}

async function logDemoAudit(action: "demo_seed_full" | "demo_seed_reset" | "demo_seed_transactions_only", mode: string, status: "started" | "success" | "failed", details: string, user: { id?: string; name?: string; email?: string } | null) {
  try {
    await dataClient.from("audit_log").insert({
      user_id: user?.id ?? null,
      user_name: user?.name || user?.email || "unknown",
      module: "backup",
      action,
      record_id: null,
      details: `[${status}] mode=${mode} ${details}`.slice(0, 1000),
    });
  } catch { /* ignore audit failure */ }
}

const BackupPage = () => {
  const { toast } = useToast();
  const { isSuperAdmin, user, profile } = useAuth();
  const currentUser = { id: user?.id, name: (profile as any)?.name, email: user?.email };
  const [activeTab, setActiveTab] = useState("local");
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<BackupRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [importingDemo, setImportingDemo] = useState(false);
  const [demoProgress, setDemoProgress] = useState(0);
  const [demoStatus, setDemoStatus] = useState<string>("");
  const [demoResults, setDemoResults] = useState<Array<{ section: string; label: string; attempted: number; inserted: number; skipped: number; status: string; error?: string }> | null>(null);
  const [demoOverall, setDemoOverall] = useState<"success" | "partial" | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmResetDemo, setConfirmResetDemo] = useState(false);
  const [backupFormat, setBackupFormat] = useState<"sql" | "json">("sql");
  const [uploadToDrive, setUploadToDrive] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<any | null>(null);
  const [gdriveClientForm, setGdriveClientForm] = useState({ client_id: "", client_secret: "" });
  const [gdriveAppSetupOpen, setGdriveAppSetupOpen] = useState(false);
  const [connectingGdrive, setConnectingGdrive] = useState(false);
  const [disconnectingGdrive, setDisconnectingGdrive] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPath, setFolderPath] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: "My Drive" }]);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [savingFolder, setSavingFolder] = useState(false);

  // Section key MUST match backend keys returned by DemoConfigImportController.
  const DEMO_SECTIONS: Array<{ key: string; label: string }> = [
    { key: "chart_of_accounts",    label: "Chart of Accounts" },
    { key: "ifrs_account_mapping", label: "IFRS Account Mapping" },
    { key: "purchase_types",       label: "Purchase Types" },
    { key: "purchase_coa_mapping", label: "Purchase COA Mapping" },
    { key: "purchase_settings",    label: "Purchase Settings" },
    { key: "branches",             label: "Branch Management" },
    { key: "financial_years",      label: "Financial Years" },
    { key: "roles_permissions",    label: "Roles & Permissions" },
    { key: "github_deploy_sync",   label: "GitHub Deploy Sync" },
    { key: "number_sequences",     label: "Document Numbering" },
    { key: "page_shortcuts",       label: "Page Shortcuts" },
    { key: "company_settings",     label: "General Settings" },
    { key: "sms_settings",         label: "SMS Integration" },
    { key: "branding",             label: "Branding & White-Label" },
  ];
  const DEMO_STEPS = DEMO_SECTIONS.map(s => s.label);

  const [selectedSections, setSelectedSections] = useState<Record<string, boolean>>(
    () => Object.fromEntries(DEMO_SECTIONS.map(s => [s.key, true]))
  );
  const [isDryRun, setIsDryRun] = useState(false);

  const toggleSection = (key: string) =>
    setSelectedSections(prev => ({ ...prev, [key]: !prev[key] }));
  const setAllSections = (val: boolean) =>
    setSelectedSections(Object.fromEntries(DEMO_SECTIONS.map(s => [s.key, val])));

  const handleImportDemoConfig = async (reset = false, dryRun = false) => {
    if (!isSuperAdmin) {
      toast({ title: "Access Denied", description: "Only Super Admins can run demo import.", variant: "destructive" });
      return;
    }
    const sections = DEMO_SECTIONS.filter(s => selectedSections[s.key]).map(s => s.key);
    if (sections.length === 0) {
      toast({ title: "No sections selected", description: "Please tick at least one section.", variant: "destructive" });
      return;
    }
    setConfirmDemo(false);
    setConfirmResetDemo(false);
    setImportingDemo(true);
    setIsDryRun(dryRun);
    setDemoResults(null);
    setDemoOverall(null);
    setDemoProgress(5);
    setDemoStatus(
      dryRun ? "Running dry-run preview (no changes will be saved)..."
             : reset ? "Resetting configuration tables..." : "Validating Super Admin access..."
    );

    const labels = DEMO_SECTIONS.filter(s => selectedSections[s.key]).map(s => s.label);
    let step = 0;
    const stepTimer = window.setInterval(() => {
      step = Math.min(step + 1, labels.length - 1);
      setDemoStatus(`${dryRun ? "Previewing" : "Importing"}: ${labels[step]}...`);
      setDemoProgress(Math.min(15 + Math.round((step / Math.max(labels.length - 1, 1)) * 70), 85));
    }, 500);

    try {
      const body = { reset, dry_run: dryRun, sections };
      let payload: any = null;
      if (USE_LARAVEL) {
        const res = await fetch(`${API_BASE}/v1/admin/demo/import-config`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        payload = await res.json().catch(() => ({ message: `Failed (HTTP ${res.status})` }));
        if (!res.ok) throw new Error(payload.message || payload.error || `HTTP ${res.status}`);
      } else {
        const { data, error } = await dataClient.functions.invoke("import-demo-config", { body });
        if (error) throw error;
        payload = data;
        if (payload && payload.success === false && !payload.results) throw new Error(payload.error || "Import failed");
      }

      const results = payload?.results || payload?.data?.results || null;
      const overall: "success" | "partial" = payload?.overall || payload?.data?.overall || (payload?.success ? "success" : "partial");
      setDemoResults(results);
      setDemoOverall(overall);
      setDemoProgress(100);
      const hasFailures = results ? results.some((r: any) => r.status === "failed") : overall !== "success";
      setDemoStatus(
        dryRun ? "Dry-run preview ready. Review the table below; nothing has been saved."
               : hasFailures ? "Import completed with warnings." : "Import completed successfully."
      );


      const totalIns = results ? results.reduce((n: number, r: any) => n + (r.inserted || 0), 0) : 0;
      const totalUpd = results ? results.reduce((n: number, r: any) => n + (r.skipped || 0), 0) : 0;
      const failed = results ? results.filter((r: any) => r.status === "failed") : [];
      const partial = results ? results.filter((r: any) => r.status === "partial") : [];
      const hardFail = failed.length > 0;
      const effective: "success" | "partial" = hardFail ? "partial" : "success";
      setDemoOverall(effective);
      toast({
        title: dryRun
          ? "Dry-run preview complete"
          : effective === "success"
              ? (partial.length ? "Demo configuration imported (some sections skipped)" : "Demo configuration imported")
              : "Demo import finished with warnings",
        description: dryRun
          ? `Would insert ${totalIns} new rows, update ${totalUpd} existing across ${results?.length ?? sections.length} sections.`
          : `${totalIns} new / ${totalUpd} updated across ${results?.length ?? sections.length} sections.`
            + (hardFail ? ` Failed: ${failed.map((r: any) => `${r.label} (${r.error || "unknown"})`).join("; ")}` : "")
            + (partial.length ? ` Skipped: ${partial.map((r: any) => r.label).join(", ")}.` : ""),
        variant: effective === "success" ? "default" : "destructive",
      });

    } catch (err: any) {
      setDemoProgress(100);
      setDemoStatus(dryRun ? "Dry-run failed." : "Import failed.");
      toast({ title: dryRun ? "Preview failed" : "Import failed", description: err.message, variant: "destructive" });
    } finally {
      window.clearInterval(stepTimer);
      setImportingDemo(false);
    }
  };

  const [seedingFull, setSeedingFull] = useState(false);
  const [fullSeedLog, setFullSeedLog] = useState<string | null>(null);
  const [resettingDemo, setResettingDemo] = useState(false);

  const handleFullDemoSeed = async () => {
    if (!isSuperAdmin) {
      toast({ title: "Access Denied", description: "Super Admin only.", variant: "destructive" });
      return;
    }
    if (!confirm("This will WIPE all transactions/masters and seed a full year of demo data across Accounts, Bank, Inventory, Purchase, Manufacturing, Sales (BD VAT) and HRM for 2 branches (Head Office, Factory). Continue?")) return;
    setSeedingFull(true);
    setFullSeedLog(null);
    await logDemoAudit("demo_seed_full", "full", "started", "Wipe & Seed Full Demo Data initiated", currentUser);
    try {
      let data: any;
      if (USE_LARAVEL) {
        const res = await fetch(`${API_BASE}/v1/admin/demo/seed`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "full" }),
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      } else {
        const r = await dataClient.functions.invoke("reset-and-seed-demo", { body: {} });
        if (r.error) throw r.error;
        data = r.data;
        if (data?.success === false) throw new Error(data.error || "Seed failed");
      }
      setFullSeedLog(JSON.stringify(data, null, 2));
      toast({ title: "✓ Demo data seeded", description: data?.message || `Completed${data?.elapsedMs ? ` in ${data.elapsedMs}ms` : ""}.` });
      await logDemoAudit("demo_seed_full", "full", "success", data?.message || "Seed completed", currentUser);
    } catch (err: any) {
      toast({ title: "Seed failed", description: err.message, variant: "destructive" });
      setFullSeedLog(String(err.message || err));
      await logDemoAudit("demo_seed_full", "full", "failed", err.message || String(err), currentUser);
    } finally {
      setSeedingFull(false);
    }
  };

  const handleResetDemoOnly = async () => {
    if (!isSuperAdmin) {
      toast({ title: "Access Denied", description: "Super Admin only.", variant: "destructive" });
      return;
    }
    if (!confirm(
      "This will WIPE all demo transactions and master data (vouchers, invoices, POs, stock, payroll, parties, items, employees, etc.).\n\n" +
      "PROTECTED (not touched): Chart of Accounts, IFRS Mapping, Document Numbering, Page Shortcuts, General Settings, SMS Integration, Branding, GitHub Deploy Sync.\n\nContinue?"
    )) return;
    setResettingDemo(true);
    setFullSeedLog(null);
    await logDemoAudit("demo_seed_reset", "reset", "started", "Reset Demo Data Only initiated", currentUser);
    try {
      let data: any;
      if (USE_LARAVEL) {
        const res = await fetch(`${API_BASE}/v1/admin/demo/seed`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "reset" }),
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      } else {
        const r = await dataClient.functions.invoke("reset-and-seed-demo", { body: { mode: "reset" } });
        if (r.error) throw r.error;
        data = r.data;
        if (data?.success === false) throw new Error(data.error || "Reset failed");
      }
      setFullSeedLog(JSON.stringify(data, null, 2));
      toast({ title: "✓ Demo data reset", description: data?.message || `Completed${data?.elapsedMs ? ` in ${data.elapsedMs}ms` : ""}.` });
      await logDemoAudit("demo_seed_reset", "reset", "success", data?.message || "Reset completed", currentUser);
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
      setFullSeedLog(String(err.message || err));
      await logDemoAudit("demo_seed_reset", "reset", "failed", err.message || String(err), currentUser);
    } finally {
      setResettingDemo(false);
    }
  };

  const [resettingTxn, setResettingTxn] = useState(false);
  const [dryRunTxn, setDryRunTxn] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const [auditTablesOpen, setAuditTablesOpen] = useState(false);
  const [auditTablesData, setAuditTablesData] = useState<any | null>(null);
  const [loadingAuditTables, setLoadingAuditTables] = useState(false);
  const [exportingAuditLog, setExportingAuditLog] = useState(false);

  const handleResetTransactionsOnly = async (dryRun: boolean = false) => {
    if (!isSuperAdmin) {
      toast({ title: "Access Denied", description: "Super Admin only.", variant: "destructive" });
      return;
    }
    if (!dryRun && !confirm(
      "This will WIPE only TRANSACTIONAL data (vouchers, invoices, POs, stock movements, payroll, attendance, payments, etc.).\n\n" +
      "PRESERVED: All masters (customers, suppliers, products, items, employees, salary structures, BOMs) AND all configuration (Chart of Accounts, branches, financial years, units, categories, warehouses, departments, designations, leave types, company settings, users, roles, document numbering, page shortcuts, branding).\n\nContinue?"
    )) return;
    if (dryRun) { setDryRunTxn(true); setDryRunResult(null); } else { setResettingTxn(true); }
    setFullSeedLog(null);
    await logDemoAudit("demo_seed_transactions_only", "transactions", "started", dryRun ? "Dry-run preview initiated" : "Reset Transactions Only initiated", currentUser);
    try {
      let data: any;
      if (USE_LARAVEL) {
        const res = await fetch(`${API_BASE}/v1/admin/demo/seed`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "transactions", dry_run: dryRun }),
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      } else {
        const r = await dataClient.functions.invoke("reset-and-seed-demo", { body: { mode: "transactions", dry_run: dryRun } });
        if (r.error) throw r.error;
        data = r.data;
        if (data?.success === false) throw new Error(data.error || "Reset failed");
      }
      if (dryRun) {
        const preview = data?.data?.preview ?? data?.preview ?? data;
        setDryRunResult(preview);
        toast({ title: "🔍 Dry-run complete", description: `${preview?.tables_to_wipe ?? 0} tables / ${preview?.total_rows ?? 0} rows would be cleared. Nothing was deleted.` });
        await logDemoAudit("demo_seed_transactions_only", "transactions", "success", `Dry-run: ${preview?.total_rows ?? 0} rows would be cleared`, currentUser);
      } else {
        setFullSeedLog(JSON.stringify(data, null, 2));
        toast({ title: "✓ Transactional data cleared", description: data?.message || "Masters & configuration preserved." });
        await logDemoAudit("demo_seed_transactions_only", "transactions", "success", data?.message || "Reset completed", currentUser);
      }
    } catch (err: any) {
      toast({ title: dryRun ? "Dry-run failed" : "Reset failed", description: err.message, variant: "destructive" });
      if (!dryRun) setFullSeedLog(String(err.message || err));
      await logDemoAudit("demo_seed_transactions_only", "transactions", "failed", err.message || String(err), currentUser);
    } finally {
      if (dryRun) setDryRunTxn(false); else setResettingTxn(false);
    }
  };

  const handleOpenAuditTables = async () => {
    if (!isSuperAdmin) {
      toast({ title: "Access Denied", description: "Super Admin only.", variant: "destructive" });
      return;
    }
    setAuditTablesOpen(true);
    setLoadingAuditTables(true);
    setAuditTablesData(null);
    try {
      if (USE_LARAVEL) {
        const res = await fetch(`${API_BASE}/v1/admin/demo/audit-tables`, { headers: { ...getAuthHeaders() } });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
        setAuditTablesData(json.data ?? json);
      } else {
        const r = await dataClient.functions.invoke("reset-and-seed-demo", { body: { mode: "audit" } });
        if (r.error) throw r.error;
        setAuditTablesData(r.data?.data ?? r.data);
      }
    } catch (err: any) {
      toast({ title: "Failed to load table audit", description: err.message, variant: "destructive" });
    } finally {
      setLoadingAuditTables(false);
    }
  };

  const handleExportAuditLog = async () => {
    if (!isSuperAdmin) {
      toast({ title: "Access Denied", description: "Super Admin only.", variant: "destructive" });
      return;
    }
    setExportingAuditLog(true);
    try {
      let csv: string;
      if (USE_LARAVEL) {
        const res = await fetch(`${API_BASE}/v1/admin/demo/audit-log/export`, { headers: { ...getAuthHeaders() } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        csv = await res.text();
      } else {
        const { data, error } = await dataClient
          .from("audit_log")
          .select("created_at,user_name,action,details,ip_address,user_agent")
          .eq("module", "backup")
          .in("action", ["demo_seed_full","demo_seed_reset","demo_seed_transactions_only","demo_reset","demo_reset_transactions_only"])
          .order("created_at", { ascending: false })
          .limit(5000);
        if (error) throw error;
        const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        csv = ["created_at,user_name,action,details,ip_address,user_agent"]
          .concat((data || []).map(r => [r.created_at, r.user_name, r.action, r.details, r.ip_address, r.user_agent].map(esc).join(",")))
          .join("\n");
      }
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `demo-seed-audit-${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "✓ Audit log exported" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExportingAuditLog(false);
    }
  };






  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      if (USE_LARAVEL) {
        const res = await laravelApiCall("/v1/backups");
        const result = await res.json();
        setHistory(result.data || []);
      } else {
        const { data, error } = await dataClient
          .from("backup_history")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        setHistory((data || []) as BackupRecord[]);
      }
    } catch { /* ignore */ }
    setLoadingHistory(false);
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      if (USE_LARAVEL) {
        const res = await laravelApiCall("/v1/backups/settings");
        const result = await res.json();
        if (result.data) setSettings(result.data);
      } else {
        const { data, error } = await dataClient
          .from("backup_settings")
          .select("*")
          .eq("id", "default")
          .maybeSingle();
        if (error) throw error;
        if (data) {
          setSettings({
            auto_backup_enabled: data.auto_backup_enabled,
            schedule_interval: data.schedule_interval,
            retention_days: data.retention_days,
            last_auto_backup_at: data.last_auto_backup_at,
          });
        } else {
          setSettings({ auto_backup_enabled: false, schedule_interval: "daily", retention_days: 30, last_auto_backup_at: null });
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchHistory();
    fetchSettings();
  }, [fetchHistory, fetchSettings]);

  // Handle the redirect back from Google's OAuth consent screen
  // (BackupController::gdriveCallback sends the browser to
  // /admin/backup?gdrive=connected or ?gdrive=error&message=...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gdrive = params.get("gdrive");
    if (!gdrive) return;
    if (gdrive === "connected") {
      toast({ title: "Google Drive connected" });
      fetchSettings();
    } else if (gdrive === "error") {
      toast({ title: "Google Drive connection failed", description: params.get("message") || "Please try again.", variant: "destructive" });
    }
    params.delete("gdrive");
    params.delete("message");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveGdriveClientCredentials = async () => {
    if (!gdriveClientForm.client_id && !gdriveClientForm.client_secret) {
      toast({ title: "Enter a Client ID and Client Secret", variant: "destructive" });
      return;
    }
    setSavingSettings(true);
    try {
      const body: Record<string, any> = {};
      if (gdriveClientForm.client_id) body.gdrive_client_id = gdriveClientForm.client_id;
      if (gdriveClientForm.client_secret) body.gdrive_client_secret = gdriveClientForm.client_secret;
      await laravelApiCall("/v1/backups/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({ title: "Google OAuth app credentials saved" });
      setGdriveClientForm({ client_id: "", client_secret: "" });
      setGdriveAppSetupOpen(false);
      fetchSettings();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
    setSavingSettings(false);
  };

  const handleConnectGdrive = async () => {
    setConnectingGdrive(true);
    try {
      const res = await laravelApiCall("/v1/backups/gdrive/auth-url");
      const result = await res.json();
      const url = result.data?.url;
      if (!url) throw new Error("Could not get a Google sign-in link.");
      window.location.href = url;
    } catch (err: any) {
      toast({ title: "Could not start Google sign-in", description: err.message, variant: "destructive" });
      setConnectingGdrive(false);
    }
  };

  const handleDisconnectGdrive = async () => {
    if (!confirm("Disconnect this Google account? Auto-backup uploads will stop until you reconnect.")) return;
    setDisconnectingGdrive(true);
    try {
      await laravelApiCall("/v1/backups/gdrive/disconnect", { method: "POST" });
      toast({ title: "Google Drive disconnected" });
      fetchSettings();
    } catch (err: any) {
      toast({ title: "Disconnect failed", description: err.message, variant: "destructive" });
    }
    setDisconnectingGdrive(false);
  };

  const loadFolders = async (parentId: string | null) => {
    setLoadingFolders(true);
    try {
      const qs = parentId ? `?parent_id=${encodeURIComponent(parentId)}` : "";
      const res = await laravelApiCall(`/v1/backups/gdrive/folders${qs}`);
      const result = await res.json();
      setFolders(result.data || []);
    } catch (err: any) {
      toast({ title: "Could not load folders", description: err.message, variant: "destructive" });
    }
    setLoadingFolders(false);
  };

  const openFolderPicker = () => {
    setFolderPath([{ id: null, name: "My Drive" }]);
    setFolderPickerOpen(true);
    loadFolders(null);
  };

  const navigateIntoFolder = (folder: { id: string; name: string }) => {
    setFolderPath((p) => [...p, folder]);
    loadFolders(folder.id);
  };

  const navigateToBreadcrumb = (index: number) => {
    setFolderPath((p) => p.slice(0, index + 1));
    loadFolders(folderPath[index].id);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const parentId = folderPath[folderPath.length - 1].id;
      await laravelApiCall("/v1/backups/gdrive/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim(), parent_id: parentId }),
      });
      setNewFolderName("");
      loadFolders(parentId);
    } catch (err: any) {
      toast({ title: "Could not create folder", description: err.message, variant: "destructive" });
    }
    setCreatingFolder(false);
  };

  const handleSelectFolder = async (folder: { id: string; name: string }) => {
    setSavingFolder(true);
    try {
      await laravelApiCall("/v1/backups/gdrive/select-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folder.id, folder_name: folder.name }),
      });
      toast({ title: `Backup folder set to "${folder.name}"` });
      setFolderPickerOpen(false);
      fetchSettings();
    } catch (err: any) {
      toast({ title: "Could not select folder", description: err.message, variant: "destructive" });
    }
    setSavingFolder(false);
  };

  const handleSelectCurrentFolder = () => {
    const current = folderPath[folderPath.length - 1];
    const target = current.id ? current : { id: "root", name: "My Drive" };
    handleSelectFolder(target);
  };

  const handleCreateBackup = async () => {
    if (!isSuperAdmin) {
      toast({ title: "Access denied", description: "Backup is restricted to Super Admins.", variant: "destructive" });
      return;
    }
    setExporting(true);
    setProgress(20);
    try {
      setProgress(50);
      if (USE_LARAVEL) {
        const res = await laravelApiCall("/v1/backups/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: backupFormat, upload_to_drive: uploadToDrive }),
        });
        const result = await res.json();
        toast({ title: "Backup created", description: `${result.data?.file_name || "Backup"} created successfully.` });
      } else {
        const { data: { session } } = await dataClient.auth.getSession();
        if (!session) throw new Error("Not authenticated");
        const { data, error } = await dataClient.functions.invoke("create-backup", {
          body: { format: backupFormat, backup_type: "manual" },
        });
        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || "Backup failed");

        // Download the SQL content
        if (data?.content) {
          const blob = new Blob([data.content], { type: "text/sql" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = data.file_name || "backup.sql";
          a.click();
          URL.revokeObjectURL(url);
        }
        toast({ title: "Backup created", description: `${data?.file_name || "Backup"} created successfully.` });
      }
      setProgress(100);
      fetchHistory();
    } catch (err: any) {
      toast({ title: "Backup failed", description: err.message, variant: "destructive" });
    } finally {
      setTimeout(() => { setExporting(false); setProgress(0); }, 500);
    }
  };

  const handleDownload = async (record: BackupRecord) => {
    try {
      if (USE_LARAVEL) {
        const res = await fetch(`${API_BASE}/v1/backups/${record.id}/download`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = record.file_name; a.click();
        URL.revokeObjectURL(url);
      } else if (record.storage_path) {
        const { data, error } = await dataClient.storage.from("backups").download(record.storage_path);
        if (error) throw error;
        const url = URL.createObjectURL(data);
        const a = document.createElement("a");
        a.href = url; a.download = record.file_name; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".sql") && !lower.endsWith(".json")) {
      toast({ title: "Invalid file", description: "Only .sql or .json backup files are allowed.", variant: "destructive" });
      e.target.value = ""; return;
    }
    setRestoreFile(file);
    setConfirmRestore(true);
    e.target.value = "";
  };

  const executeRestore = async () => {
    if (!restoreFile) return;
    if (!isSuperAdmin) {
      toast({ title: "Access denied", description: "Restore is restricted to Super Admins.", variant: "destructive" });
      return;
    }
    setConfirmRestore(false);
    setRestoring(true);
    setProgress(20);
    setVerifyResult(null);
    try {
      if (USE_LARAVEL) {
        const formData = new FormData();
        formData.append("sql_file", restoreFile);
        setProgress(50);
        const res = await fetch(`${API_BASE}/v1/backups/restore`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: formData,
        });
        const result = await res.json().catch(() => ({ message: `Restore failed (HTTP ${res.status})` }));
        if (!res.ok || !result.success) throw new Error(result.message || result.error || "Restore failed");
        if (result.data?.verification) setVerifyResult(result.data.verification);
      } else {
        // Read file content and invoke edge function
        const content = await restoreFile.text();
        setProgress(50);
        const { data, error } = await dataClient.functions.invoke("restore-backup", {
          body: { content, sql_content: content, file_name: restoreFile.name },
        });
        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || "Restore failed");
        if (data?.verification) setVerifyResult(data.verification);
      }
      setProgress(100);
      toast({ title: "Restore completed", description: "Database has been restored. See verification report." });
      fetchHistory();
    } catch (err: any) {
      toast({ title: "Restore failed", description: err.message, variant: "destructive" });
    } finally {
      setTimeout(() => { setRestoring(false); setProgress(0); setRestoreFile(null); }, 500);
    }
  };

  const handleDeleteBackup = async (id: string) => {
    try {
      if (USE_LARAVEL) {
        await laravelApiCall(`/v1/backups/${id}`, { method: "DELETE" });
      } else {
        // Get storage path first, then delete
        const record = history.find(r => r.id === id);
        if (record?.storage_path) {
          await dataClient.storage.from("backups").remove([record.storage_path]);
        }
        const { error } = await dataClient.from("backup_history").delete().eq("id", id);
        if (error) throw error;
      }
      setConfirmDelete(null);
      fetchHistory();
      toast({ title: "Backup deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const saveScheduleSettings = async (updates: Partial<BackupSettings>) => {
    setSavingSettings(true);
    try {
      if (USE_LARAVEL) {
        await laravelApiCall("/v1/backups/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
      } else {
        const { error } = await dataClient
          .from("backup_settings")
          .update({ ...updates, updated_at: new Date().toISOString() } as any)
          .eq("id", "default");
        if (error) throw error;
      }
      setSettings(prev => prev ? { ...prev, ...updates } : null);
      toast({ title: "Settings saved" });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
    setSavingSettings(false);
  };

  const uploadBackupToDrive = async (id: string) => {
    if (!USE_LARAVEL) return;
    setUploadingId(id);
    try {
      const res = await fetch(`${API_BASE}/v1/backups/${id}/gdrive-upload`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      const result = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      if (!res.ok || !result.success) throw new Error(result.message || result.error || "Upload failed");
      toast({ title: "Uploaded to Google Drive" });
      fetchSettings();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploadingId(null);
  };


  const statusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge variant="default" className="bg-green-600 text-white"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case "failed": return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default: return <Badge variant="outline"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />In Progress</Badge>;
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
          <p className="text-destructive font-medium">Access Denied</p>
          <p className="text-sm text-muted-foreground">Only Super Admins can access Backup & Restore.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Database className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Backup & Restore (SQL · JSON · Google Drive)</h1>
      </div>

      {(exporting || restoring) && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{exporting ? "Creating SQL backup..." : "Restoring database..."}</p>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="local"><HardDrive className="w-3.5 h-3.5 mr-1.5" />Local Backup</TabsTrigger>
          <TabsTrigger value="gdrive"><Cloud className="w-3.5 h-3.5 mr-1.5" />Google Drive</TabsTrigger>
          <TabsTrigger value="demo"><Sparkles className="w-3.5 h-3.5 mr-1.5" />Demo import</TabsTrigger>
          <TabsTrigger value="settings"><Settings className="w-3.5 h-3.5 mr-1.5" />Settings</TabsTrigger>
          <TabsTrigger value="history"><Clock className="w-3.5 h-3.5 mr-1.5" />History</TabsTrigger>
          <TabsTrigger value="schedule"><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Schedule</TabsTrigger>
        </TabsList>

        {/* Local Backup Tab */}
        <TabsContent value="local">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Download className="w-4 h-4" />Create Database Backup</CardTitle>
                <CardDescription>Export the full database as SQL or JSON</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground space-y-1">
                  <p>• SQL: full DROP/CREATE/INSERT dump (mysqldump if available, PHP fallback otherwise)</p>
                  <p>• JSON: structured per-table dump, ideal for cross-environment imports</p>
                  <p>• File saved to <code>storage/app/backups/</code> as <strong>erp_backup_YYYY_MM_DD_HH_MM.&lt;ext&gt;</strong></p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Format</Label>
                    <Select value={backupFormat} onValueChange={(v) => setBackupFormat(v as "sql" | "json")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sql">SQL (.sql)</SelectItem>
                        <SelectItem value="json">JSON (.json)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2">
                    <Switch id="upload-drive" checked={uploadToDrive} onCheckedChange={setUploadToDrive} disabled={!settings?.gdrive_enabled} />
                    <Label htmlFor="upload-drive" className="text-xs text-muted-foreground">
                      Also upload to Google Drive{!settings?.gdrive_enabled && " (configure first)"}
                    </Label>
                  </div>
                </div>
                <Button onClick={handleCreateBackup} disabled={exporting || restoring} className="w-full">
                  {backupFormat === "json" ? <FileJson className="w-4 h-4 mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                  {exporting ? "Creating Backup..." : `Create ${backupFormat.toUpperCase()} Backup`}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" />Restore Database</CardTitle>
                <CardDescription>Upload a .sql or .json backup file to restore</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-xs text-destructive space-y-1">
                  <p className="font-medium">⚠ Warning: Restore will overwrite existing data!</p>
                  <p>Always create a backup before restoring.</p>
                  <p>Accepted: <strong>.sql</strong> or <strong>.json</strong> exports produced by this app.</p>
                </div>
                <label>
                  <input type="file" accept=".sql,.json" onChange={handleRestoreFile} className="hidden" disabled={exporting || restoring} />
                  <Button asChild variant="outline" className={`w-full ${restoring ? "pointer-events-none opacity-50" : ""}`}>
                    <span><Upload className="w-4 h-4 mr-2" />{restoring ? "Restoring..." : "Upload .sql / .json File & Restore"}</span>
                  </Button>
                </label>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Google Drive Tab */}
        <TabsContent value="gdrive">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Cloud className="w-4 h-4" />Google Drive Backup</CardTitle>
              <CardDescription>Sign in with Google and pick a Drive folder to auto-upload backups to</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings?.gdrive_refresh_token_set ? (
                <>
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>Connected as <strong>{settings.gdrive_account_email || "your Google account"}</strong></span>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleDisconnectGdrive} disabled={disconnectingGdrive}>
                      {disconnectingGdrive ? "Disconnecting..." : "Disconnect"}
                    </Button>
                  </div>

                  <div className="flex items-center gap-3">
                    <Switch
                      id="gdrive-enabled"
                      checked={!!settings?.gdrive_enabled}
                      onCheckedChange={(v) => { setSettings((p) => p ? { ...p, gdrive_enabled: v } : p); saveScheduleSettings({ gdrive_enabled: v }); }}
                    />
                    <Label htmlFor="gdrive-enabled" className="text-sm">Enable hourly Google Drive backup</Label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Backup folder</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/30 text-sm">
                          <HardDrive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">{settings.gdrive_folder_name || "My Drive (root)"}</span>
                        </div>
                        <Button variant="outline" size="sm" onClick={openFolderPicker}>Change</Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Default upload format</Label>
                      <Select value={settings?.gdrive_format || "sql"} onValueChange={(v) => { setSettings((p) => p ? { ...p, gdrive_format: v } : p); saveScheduleSettings({ gdrive_format: v } as any); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sql">SQL</SelectItem>
                          <SelectItem value="json">JSON</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {settings?.last_gdrive_error && (
                    <div className="p-2 rounded border text-xs bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400">
                      Last upload error: {settings.last_gdrive_error}
                    </div>
                  )}
                  {settings?.last_gdrive_backup_at && (
                    <p className="text-xs text-muted-foreground">Last successful Drive upload: {formatDate(settings.last_gdrive_backup_at)}</p>
                  )}
                </>
              ) : (
                <>
                  <div className="p-4 rounded-lg border border-dashed border-border text-center space-y-3">
                    <Cloud className="w-8 h-8 text-muted-foreground mx-auto" />
                    <p className="text-sm text-muted-foreground">No Google account connected yet.</p>
                    <Button onClick={handleConnectGdrive} disabled={connectingGdrive || !settings?.gdrive_client_id}>
                      {connectingGdrive ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Cloud className="w-4 h-4 mr-2" />}
                      {connectingGdrive ? "Redirecting to Google..." : "Connect Google Drive"}
                    </Button>
                    {!settings?.gdrive_client_id && (
                      <p className="text-xs text-destructive">Save a Google OAuth Client ID/Secret below first.</p>
                    )}
                  </div>
                </>
              )}

              <div className="pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setGdriveAppSetupOpen((v) => !v)}
                  className="text-xs text-primary hover:underline flex items-center gap-1 pt-3"
                >
                  <Settings className="w-3 h-3" />
                  {gdriveAppSetupOpen ? "Hide" : "Show"} Google OAuth app setup (one-time, admin only)
                </button>
                {gdriveAppSetupOpen && (
                  <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Enter the OAuth Client ID/Secret from your Google Cloud Console project (see the step-by-step guide). This only needs to be done once for this installation.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Client ID {settings?.gdrive_client_id && <span className="text-green-600">• saved</span>}</Label>
                        <Input value={gdriveClientForm.client_id} onChange={(e) => setGdriveClientForm((f) => ({ ...f, client_id: e.target.value }))} placeholder={settings?.gdrive_client_id || "xxxx.apps.googleusercontent.com"} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Client Secret {settings?.gdrive_client_secret_set && <span className="text-green-600">• saved</span>}</Label>
                        <Input type="password" value={gdriveClientForm.client_secret} onChange={(e) => setGdriveClientForm((f) => ({ ...f, client_secret: e.target.value }))} placeholder={settings?.gdrive_client_secret_set ? "(unchanged)" : "GOCSPX-..."} />
                      </div>
                    </div>
                    <Button size="sm" onClick={saveGdriveClientCredentials} disabled={savingSettings}>
                      {savingSettings ? "Saving..." : "Save app credentials"}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Dialog open={folderPickerOpen} onOpenChange={setFolderPickerOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Choose backup folder</DialogTitle>
                <DialogDescription>Browse your Google Drive and pick where backups should be uploaded.</DialogDescription>
              </DialogHeader>
              <div className="flex items-center flex-wrap gap-1 text-xs text-muted-foreground border-b border-border pb-2">
                {folderPath.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span>/</span>}
                    <button
                      type="button"
                      onClick={() => navigateToBreadcrumb(i)}
                      className={`hover:underline ${i === folderPath.length - 1 ? "text-foreground font-medium" : "text-primary"}`}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </div>
              <div className="max-h-64 overflow-auto space-y-1">
                {loadingFolders ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
                ) : folders.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No sub-folders here.</p>
                ) : (
                  folders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => navigateIntoFolder(f)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-sm text-left"
                    >
                      <HardDrive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <Input
                  placeholder="New folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); }}
                  className="h-8 text-sm"
                />
                <Button size="sm" variant="outline" onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
                  {creatingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Create"}
                </Button>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setFolderPickerOpen(false)}>Cancel</Button>
                <Button onClick={handleSelectCurrentFolder} disabled={savingFolder}>
                  {savingFolder ? "Saving..." : `Use "${folderPath[folderPath.length - 1].name}"`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>


        {/* Demo Import Tab */}
        <TabsContent value="demo">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Demo configuration import</CardTitle>
              <CardDescription>
                One-click setup of baseline configuration so you can start using the ERP immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-foreground">Select sections to import (14 available)</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAllSections(true)}
                      disabled={importingDemo}
                      className="text-[11px] text-primary hover:underline disabled:opacity-50"
                    >Select all</button>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <button
                      type="button"
                      onClick={() => setAllSections(false)}
                      disabled={importingDemo}
                      className="text-[11px] text-primary hover:underline disabled:opacity-50"
                    >Clear</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
                  {DEMO_SECTIONS.map(s => (
                    <label
                      key={s.key}
                      className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={!!selectedSections[s.key]}
                        onChange={() => toggleSection(s.key)}
                        disabled={importingDemo}
                        className="h-3.5 w-3.5 rounded border-border accent-primary"
                      />
                      <span>{s.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">
                  Selected: <strong className="text-foreground">{Object.values(selectedSections).filter(Boolean).length}</strong> / {DEMO_SECTIONS.length}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-700 dark:text-green-400">
                <p className="font-medium">✔ Safe to run</p>
                <p><strong>Import (keep existing)</strong> upserts the selected sections — existing rows are overwritten with seed values, missing rows are inserted. <strong>Preview (Dry Run)</strong> simulates the import in a rolled-back transaction so you can see exactly what would change without saving anything. No transactional data (vouchers, invoices, stock, payroll) is ever touched.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleImportDemoConfig(false, true)}
                  disabled={importingDemo || !isSuperAdmin}
                  className="w-full"
                >
                  <FileJson className="w-4 h-4 mr-2" />
                  {importingDemo && isDryRun ? "Previewing..." : "Preview (Dry Run)"}
                </Button>
                <Button
                  onClick={() => setConfirmDemo(true)}
                  disabled={importingDemo || !isSuperAdmin}
                  className="w-full"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  {importingDemo && !isDryRun ? "Working..." : "Import (keep existing)"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmResetDemo(true)}
                  disabled={importingDemo || !isSuperAdmin}
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reset &amp; Re-import
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                <strong>Reset &amp; Re-import</strong> deletes only the selected configuration sections and re-seeds them fresh. Vouchers, invoices, stock and payroll are NOT touched.
              </p>


              <div className="pt-4 mt-2 border-t border-border space-y-2">
                <p className="text-sm font-medium text-foreground">Full demo data (all modules, 2 branches)</p>
                <p className="text-xs text-muted-foreground">
                  Seeds a full year of operational data across Accounts, Bank &amp; Cash, Inventory, Purchase, Manufacturing, Sales (BD VAT) and HRM for two branches: <strong>Head Office</strong> and <strong>Factory</strong>. Wipes all existing transactional + master data first.
                </p>
                <Button
                  variant="destructive"
                  onClick={handleFullDemoSeed}
                  disabled={seedingFull || resettingDemo || !isSuperAdmin}
                  className="w-full"
                >
                  {seedingFull ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {seedingFull ? "Seeding full demo data..." : "Wipe & Seed Full Demo Data (2 branches)"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleResetDemoOnly}
                  disabled={resettingDemo || seedingFull || resettingTxn || !isSuperAdmin}
                  className="w-full"
                >
                  {resettingDemo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  {resettingDemo ? "Resetting demo data..." : "Reset Demo Data Only (preserve config)"}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  <strong>Reset Demo Data Only</strong> wipes all transactions + masters but PRESERVES Chart of Accounts, IFRS Mapping, Document Numbering, Page Shortcuts, General Settings, SMS Integration, Branding &amp; GitHub Deploy Sync.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => handleResetTransactionsOnly(false)}
                  disabled={resettingTxn || dryRunTxn || seedingFull || resettingDemo || !isSuperAdmin}
                  className="w-full"
                >
                  {resettingTxn ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  {resettingTxn ? "Clearing transactional data..." : "Reset Transactions Only (keep masters + config)"}
                </Button>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleResetTransactionsOnly(true)} disabled={dryRunTxn || resettingTxn || !isSuperAdmin}>
                    {dryRunTxn ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Shield className="w-3.5 h-3.5 mr-2" />}
                    Dry-Run (preview only)
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleOpenAuditTables} disabled={!isSuperAdmin}>
                    <Database className="w-3.5 h-3.5 mr-2" /> View Table Audit Report
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportAuditLog} disabled={exportingAuditLog || !isSuperAdmin}>
                    {exportingAuditLog ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-2" />}
                    Export Audit Log (CSV)
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  <strong>Reset Transactions Only</strong> wipes vouchers, invoices, POs, stock movements, payroll, attendance &amp; payments. PRESERVES all masters (customers, suppliers, products, employees, BOMs, salary structures) AND all configuration. Pending migrations run automatically before seed.
                </p>
                {dryRunResult && (
                  <div className="rounded border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-blue-700 dark:text-blue-400">
                      <span>🔍 Dry-Run Preview — nothing has been deleted</span>
                      <span>{dryRunResult.tables_to_wipe} tables · {dryRunResult.total_rows} rows</span>
                    </div>
                    <div className="max-h-56 overflow-auto rounded border border-border">
                      <table className="w-full text-[11px]">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr><th className="text-left px-2 py-1">Table</th><th className="text-right px-2 py-1">Rows</th><th className="text-center px-2 py-1">Status</th></tr>
                        </thead>
                        <tbody>
                          {(dryRunResult.tables || []).map((t: any) => (
                            <tr key={t.table} className="border-t border-border">
                              <td className="px-2 py-1 font-mono">{t.table}</td>
                              <td className="px-2 py-1 text-right">{t.exists ? t.rows : "—"}</td>
                              <td className="px-2 py-1 text-center">{t.exists ? (t.rows > 0 ? "would wipe" : "empty") : "missing"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {fullSeedLog && (
                  <pre className="text-[10px] p-2 bg-muted rounded max-h-48 overflow-auto">{fullSeedLog}</pre>
                )}
              </div>

              {(importingDemo || demoProgress > 0) && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{demoStatus || "Preparing..."}</span>
                    <span className="font-mono text-foreground">{demoProgress}%</span>
                  </div>
                  <Progress value={demoProgress} className="h-2" />
                </div>
              )}

              {demoResults && (
                <div className="space-y-2 pt-2">
                  {isDryRun && (
                    <div className="p-2 rounded border text-xs font-medium bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400">
                      🔍 Dry-Run Preview — nothing has been saved. Numbers below show what <em>would</em> happen on a real import.
                    </div>
                  )}
                  <div className={`p-2 rounded border text-xs font-medium ${
                    demoOverall === "success"
                      ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400"
                      : "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400"
                  }`}>
                    {demoOverall === "success"
                      ? (isDryRun ? "✔ Preview ready" : "✔ Import complete")
                      : (isDryRun ? "⚠ Preview finished with warnings" : "⚠ Import finished with warnings")}
                    {" — "}
                    {demoResults.reduce((n, r) => n + r.inserted, 0)} {isDryRun ? "would be inserted" : "new rows added"},{" "}
                    {demoResults.reduce((n, r) => n + r.skipped, 0)} {isDryRun ? "would be updated" : "existing rows overwritten"}.
                  </div>
                  <div className="rounded border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="text-left px-2 py-1.5">Section</th>
                          <th className="text-right px-2 py-1.5">{isDryRun ? "Would insert" : "Inserted"}</th>
                          <th className="text-right px-2 py-1.5">{isDryRun ? "Would update" : "Updated"}</th>
                          <th className="text-right px-2 py-1.5">Attempted</th>
                          <th className="text-center px-2 py-1.5">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {demoResults.map((r) => (
                          <tr key={r.section} className="border-t border-border">
                            <td className="px-2 py-1.5 text-foreground">{r.label}</td>
                            <td className="px-2 py-1.5 text-right font-semibold text-foreground">{r.inserted}</td>
                            <td className="px-2 py-1.5 text-right text-muted-foreground">{r.skipped}</td>
                            <td className="px-2 py-1.5 text-right text-muted-foreground">{r.attempted}</td>
                            <td className="px-2 py-1.5 text-center">
                              {r.status === "ok" || r.status === "success" ? (
                                <Badge variant="default" className="bg-green-600 text-white">OK</Badge>
                              ) : r.status === "partial" ? (
                                <Badge variant="outline" className="border-yellow-500 text-yellow-700 dark:text-yellow-400" title={r.error || ""}>Partial</Badge>
                              ) : (
                                <Badge variant="destructive" title={r.error || ""}>Failed</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {demoResults.some((r) => r.error) && (
                    <div className="text-xs text-destructive space-y-0.5">
                      {demoResults.filter((r) => r.error).map((r) => (
                        <div key={r.section}>• <strong>{r.label}:</strong> {r.error}</div>
                      ))}
                    </div>
                  )}
                  {!isDryRun && (
                    <p className="text-[10px] text-muted-foreground pt-1">
                      Audit log entry recorded under <code>module=backup</code>, <code>action=demo_config_import</code> (or <code>demo_config_reset_import</code>) with timestamp, user, mode and the list of imported sections.
                    </p>
                  )}
                </div>
              )}

            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="settings">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Settings className="w-4 h-4" />Backup Settings</CardTitle>
                <CardDescription>Configure backup behavior and storage</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Backup Format</Label>
                    <Badge variant="secondary">SQL Only</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Storage Location</Label>
                    <code className="text-xs bg-muted px-2 py-1 rounded">storage/app/backups/</code>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Naming Convention</Label>
                    <code className="text-xs bg-muted px-2 py-1 rounded">erp_backup_YYYY_MM_DD_HH_MM.sql</code>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4" />Security</CardTitle>
                <CardDescription>Access control for backup operations</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground space-y-1">
                  <p>• Only <strong>Super Admin</strong> (employee_id = NULL) can manage backups</p>
                  <p>• All backup/restore actions are logged</p>
                  <p>• Restore requires confirmation dialog</p>
                  <p>• Only <strong>.sql</strong> files accepted for restore</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" />Backup History</CardTitle>
                <CardDescription>Previous backups and restore operations</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={fetchHistory}><RefreshCw className="w-4 h-4" /></Button>
            </CardHeader>
            <CardContent>
              {loadingHistory ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No backup history yet. Create your first backup in Local Backup tab.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>File</TableHead><TableHead>Type</TableHead><TableHead>Format</TableHead>
                      <TableHead>Size</TableHead><TableHead>Tables</TableHead><TableHead>Records</TableHead>
                      <TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>Actions</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {history.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs max-w-[200px] truncate">{r.file_name}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs capitalize">{r.backup_type === "auto_gdrive" ? "Hourly (Drive)" : r.backup_type}</Badge></TableCell>
                          <TableCell><Badge variant="secondary" className="text-xs uppercase">{(r.format || "sql")}</Badge></TableCell>
                          <TableCell className="text-xs">{formatFileSize(r.file_size)}</TableCell>
                          <TableCell className="text-xs">{r.tables_count}</TableCell>
                          <TableCell className="text-xs">{r.records_count}</TableCell>
                          <TableCell>{statusBadge(r.status)}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{formatDate(r.created_at)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {r.storage_path && r.status === "completed" && r.backup_type !== "restore" && (
                                <Button variant="ghost" size="sm" onClick={() => handleDownload(r)} title="Download">
                                  <Download className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {!r.storage_path && r.gdrive_view_link && r.status === "completed" && (
                                <Button variant="ghost" size="sm" asChild title="View on Google Drive">
                                  <a href={r.gdrive_view_link} target="_blank" rel="noopener noreferrer"><Cloud className="w-3.5 h-3.5" /></a>
                                </Button>
                              )}
                              {r.storage_path && r.status === "completed" && r.backup_type !== "restore" && settings?.gdrive_enabled && USE_LARAVEL && (
                                <Button variant="ghost" size="sm" onClick={() => uploadBackupToDrive(r.id)} disabled={uploadingId === r.id} title="Upload to Google Drive">
                                  <Cloud className={`w-3.5 h-3.5 ${uploadingId === r.id ? "animate-pulse" : ""}`} />
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(r.id)} title="Delete">
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Schedule Tab */}
        <TabsContent value="schedule">
          {settings && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><RefreshCw className="w-4 h-4" />Hourly Google Drive Backup</CardTitle>
                <CardDescription>Runs automatically every hour — no cron setup needed, this app's scheduler is already active</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  {settings.gdrive_enabled && settings.gdrive_refresh_token_set ? (
                    <Badge variant="default" className="bg-green-600 text-white"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>
                  ) : (
                    <Badge variant="outline"><AlertTriangle className="w-3 h-3 mr-1" />Not connected</Badge>
                  )}
                  <span className="text-muted-foreground">
                    Controlled from the <button type="button" className="text-primary hover:underline" onClick={() => setActiveTab("gdrive")}>Google Drive tab</button> — connect an account and enable auto-backup there.
                  </span>
                </div>
                {settings.last_auto_backup_at && (
                  <p className="text-xs text-muted-foreground">Last hourly backup created: {formatDate(settings.last_auto_backup_at)}</p>
                )}
                {settings.last_gdrive_backup_at && (
                  <p className="text-xs text-muted-foreground">Last successful Drive upload: {formatDate(settings.last_gdrive_backup_at)}</p>
                )}
                <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground space-y-1">
                  <p>• Every hour: a full SQL backup is created, uploaded to your configured Google Drive folder, then removed locally — the local disk is never used as long-term storage.</p>
                  <p>• Google Drive keeps only the <strong>last 5 days</strong> of backups; older ones are deleted automatically.</p>
                  <p>• If an upload fails (e.g. network issue), that backup is kept locally as a safety net and retried; the error shows on the Google Drive tab.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Restore Confirmation Dialog */}
      <Dialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-yellow-500" />Confirm Database Restore</DialogTitle>
            <DialogDescription>
              You are about to restore from <strong>{restoreFile?.name}</strong>. This will DROP and recreate all tables.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-destructive/10 border border-destructive/20 rounded p-3 text-sm text-destructive">
            <strong>⚠ Warning:</strong> This action is irreversible. Create a backup before proceeding.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmRestore(false); setRestoreFile(null); }}>Cancel</Button>
            <Button variant="destructive" onClick={executeRestore}><Upload className="w-4 h-4 mr-2" />Confirm Restore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Backup Record</DialogTitle>
            <DialogDescription>This will permanently delete this backup record and its stored file.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDelete && handleDeleteBackup(confirmDelete)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Demo Import Confirmation */}
      <Dialog open={confirmDemo} onOpenChange={setConfirmDemo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />Import demo configuration?</DialogTitle>
            <DialogDescription>
              Selected sections will be <strong>upserted</strong>: existing rows are overwritten with seed values, missing rows are inserted. No transactional data (vouchers, invoices, stock, payroll) is touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDemo(false)}>Cancel</Button>
            <Button onClick={() => handleImportDemoConfig(false, false)}><Sparkles className="w-4 h-4 mr-2" />Yes, import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmResetDemo} onOpenChange={setConfirmResetDemo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-5 h-5" />Reset &amp; Re-import?</DialogTitle>
            <DialogDescription>
              This will <strong>delete all rows</strong> in the selected configuration sections and re-seed them fresh from the demo bundle. Users will be unassigned from their custom roles. Vouchers, invoices, stock and payroll are NOT touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmResetDemo(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleImportDemoConfig(true, false)}>
              <RefreshCw className="w-4 h-4 mr-2" />Yes, reset &amp; re-import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={!!verifyResult} onOpenChange={(o) => !o && setVerifyResult(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {verifyResult?.passed
                ? <><CheckCircle className="w-5 h-5 text-green-600" /> Restore Verification Passed</>
                : <><AlertTriangle className="w-5 h-5 text-amber-600" /> Restore Verification — Issues Found</>}
            </DialogTitle>
            <DialogDescription>
              Post-restore integrity check on Purchase v2 / LC tables and their FK relationships.
            </DialogDescription>
          </DialogHeader>
          {verifyResult && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <div className="font-semibold mb-2">Table row counts</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(verifyResult.table_counts || {}).map(([t, c]: any) => (
                    <div key={t} className="flex justify-between border rounded px-2 py-1">
                      <span className="text-muted-foreground">{t}</span>
                      <span className="font-mono">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-semibold mb-2">Foreign-key checks</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Child → Parent</TableHead>
                      <TableHead className="text-right">Sampled</TableHead>
                      <TableHead className="text-right">Orphans</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(verifyResult.fk_checks || []).map((c: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{c.child}.{c.fk} → {c.parent}</TableCell>
                        <TableCell className="text-right font-mono">{c.sampled}</TableCell>
                        <TableCell className={`text-right font-mono ${c.orphans ? "text-destructive font-bold" : ""}`}>{c.orphans}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className={`text-sm font-medium ${verifyResult.passed ? "text-green-600" : "text-amber-600"}`}>
                Total orphans: {verifyResult.total_orphans}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setVerifyResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={auditTablesOpen} onOpenChange={setAuditTablesOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Database Table Audit Report</DialogTitle>
            <DialogDescription>
              Live inventory of transactional tables (cleared by "Reset Transactions Only") and preserved master/configuration tables.
            </DialogDescription>
          </DialogHeader>
          {loadingAuditTables && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}
          {!loadingAuditTables && auditTablesData && (
            <div className="space-y-4 overflow-auto">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border border-border p-2"><div className="text-muted-foreground">Transactional tables</div><div className="text-lg font-semibold">{auditTablesData.summary?.transactional_tables ?? 0}</div></div>
                <div className="rounded border border-border p-2"><div className="text-muted-foreground">Transactional rows</div><div className="text-lg font-semibold">{auditTablesData.summary?.transactional_rows ?? 0}</div></div>
                <div className="rounded border border-border p-2"><div className="text-muted-foreground">Preserved tables</div><div className="text-lg font-semibold">{auditTablesData.summary?.preserved_tables ?? 0}</div></div>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1 text-red-600 dark:text-red-400">Transactional (will be wiped)</div>
                <div className="rounded border border-border max-h-64 overflow-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 sticky top-0"><tr><th className="text-left px-2 py-1">Table</th><th className="text-right px-2 py-1">Rows</th><th className="text-center px-2 py-1">Status</th></tr></thead>
                    <tbody>
                      {(auditTablesData.transactional || []).map((t: any) => (
                        <tr key={t.table} className="border-t border-border">
                          <td className="px-2 py-1 font-mono">{t.table}</td>
                          <td className="px-2 py-1 text-right">{t.exists ? t.rows : "—"}</td>
                          <td className="px-2 py-1 text-center">{t.exists ? "will wipe" : <span className="text-muted-foreground">missing</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1 text-green-600 dark:text-green-400">Preserved (masters + configuration)</div>
                <div className="rounded border border-border max-h-64 overflow-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 sticky top-0"><tr><th className="text-left px-2 py-1">Table</th><th className="text-right px-2 py-1">Rows</th><th className="text-center px-2 py-1">Status</th></tr></thead>
                    <tbody>
                      {(auditTablesData.preserved || []).map((t: any) => (
                        <tr key={t.table} className="border-t border-border">
                          <td className="px-2 py-1 font-mono">{t.table}</td>
                          <td className="px-2 py-1 text-right">{t.exists ? t.rows : "—"}</td>
                          <td className="px-2 py-1 text-center">{t.exists ? "preserved" : <span className="text-muted-foreground">missing</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuditTablesOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BackupPage;
