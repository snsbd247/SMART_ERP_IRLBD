import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
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
import { Download, Upload, Database, Clock, FileText, Trash2, AlertTriangle, CheckCircle, XCircle, Settings, RefreshCw, Shield, Cloud, HardDrive, Sparkles, FileJson, Loader2 } from "lucide-react";

const API_BASE = getApiBaseUrl() || "";
const USE_LARAVEL = isLaravelMode();

interface BackupRecord {
  id: string; file_name: string; file_size: number; backup_type: string; format: string;
  status: string; tables_count: number; records_count: number; storage_path: string | null;
  created_at: string; error_message: string | null;
}

interface BackupSettings {
  auto_backup_enabled: boolean; schedule_interval: string; retention_days: number;
  last_auto_backup_at: string | null;
  gdrive_enabled?: boolean;
  gdrive_client_id?: string | null;
  gdrive_client_secret_set?: boolean;
  gdrive_refresh_token_set?: boolean;
  gdrive_folder_id?: string | null;
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

const BackupPage = () => {
  const { toast } = useToast();
  const { isSuperAdmin } = useAuth();
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
  const [gdriveForm, setGdriveForm] = useState({ client_id: "", client_secret: "", refresh_token: "", folder_id: "" });
  const [gdriveTesting, setGdriveTesting] = useState(false);
  const [gdriveTestResult, setGdriveTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<any | null>(null);

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
        const { data, error } = await supabase.functions.invoke("import-demo-config", { body });
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
        const r = await supabase.functions.invoke("reset-and-seed-demo", { body: {} });
        if (r.error) throw r.error;
        data = r.data;
        if (data?.success === false) throw new Error(data.error || "Seed failed");
      }
      setFullSeedLog(JSON.stringify(data, null, 2));
      toast({ title: "Demo data seeded", description: `Completed in ${data?.elapsedMs ?? data?.data?.output ? "OK" : "?"}.` });
    } catch (err: any) {
      toast({ title: "Seed failed", description: err.message, variant: "destructive" });
      setFullSeedLog(String(err.message || err));
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
        const r = await supabase.functions.invoke("reset-and-seed-demo", { body: { mode: "reset" } });
        if (r.error) throw r.error;
        data = r.data;
        if (data?.success === false) throw new Error(data.error || "Reset failed");
      }
      setFullSeedLog(JSON.stringify(data, null, 2));
      toast({ title: "Demo data reset", description: `Completed in ${data?.elapsedMs ?? "?"}ms.` });
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
      setFullSeedLog(String(err.message || err));
    } finally {
      setResettingDemo(false);
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
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");
        const { data, error } = await supabase.functions.invoke("create-backup", {
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
        const { data, error } = await supabase.storage.from("backups").download(record.storage_path);
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
        const { data, error } = await supabase.functions.invoke("restore-backup", {
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
          await supabase.storage.from("backups").remove([record.storage_path]);
        }
        const { error } = await supabase.from("backup_history").delete().eq("id", id);
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
        const { error } = await supabase
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

  const saveGdriveSettings = async () => {
    if (!USE_LARAVEL) {
      toast({ title: "Google Drive settings require the Laravel backend.", variant: "destructive" });
      return;
    }
    setSavingSettings(true);
    try {
      // Only send fields the admin actually filled in so we don't wipe existing secrets
      const body: Record<string, any> = {
        gdrive_enabled: !!settings?.gdrive_enabled,
        gdrive_format: settings?.gdrive_format || "sql",
      };
      if (gdriveForm.client_id) body.gdrive_client_id = gdriveForm.client_id;
      if (gdriveForm.client_secret) body.gdrive_client_secret = gdriveForm.client_secret;
      if (gdriveForm.refresh_token) body.gdrive_refresh_token = gdriveForm.refresh_token;
      if (gdriveForm.folder_id) body.gdrive_folder_id = gdriveForm.folder_id;
      await laravelApiCall("/v1/backups/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({ title: "Google Drive settings saved" });
      setGdriveForm({ client_id: "", client_secret: "", refresh_token: "", folder_id: "" });
      fetchSettings();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
    setSavingSettings(false);
  };

  const testGdrive = async () => {
    if (!USE_LARAVEL) return;
    setGdriveTesting(true);
    setGdriveTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/v1/backups/gdrive/test`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(gdriveForm),
      });
      const result = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      if (!res.ok || !result.success) throw new Error(result.message || result.error || "Test failed");
      const email = result.data?.user?.emailAddress || "";
      setGdriveTestResult({ ok: true, message: `Connected${email ? ` as ${email}` : ""}.` });
    } catch (err: any) {
      setGdriveTestResult({ ok: false, message: err.message });
    }
    setGdriveTesting(false);
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
              <CardDescription>Daily auto-upload of backups to your Google Drive folder</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Setup steps:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Create an OAuth 2.0 Client (Desktop / Web) in Google Cloud Console with the <code>drive.file</code> scope.</li>
                  <li>Generate a refresh token (e.g. via OAuth Playground) for that client.</li>
                  <li>Create (or pick) a Drive folder, copy its ID from the URL, share it with the OAuth user.</li>
                  <li>Paste credentials below, press <strong>Test</strong>, then <strong>Save</strong>.</li>
                </ol>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id="gdrive-enabled"
                  checked={!!settings?.gdrive_enabled}
                  onCheckedChange={(v) => setSettings((p) => p ? { ...p, gdrive_enabled: v } : p)}
                />
                <Label htmlFor="gdrive-enabled" className="text-sm">Enable Google Drive auto-backup (daily)</Label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Client ID {settings?.gdrive_client_id && <span className="text-green-600">• saved</span>}</Label>
                  <Input value={gdriveForm.client_id} onChange={(e) => setGdriveForm((f) => ({ ...f, client_id: e.target.value }))} placeholder={settings?.gdrive_client_id || "xxxx.apps.googleusercontent.com"} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Client Secret {settings?.gdrive_client_secret_set && <span className="text-green-600">• saved</span>}</Label>
                  <Input type="password" value={gdriveForm.client_secret} onChange={(e) => setGdriveForm((f) => ({ ...f, client_secret: e.target.value }))} placeholder={settings?.gdrive_client_secret_set ? "(unchanged)" : "GOCSPX-..."} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs text-muted-foreground">Refresh Token {settings?.gdrive_refresh_token_set && <span className="text-green-600">• saved</span>}</Label>
                  <Input type="password" value={gdriveForm.refresh_token} onChange={(e) => setGdriveForm((f) => ({ ...f, refresh_token: e.target.value }))} placeholder={settings?.gdrive_refresh_token_set ? "(unchanged)" : "1//0..."} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Folder ID</Label>
                  <Input value={gdriveForm.folder_id} onChange={(e) => setGdriveForm((f) => ({ ...f, folder_id: e.target.value }))} placeholder={settings?.gdrive_folder_id || "Drive folder ID"} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Default upload format</Label>
                  <Select value={settings?.gdrive_format || "sql"} onValueChange={(v) => setSettings((p) => p ? { ...p, gdrive_format: v } : p)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sql">SQL</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {gdriveTestResult && (
                <div className={`p-2 rounded border text-xs ${gdriveTestResult.ok ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400" : "bg-destructive/10 border-destructive/30 text-destructive"}`}>
                  {gdriveTestResult.ok ? "✔ " : "✖ "}{gdriveTestResult.message}
                </div>
              )}

              {settings?.last_gdrive_error && (
                <div className="p-2 rounded border text-xs bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400">
                  Last upload error: {settings.last_gdrive_error}
                </div>
              )}
              {settings?.last_gdrive_backup_at && (
                <p className="text-xs text-muted-foreground">Last successful Drive upload: {formatDate(settings.last_gdrive_backup_at)}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={testGdrive} disabled={gdriveTesting}>
                  {gdriveTesting ? "Testing..." : "Test connection"}
                </Button>
                <Button onClick={saveGdriveSettings} disabled={savingSettings}>
                  {savingSettings ? "Saving..." : "Save settings"}
                </Button>
              </div>
            </CardContent>
          </Card>
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
                  <Sparkles className="w-4 h-4 mr-2" />
                  {seedingFull ? "Seeding full demo data..." : "Wipe & Seed Full Demo Data (2 branches)"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleResetDemoOnly}
                  disabled={resettingDemo || seedingFull || !isSuperAdmin}
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {resettingDemo ? "Resetting demo data..." : "Reset Demo Data Only (preserve config)"}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  <strong>Reset Demo Data Only</strong> wipes all transactions + masters but PRESERVES Chart of Accounts, IFRS Mapping, Document Numbering, Page Shortcuts, General Settings, SMS Integration, Branding &amp; GitHub Deploy Sync.
                </p>
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
                          <TableCell><Badge variant="outline" className="text-xs capitalize">{r.backup_type}</Badge></TableCell>
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
                <CardTitle className="text-base flex items-center gap-2"><RefreshCw className="w-4 h-4" />Backup Schedule</CardTitle>
                <CardDescription>Configure automatic SQL backups via cron job</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-6 items-end">
                  <div className="flex items-center gap-3">
                    <Switch checked={settings.auto_backup_enabled} onCheckedChange={(v) => saveScheduleSettings({ auto_backup_enabled: v })} disabled={savingSettings} />
                    <Label className="text-sm">Enable automatic backups</Label>
                  </div>
                  {settings.auto_backup_enabled && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Interval</Label>
                        <Select value={settings.schedule_interval} onValueChange={(v) => saveScheduleSettings({ schedule_interval: v })}>
                          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hourly">Hourly</SelectItem>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Retention (days)</Label>
                        <Select value={String(settings.retention_days)} onValueChange={(v) => saveScheduleSettings({ retention_days: Number(v) })}>
                          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="7">7</SelectItem>
                            <SelectItem value="14">14</SelectItem>
                            <SelectItem value="30">30</SelectItem>
                            <SelectItem value="90">90</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                  {settings.last_auto_backup_at && (
                    <p className="text-xs text-muted-foreground">Last auto backup: {formatDate(settings.last_auto_backup_at)}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Cron Job Setup</CardTitle></CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>Add this cron job in cPanel → Cron Jobs for automatic SQL backups:</p>
                <div className="p-3 rounded-lg bg-muted border border-border font-mono text-xs">
                  <p className="font-semibold text-foreground mb-1">Daily at 2:00 AM:</p>
                  <code>0 2 * * * php /home/USERNAME/public_html/artisan backup:database --type=auto</code>
                </div>
                <div className="p-3 rounded-lg bg-muted border border-border font-mono text-xs">
                  <p className="font-semibold text-foreground mb-1">Every 6 hours:</p>
                  <code>0 */6 * * * php /home/USERNAME/public_html/artisan backup:database --type=auto</code>
                </div>
                <p className="flex items-center gap-2"><Shield className="w-4 h-4" /><strong>Security:</strong> Only Super Admins (employee_id = NULL) can manage backups.</p>
                <p>• <strong>Format:</strong> SQL only (.sql) — full mysqldump with DROP + CREATE + INSERT</p>
                <p>• <strong>Storage:</strong> <code>storage/app/backups/</code></p>
                <p>• <strong>Naming:</strong> <code>erp_backup_YYYY_MM_DD_HH_MM.sql</code></p>
                <p>• <strong>Cleanup:</strong> Old backups auto-deleted based on retention setting</p>
              </div>
            </CardContent>
          </Card>
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
    </div>
  );
};

export default BackupPage;
