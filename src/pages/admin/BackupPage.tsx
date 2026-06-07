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
import { Download, Upload, Database, Clock, FileText, Trash2, AlertTriangle, CheckCircle, XCircle, Settings, RefreshCw, Shield, Cloud, HardDrive, Sparkles } from "lucide-react";

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

  const DEMO_STEPS = [
    "Chart of Accounts",
    "IFRS Account Mapping",
    "Roles & Permissions",
    "Document Numbering",
    "Page Shortcuts",
  ];

  const handleImportDemoConfig = async (reset = false) => {
    if (!isSuperAdmin) {
      toast({ title: "Access Denied", description: "Only Super Admins can run demo import.", variant: "destructive" });
      return;
    }
    setConfirmDemo(false);
    setConfirmResetDemo(false);
    setImportingDemo(true);
    setDemoResults(null);
    setDemoOverall(null);
    setDemoProgress(5);
    setDemoStatus(reset ? "Resetting configuration tables..." : "Validating Super Admin access...");

    // Simulated step progress (the server runs the full import in one call).
    let step = 0;
    const stepTimer = window.setInterval(() => {
      step = Math.min(step + 1, DEMO_STEPS.length - 1);
      setDemoStatus(`Importing: ${DEMO_STEPS[step]}...`);
      setDemoProgress(Math.min(15 + step * 15, 85));
    }, 700);

    try {
      let payload: any = null;
      if (USE_LARAVEL) {
        const res = await fetch(`${API_BASE}/v1/admin/demo/import-config`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ reset }),
        });
        payload = await res.json().catch(() => ({ message: `Failed (HTTP ${res.status})` }));
        if (!res.ok) throw new Error(payload.message || payload.error || `HTTP ${res.status}`);
      } else {
        const { data, error } = await supabase.functions.invoke("import-demo-config", { body: { reset } });
        if (error) throw error;
        payload = data;
        if (payload && payload.success === false && !payload.results) throw new Error(payload.error || "Import failed");
      }

      const results = payload?.results || payload?.data?.results || null;
      const overall: "success" | "partial" = payload?.overall || payload?.data?.overall || (payload?.success ? "success" : "partial");
      setDemoResults(results);
      setDemoOverall(overall);
      setDemoProgress(100);
      setDemoStatus(overall === "success" ? "Import completed successfully." : "Import completed with warnings.");

      const total = results ? results.reduce((n: number, r: any) => n + (r.inserted || 0), 0) : 0;
      toast({
        title: overall === "success" ? "Demo configuration imported" : "Demo import finished with warnings",
        description: `${total} new rows added across ${results?.length ?? 5} sections.`,
        variant: overall === "success" ? "default" : "destructive",
      });
    } catch (err: any) {
      setDemoProgress(100);
      setDemoStatus("Import failed.");
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      window.clearInterval(stepTimer);
      setImportingDemo(false);
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
    setExporting(true);
    setProgress(20);
    try {
      setProgress(50);
      if (USE_LARAVEL) {
        const res = await laravelApiCall("/v1/backups/create", { method: "POST", headers: { "Content-Type": "application/json" } });
        const result = await res.json();
        toast({ title: "Backup created", description: `${result.data?.file_name || "Backup"} created successfully.` });
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");
        const { data, error } = await supabase.functions.invoke("create-backup", {
          body: { format: "sql", backup_type: "manual" },
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
    if (!file.name.endsWith(".sql")) {
      toast({ title: "Invalid file", description: "Only .sql backup files are allowed.", variant: "destructive" });
      e.target.value = ""; return;
    }
    setRestoreFile(file);
    setConfirmRestore(true);
    e.target.value = "";
  };

  const executeRestore = async () => {
    if (!restoreFile) return;
    setConfirmRestore(false);
    setRestoring(true);
    setProgress(20);
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
      } else {
        // Read file content and invoke edge function
        const content = await restoreFile.text();
        setProgress(50);
        const { data, error } = await supabase.functions.invoke("restore-backup", {
          body: { content, sql_content: content, file_name: restoreFile.name },
        });
        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || "Restore failed");
      }
      setProgress(100);
      toast({ title: "Restore completed", description: "Database has been restored successfully." });
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
        <h1 className="text-xl font-semibold text-foreground">Backup & Restore (SQL)</h1>
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
                <CardTitle className="text-base flex items-center gap-2"><Download className="w-4 h-4" />Create SQL Backup</CardTitle>
                <CardDescription>Export database as SQL (.sql) backup file</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground space-y-1">
                  <p>• Full database dump with DROP TABLE + CREATE TABLE + INSERT</p>
                  <p>• Includes all tables, triggers, and routines</p>
                  <p>• File saved to <code>storage/app/backups/</code></p>
                  <p>• Format: <strong>erp_backup_YYYY_MM_DD_HH_MM.sql</strong></p>
                </div>
                <Button onClick={handleCreateBackup} disabled={exporting || restoring} className="w-full">
                  <Download className="w-4 h-4 mr-2" />{exporting ? "Creating Backup..." : "Create SQL Backup"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" />Restore Database</CardTitle>
                <CardDescription>Upload a .sql backup file to restore</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-xs text-destructive space-y-1">
                  <p className="font-medium">⚠ Warning: Restore will overwrite existing data!</p>
                  <p>Always create a backup before restoring.</p>
                  <p>Only <strong>.sql</strong> files are accepted.</p>
                </div>
                <label>
                  <input type="file" accept=".sql" onChange={handleRestoreFile} className="hidden" disabled={exporting || restoring} />
                  <Button asChild variant="outline" className={`w-full ${restoring ? "pointer-events-none opacity-50" : ""}`}>
                    <span><Upload className="w-4 h-4 mr-2" />{restoring ? "Restoring..." : "Upload .sql File & Restore"}</span>
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
              <CardDescription>Upload SQL backup files to Google Drive for cloud storage</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground space-y-3">
                <p className="font-medium text-foreground">How it works:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>SQL backup is created locally first</li>
                  <li>The <code>.sql</code> file is then uploaded to your connected Google Drive</li>
                  <li>File naming: <strong>erp_backup_YYYY_MM_DD_HH_MM.sql</strong></li>
                  <li>Configure Google Drive API credentials in Settings tab</li>
                </ul>
              </div>
              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-700 dark:text-yellow-400">
                <p className="font-medium">⚙ Setup Required</p>
                <p>Google Drive integration requires API credentials. Configure them in the Settings tab.</p>
              </div>
              <Button variant="outline" disabled className="w-full">
                <Cloud className="w-4 h-4 mr-2" />Upload Latest Backup to Google Drive
              </Button>
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
              <div className="p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">This will import:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Chart of Accounts (Bangladesh standard, 59 accounts)</li>
                  <li>IFRS Account Mapping (standard IFRS lines)</li>
                  <li>Roles &amp; Permissions (Super Admin, Admin, Accountant, Sales Manager, Inventory Clerk, Viewer)</li>
                  <li>Document Numbering (INV, PUR, JV, PV, RV, CV, PRD, INC, EXP)</li>
                  <li>Page Shortcuts (118 quick-jump codes)</li>
                </ul>
              </div>
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-700 dark:text-green-400">
                <p className="font-medium">✔ Safe to run</p>
                <p>Idempotent — existing records are kept untouched. Only missing rows are inserted. No transactional data (vouchers, invoices, stock) is touched.</p>
              </div>
              <Button
                onClick={() => setConfirmDemo(true)}
                disabled={importingDemo || !isSuperAdmin}
                className="w-full"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {importingDemo ? "Importing..." : "Import demo configuration"}
              </Button>

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
                  <div className={`p-2 rounded border text-xs font-medium ${
                    demoOverall === "success"
                      ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400"
                      : "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400"
                  }`}>
                    {demoOverall === "success" ? "✔ Import complete" : "⚠ Import finished with warnings"}
                    {" — "}
                    {demoResults.reduce((n, r) => n + r.inserted, 0)} new rows added.
                  </div>
                  <div className="rounded border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="text-left px-2 py-1.5">Section</th>
                          <th className="text-right px-2 py-1.5">Inserted</th>
                          <th className="text-right px-2 py-1.5">Skipped</th>
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
                  <p className="text-[10px] text-muted-foreground pt-1">Audit log entry recorded under <code>module=backup</code>, <code>action=demo_config_import</code>.</p>
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
                          <TableCell><Badge variant="secondary" className="text-xs uppercase">SQL</Badge></TableCell>
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
              This will insert missing Chart of Accounts, IFRS Mapping, Roles &amp; Permissions, Document Numbering and Page Shortcuts. Existing rows are kept as-is. No transactional data is touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDemo(false)}>Cancel</Button>
            <Button onClick={() => handleImportDemoConfig(false)}><Sparkles className="w-4 h-4 mr-2" />Yes, import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BackupPage;
