import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  GitBranch, Download, Undo2, RefreshCw, AlertTriangle, CheckCircle2,
  Eye, Settings, Database, Loader2, FileSearch, Archive, ClipboardList,
  Plug, FileDown, Trash2, ChevronLeft, ChevronRight, Radio,
} from "lucide-react";

type StatusFile = { path: string; remote_sha: string; local_sha?: string; size?: number };
type StatusData = {
  branch: string; repo: string;
  counts: { added: number; modified: number; unchanged: number };
  added: StatusFile[]; modified: StatusFile[];
  last_pulled_at: string | null; has_backup: boolean;
  auto_migrate: boolean; has_token: boolean;
};
type Config = {
  owner: string; repo: string; branch: string;
  auto_migrate: boolean; has_token: boolean;
  retention_count: number; retention_days: number;
  last_pulled_at: string | null; last_backup_id: string | null;
};
type Job = {
  type: string; status: "queued" | "running" | "done" | "failed";
  progress: number; message: string;
  pulled_count?: number; pulled?: string[]; errors?: any[];
  restored_count?: number; backup_id?: string; migrate_output?: string;
  retention_deleted?: string[];
};
type Backup = { backup_id: string; file_count: number; created_at: string; branch: string | null; job_id: string | null };
type AuditRow = {
  id: number; event: string; status: string; user_name: string | null;
  job_id: string | null; backup_id: string | null; branch: string | null;
  message: string | null; ip_address: string | null; created_at: string;
};
type RestorePreview = {
  backup_id: string; would_change_count: number;
  changes: { path: string; action: string; backup_size: number; current_exists: boolean }[];
};

const API = "/api/v1/deploy-sync";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call(path: string, opts: { method?: string; body?: any } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method || "GET",
    headers: {
      Accept: "application/json", "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.message || `HTTP ${res.status}`);
  return json.data;
}

/** Simple inline diff: marks lines as added/removed/unchanged. */
function buildLineDiff(local: string, remote: string) {
  const a = local.split("\n");
  const b = remote.split("\n");
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { type: "same" | "add" | "del"; text: string; ln?: number; rn?: number }[] = [];
  let i = 0, j = 0, ln = 1, rn = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i], ln: ln++, rn: rn++ }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i], ln: ln++ }); i++; }
    else { out.push({ type: "add", text: b[j], rn: rn++ }); j++; }
  }
  while (i < n) out.push({ type: "del", text: a[i++], ln: ln++ });
  while (j < m) out.push({ type: "add", text: b[j++], rn: rn++ });
  return out;
}

export default function DeploySyncPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<StatusData | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffData, setDiffData] = useState<{ path: string; local: string; remote: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [latestBackupId, setLatestBackupId] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auditFilter, setAuditFilter] = useState<string>("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPerPage, setAuditPerPage] = useState(25);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLastPage, setAuditLastPage] = useState(1);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [streamMode, setStreamMode] = useState<"sse" | "poll">("sse");
  const pollRef = useRef<number | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const [form, setForm] = useState({
    owner: "", repo: "", branch: "", token: "",
    auto_migrate: false, retention_count: 10, retention_days: 30,
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cfg, st] = await Promise.all([call("/config"), call("/status")]);
      setConfig(cfg);
      setStatus(st);
      setForm({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: "", auto_migrate: cfg.auto_migrate, retention_count: cfg.retention_count ?? 10, retention_days: cfg.retention_days ?? 30 });
    } catch (e: any) {
      toast({ title: "Failed to load", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const loadConfigOnly = async () => {
    try {
      const cfg = await call("/config");
      setConfig(cfg);
      setForm({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: "", auto_migrate: cfg.auto_migrate, retention_count: cfg.retention_count ?? 10, retention_days: cfg.retention_days ?? 30 });
    } catch (e: any) {
      toast({ title: "Failed to load config", description: e.message, variant: "destructive" });
    }
  };

  const loadBackups = async () => {
    try {
      const d = await call("/backups");
      setBackups(d.backups || []);
      setLatestBackupId(d.latest_backup_id || null);
    } catch (e: any) {
      toast({ title: "Failed to load backups", description: e.message, variant: "destructive" });
    }
  };

  const loadAudit = async (page = auditPage, perPage = auditPerPage) => {
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (auditFilter) params.set("event", auditFilter);
      const d = await call(`/audit-log?${params.toString()}`);
      setAudit(d.items || []);
      setAuditTotal(d.total ?? 0);
      setAuditLastPage(d.last_page ?? 1);
      setAuditPage(d.page ?? page);
    } catch (e: any) {
      toast({ title: "Failed to load audit log", description: e.message, variant: "destructive" });
    }
  };

  useEffect(() => { loadConfigOnly(); }, []);

  // Real-time job updates: try SSE first, fall back to polling.
  useEffect(() => {
    if (!jobId) return;

    const finish = (j: Job) => {
      if (j.status === "done") {
        toast({ title: `${j.type === "pull" ? "Pull" : "Rollback"} complete`, description: j.message });
        loadAll(); loadBackups();
      } else if (j.status === "failed") {
        toast({ title: "Job failed", description: j.message, variant: "destructive" });
      }
    };

    const startPolling = () => {
      setStreamMode("poll");
      pollRef.current = window.setInterval(async () => {
        try {
          const j: Job = await call(`/jobs/${jobId}`);
          setJob(j);
          if (j.status === "done" || j.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            finish(j);
          }
        } catch (e: any) {
          if (pollRef.current) clearInterval(pollRef.current);
          toast({ title: "Polling error", description: e.message, variant: "destructive" });
        }
      }, 1500);
    };

    // EventSource cannot send Authorization headers, so token is passed as a query param
    // only when the backend supports it; otherwise SSE will 401 and we fall back.
    try {
      const token = localStorage.getItem("auth_token");
      const url = `${API}/jobs/${jobId}/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
      const es = new EventSource(url, { withCredentials: true });
      sseRef.current = es;
      setStreamMode("sse");
      es.addEventListener("progress", (ev: MessageEvent) => {
        try {
          const j: Job = JSON.parse(ev.data);
          setJob(j);
          if (j.status === "done" || j.status === "failed") {
            es.close();
            finish(j);
          }
        } catch { /* ignore */ }
      });
      es.addEventListener("end", () => es.close());
      es.onerror = () => {
        es.close();
        sseRef.current = null;
        // Fall back to polling silently
        if (!pollRef.current) startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    };
  }, [jobId]);

  const saveConfig = async () => {
    try {
      await call("/config", { method: "PUT", body: form });
      toast({ title: "Settings saved" });
      await loadConfigOnly();
      setForm((f) => ({ ...f, token: "" }));
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };

  const clearToken = async () => {
    if (!confirm("Remove stored GitHub token?")) return;
    await call("/config/token", { method: "DELETE" });
    toast({ title: "Token cleared" });
    loadConfigOnly();
  };

  const doTestConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const d = await call("/test-connection", { method: "POST", body: {
        owner: form.owner, repo: form.repo, branch: form.branch, token: form.token,
      }});
      setTestResult({ ok: true, ...d });
      toast({ title: "Connection OK", description: `Latest commit: ${d.latest_commit}` });
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message });
      toast({ title: "Connection failed", description: e.message, variant: "destructive" });
    } finally { setTesting(false); }
  };

  const doDryRun = async () => {
    setLoading(true); setDryRunResult(null);
    try {
      const data = await call("/pull?dry_run=1", { method: "POST" });
      setDryRunResult(data);
      toast({ title: "Dry run complete", description: `${data.would_change_count} file(s) would change.` });
    } catch (e: any) { toast({ title: "Dry run failed", description: e.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };

  const doPull = async () => {
    if (!confirm("Pull latest changes from GitHub? Old files will be backed up.")) return;
    try {
      const d = await call("/pull", { method: "POST" });
      setJobId(d.job_id);
      setJob({ type: "pull", status: "queued", progress: 0, message: "Starting..." });
    } catch (e: any) { toast({ title: "Pull failed to start", description: e.message, variant: "destructive" }); }
  };

  // Open the restore preview dialog for a chosen backup (or latest if none).
  const openRestoreDialog = async (backup?: Backup) => {
    const target = backup ?? backups.find(b => b.backup_id === latestBackupId) ?? null;
    if (!target) {
      // Fall back: just trigger rollback of latest with confirm()
      if (!confirm("Restore the latest backup? This overwrites current files.")) return;
      doRollbackNow(undefined);
      return;
    }
    setRestoreTarget(target);
    setRestoreConfirm("");
    setRestorePreview(null);
    setRestoreLoading(true);
    try {
      const d = await call(`/backups/${encodeURIComponent(target.backup_id)}/preview`);
      setRestorePreview(d);
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally { setRestoreLoading(false); }
  };

  const doRollbackNow = async (backupId?: string, confirmation?: string) => {
    try {
      const body: any = {};
      if (backupId) body.backup_id = backupId;
      if (confirmation) body.confirmation = confirmation;
      const d = await call("/rollback", { method: "POST", body });
      setJobId(d.job_id);
      setJob({ type: "rollback", status: "queued", progress: 0, message: "Starting...", backup_id: d.backup_id });
      setRestoreTarget(null); setRestorePreview(null); setRestoreConfirm("");
    } catch (e: any) { toast({ title: "Rollback failed to start", description: e.message, variant: "destructive" }); }
  };

  const deleteBackup = async (b: Backup) => {
    if (!confirm(`Delete backup "${b.backup_id}"? This cannot be undone.`)) return;
    try {
      await call(`/backups/${encodeURIComponent(b.backup_id)}`, { method: "DELETE" });
      toast({ title: "Backup deleted" });
      loadBackups();
    } catch (e: any) { toast({ title: "Delete failed", description: e.message, variant: "destructive" }); }
  };

  const cleanupBackups = async () => {
    if (!confirm(`Apply retention now (keep latest ${form.retention_count} OR within ${form.retention_days} days)?`)) return;
    try {
      const d = await call("/backups/cleanup", { method: "POST" });
      toast({ title: "Cleanup complete", description: `Deleted ${d.count} backup(s)` });
      loadBackups();
    } catch (e: any) { toast({ title: "Cleanup failed", description: e.message, variant: "destructive" }); }
  };

  const doMigrate = async () => {
    if (!confirm("Run php artisan migrate --force now?")) return;
    try {
      const d = await call("/migrate", { method: "POST" });
      toast({ title: "Migrations executed" });
      alert(d.output || "Done.");
    } catch (e: any) { toast({ title: "Migration failed", description: e.message, variant: "destructive" }); }
  };

  const showDiff = async (path: string) => {
    setDiffOpen(true); setDiffLoading(true); setDiffData(null);
    try {
      const d = await call(`/diff?path=${encodeURIComponent(path)}`);
      setDiffData({ path: d.path, local: d.local, remote: d.remote });
    } catch (e: any) {
      toast({ title: "Diff failed", description: e.message, variant: "destructive" });
      setDiffOpen(false);
    } finally { setDiffLoading(false); }
  };

  const downloadJobLog = async (id: string) => {
    try {
      const res = await fetch(`${API}/jobs/${id}/export`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `deploy-sync-${id}.txt`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Download failed", description: e.message, variant: "destructive" });
    }
  };

  const exportAuditCSV = () => {
    const header = ["id","created_at","event","status","user_name","branch","backup_id","job_id","ip_address","message"];
    const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [header.join(",")].concat(
      audit.map(r => header.map(k => escape((r as any)[k])).join(","))
    );
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `deploy-sync-audit-${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const jobActive = job && (job.status === "queued" || job.status === "running");
  const diffLines = diffData ? buildLineDiff(diffData.local, diffData.remote) : [];
  const statusBadgeClass = (st: string) =>
    st === "success" || st === "done" ? "bg-green-600" :
    st === "failed" ? "bg-destructive" :
    st === "started" || st === "running" ? "bg-blue-600" : "bg-muted";

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="w-6 h-6" /> GitHub Deploy Sync
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure GitHub source, preview changes, pull updates, manage backups, and review audit history.
        </p>
      </div>

      <Tabs defaultValue="sync">
        <TabsList>
          <TabsTrigger value="sync"><GitBranch className="w-4 h-4 mr-2" />Sync</TabsTrigger>
          <TabsTrigger value="backups" onClick={loadBackups}><Archive className="w-4 h-4 mr-2" />Backups</TabsTrigger>
          <TabsTrigger value="audit" onClick={() => loadAudit(1)}><ClipboardList className="w-4 h-4 mr-2" />Audit Log</TabsTrigger>
          <TabsTrigger value="settings"><Settings className="w-4 h-4 mr-2" />Settings</TabsTrigger>
        </TabsList>

        {/* ─── Sync tab ─── */}
        <TabsContent value="sync" className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Button onClick={loadAll} disabled={loading || !!jobActive} variant="outline">
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Check for Updates
            </Button>
            <Button onClick={doDryRun} disabled={loading || !!jobActive} variant="outline">
              <FileSearch className="w-4 h-4 mr-2" /> Dry Run
            </Button>
            <Button onClick={doMigrate} disabled={!!jobActive} variant="outline">
              <Database className="w-4 h-4 mr-2" /> Run Migrate
            </Button>
          </div>

          {job && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {jobActive ? <Loader2 className="w-4 h-4 animate-spin" /> :
                   job.status === "done" ? <CheckCircle2 className="w-4 h-4 text-green-600" /> :
                   <AlertTriangle className="w-4 h-4 text-destructive" />}
                  {job.type === "pull" ? "Pull Job" : "Rollback Job"} — {job.status}
                  {jobId && (
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => downloadJobLog(jobId)}>
                      <FileDown className="w-3.5 h-3.5 mr-1" /> Export log
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Progress value={job.progress} />
                <p className="text-xs text-muted-foreground">{job.message}</p>
                {job.backup_id && (
                  <p className="text-xs">Backup ID: <code className="text-xs">{job.backup_id}</code></p>
                )}
                {job.status === "done" && job.migrate_output && (
                  <pre className="text-xs bg-muted p-2 rounded max-h-40 overflow-auto">{job.migrate_output}</pre>
                )}
                {job.status === "done" && job.errors && job.errors.length > 0 && (
                  <div className="text-xs text-destructive">
                    {job.errors.length} error(s): {JSON.stringify(job.errors.slice(0, 3))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {dryRunResult && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSearch className="w-4 h-4" /> Dry Run Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm">
                  <Badge>{dryRunResult.would_change_count}</Badge> file(s) would change. Backup would be saved at{" "}
                  <code className="text-xs">{dryRunResult.would_backup_to}</code>
                </p>
                <ScrollArea className="h-48 border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0"><tr>
                      <th className="text-left p-2 w-24">Action</th><th className="text-left p-2 w-20">Backup</th>
                      <th className="text-left p-2">Path</th>
                    </tr></thead>
                    <tbody>
                      {dryRunResult.changes.map((c: any) => (
                        <tr key={c.path} className="border-t">
                          <td className="p-2"><Badge variant="outline">{c.action}</Badge></td>
                          <td className="p-2">{c.will_backup ? "yes" : "—"}</td>
                          <td className="p-2 font-mono">{c.path}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {status && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    Repository: <span className="font-mono text-sm">{status.repo}</span>
                    <Badge variant="secondary">{status.branch}</Badge>
                    {status.auto_migrate && <Badge className="bg-blue-600">Auto-migrate ON</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="border rounded p-3">
                      <div className="text-xs text-muted-foreground">Modified</div>
                      <div className="text-2xl font-bold text-orange-600">{status.counts.modified}</div>
                    </div>
                    <div className="border rounded p-3">
                      <div className="text-xs text-muted-foreground">New</div>
                      <div className="text-2xl font-bold text-green-600">{status.counts.added}</div>
                    </div>
                    <div className="border rounded p-3">
                      <div className="text-xs text-muted-foreground">Unchanged</div>
                      <div className="text-2xl font-bold text-muted-foreground">{status.counts.unchanged}</div>
                    </div>
                  </div>
                  {status.last_pulled_at && (
                    <p className="text-xs text-muted-foreground">
                      Last pulled: {new Date(status.last_pulled_at).toLocaleString()}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={doPull}
                      disabled={!!jobActive || status.counts.added + status.counts.modified === 0}>
                      <Download className="w-4 h-4 mr-2" />
                      Pull {status.counts.added + status.counts.modified} change(s)
                    </Button>
                    {status.has_backup && (
                      <Button variant="outline" onClick={() => openRestoreDialog()} disabled={!!jobActive}>
                        <Undo2 className="w-4 h-4 mr-2" /> Rollback Last Pull
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {(status.modified.length > 0 || status.added.length > 0) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-orange-500" /> Pending Changes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-80 border rounded">
                      <table className="w-full text-xs">
                        <thead className="bg-muted sticky top-0"><tr>
                          <th className="text-left p-2 w-20">Type</th>
                          <th className="text-left p-2">Path</th>
                          <th className="text-right p-2 w-24">Diff</th>
                        </tr></thead>
                        <tbody>
                          {status.modified.map((f) => (
                            <tr key={f.path} className="border-t">
                              <td className="p-2"><Badge variant="outline" className="text-orange-600">MOD</Badge></td>
                              <td className="p-2 font-mono">{f.path}</td>
                              <td className="p-2 text-right">
                                <Button size="sm" variant="ghost" onClick={() => showDiff(f.path)}>
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {status.added.map((f) => (
                            <tr key={f.path} className="border-t">
                              <td className="p-2"><Badge variant="outline" className="text-green-600">NEW</Badge></td>
                              <td className="p-2 font-mono">{f.path}</td>
                              <td className="p-2 text-right">
                                <Button size="sm" variant="ghost" onClick={() => showDiff(f.path)}>
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {status.counts.added + status.counts.modified === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-600" />
                    Your installation is up to date with <span className="font-mono">{status.branch}</span>.
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ─── Backups tab ─── */}
        <TabsContent value="backups" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-muted-foreground">
              Each pull creates a timestamped backup. Preview before restoring and prune old ones with retention.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={cleanupBackups}>
                <Trash2 className="w-4 h-4 mr-2" /> Apply retention
              </Button>
              <Button variant="outline" size="sm" onClick={loadBackups}>
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">Backup ID</th>
                    <th className="text-left p-2">Created</th>
                    <th className="text-left p-2">Branch</th>
                    <th className="text-right p-2">Files</th>
                    <th className="text-left p-2">Job ID</th>
                    <th className="text-right p-2 w-56">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No backups yet.</td></tr>
                  )}
                  {backups.map((b) => (
                    <tr key={b.backup_id} className="border-t">
                      <td className="p-2 font-mono">
                        {b.backup_id}
                        {b.backup_id === latestBackupId && <Badge className="ml-2 bg-blue-600">latest</Badge>}
                      </td>
                      <td className="p-2">{new Date(b.created_at).toLocaleString()}</td>
                      <td className="p-2">{b.branch || "—"}</td>
                      <td className="p-2 text-right">{b.file_count}</td>
                      <td className="p-2 font-mono text-[11px]">{b.job_id || "—"}</td>
                      <td className="p-2 text-right space-x-1">
                        <Button size="sm" variant="outline" disabled={!!jobActive}
                          onClick={() => openRestoreDialog(b)}>
                          <Eye className="w-3.5 h-3.5 mr-1" /> Preview &amp; Restore
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive"
                          disabled={!!jobActive || b.backup_id === latestBackupId}
                          onClick={() => deleteBackup(b)} title={b.backup_id === latestBackupId ? "Cannot delete latest backup" : "Delete"}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>


        {/* ─── Audit Log tab ─── */}
        <TabsContent value="audit" className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-xs">Filter:</Label>
            <select className="text-sm border rounded px-2 py-1 bg-background"
              value={auditFilter} onChange={(e) => { setAuditFilter(e.target.value); }}>
              <option value="">All events</option>
              <option value="pull">Pull</option>
              <option value="rollback">Rollback</option>
              <option value="dry_run">Dry Run</option>
              <option value="migrate">Migrate</option>
              <option value="test_connection">Test Connection</option>
              <option value="settings_update">Settings Update</option>
              <option value="backup_delete">Backup Delete</option>
              <option value="backup_cleanup">Backup Cleanup</option>
            </select>
            <Label className="text-xs ml-2">Page size:</Label>
            <select className="text-sm border rounded px-2 py-1 bg-background"
              value={auditPerPage} onChange={(e) => { const n = Number(e.target.value); setAuditPerPage(n); loadAudit(1, n); }}>
              {[10, 25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={() => loadAudit(1)}>
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={exportAuditCSV} disabled={audit.length === 0}>
              <FileDown className="w-4 h-4 mr-2" /> Export CSV
            </Button>
            <div className="flex items-center gap-1 ml-auto">
              <Button size="sm" variant="ghost" disabled={auditPage <= 1} onClick={() => loadAudit(auditPage - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {auditPage} / {auditLastPage} · {auditTotal} total
              </span>
              <Button size="sm" variant="ghost" disabled={auditPage >= auditLastPage} onClick={() => loadAudit(auditPage + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[60vh]">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Time</th>
                      <th className="text-left p-2">Event</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">User</th>
                      <th className="text-left p-2">Branch</th>
                      <th className="text-left p-2">Backup ID</th>
                      <th className="text-left p-2">Job ID</th>
                      <th className="text-left p-2">Message</th>
                      <th className="text-right p-2 w-20">Log</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.length === 0 && (
                      <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No audit entries.</td></tr>
                    )}
                    {audit.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td className="p-2 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                        <td className="p-2"><Badge variant="outline">{a.event}</Badge></td>
                        <td className="p-2"><Badge className={statusBadgeClass(a.status)}>{a.status}</Badge></td>
                        <td className="p-2">{a.user_name || "—"}</td>
                        <td className="p-2">{a.branch || "—"}</td>
                        <td className="p-2 font-mono text-[11px]">{a.backup_id || "—"}</td>
                        <td className="p-2 font-mono text-[11px]">{a.job_id || "—"}</td>
                        <td className="p-2 max-w-md truncate" title={a.message ?? ""}>{a.message || "—"}</td>
                        <td className="p-2 text-right">
                          {a.job_id && (
                            <Button size="sm" variant="ghost" onClick={() => downloadJobLog(a.job_id!)}>
                              <FileDown className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Settings tab ─── */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">GitHub Source Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 max-w-xl">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Owner</Label>
                  <Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
                </div>
                <div>
                  <Label>Repo</Label>
                  <Input value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Branch</Label>
                <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
              </div>
              <div>
                <Label>GitHub Personal Access Token (optional, for private repos)</Label>
                <Input type="password" placeholder={config?.has_token ? "•••••• (saved — leave empty to keep)" : "ghp_..."}
                  value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
                <p className="text-xs text-muted-foreground mt-1">
                  Stored encrypted (Laravel APP_KEY). Needs <code>repo</code> scope. Public repos work without a token.
                </p>
                {config?.has_token && (
                  <Button size="sm" variant="ghost" className="mt-1 text-destructive" onClick={clearToken}>
                    Clear stored token
                  </Button>
                )}
              </div>
              <div className="flex items-center justify-between border rounded p-3">
                <div>
                  <Label className="text-sm font-medium">Auto-run migrations after pull</Label>
                  <p className="text-xs text-muted-foreground">Executes <code>php artisan migrate --force</code> when migration files change.</p>
                </div>
                <Switch checked={form.auto_migrate} onCheckedChange={(v) => setForm({ ...form, auto_migrate: v })} />
              </div>

              <div className="border rounded p-3 space-y-3">
                <div>
                  <Label className="text-sm font-medium">Backup Retention</Label>
                  <p className="text-xs text-muted-foreground">Old backups are deleted automatically after each pull. The latest backup is always kept.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Keep latest (count)</Label>
                    <Input type="number" min={1} max={500} value={form.retention_count}
                      onChange={(e) => setForm({ ...form, retention_count: Math.max(1, Number(e.target.value) || 1) })} />
                  </div>
                  <div>
                    <Label className="text-xs">Keep within (days)</Label>
                    <Input type="number" min={1} max={3650} value={form.retention_days}
                      onChange={(e) => setForm({ ...form, retention_days: Math.max(1, Number(e.target.value) || 1) })} />
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={saveConfig}>Save Settings</Button>
                <Button variant="outline" onClick={doTestConnection} disabled={testing || !form.owner || !form.repo || !form.branch}>
                  {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plug className="w-4 h-4 mr-2" />}
                  Test Connection
                </Button>
              </div>

              {testResult && (
                <div className={`text-sm border rounded p-3 ${testResult.ok ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
                  {testResult.ok ? (
                    <>
                      <div className="font-medium flex items-center gap-2 text-green-700 dark:text-green-400">
                        <CheckCircle2 className="w-4 h-4" /> Connection OK
                      </div>
                      <ul className="text-xs mt-2 space-y-1">
                        <li>Repo: <code>{testResult.repo}</code> ({testResult.private ? "private" : "public"})</li>
                        <li>Branch: <code>{testResult.branch}</code></li>
                        <li>Token used: {testResult.token_used ? "yes" : "no"} {testResult.token_required && !testResult.token_used && <span className="text-destructive">(token required for private repo)</span>}</li>
                        <li>Latest commit: <code>{testResult.latest_commit}</code> — {testResult.latest_message}</li>
                        <li>Committed: {testResult.latest_date && new Date(testResult.latest_date).toLocaleString()}</li>
                      </ul>
                    </>
                  ) : (
                    <div className="text-destructive flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> {testResult.message}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{diffData?.path}</DialogTitle>
          </DialogHeader>
          {diffLoading && <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}
          {diffData && (
            <ScrollArea className="h-[65vh] border rounded">
              <pre className="text-xs font-mono">
                {diffLines.map((l, idx) => (
                  <div key={idx} className={
                    l.type === "add" ? "bg-green-500/10 text-green-700 dark:text-green-300" :
                    l.type === "del" ? "bg-red-500/10 text-red-700 dark:text-red-300" : ""
                  }>
                    <span className="inline-block w-10 text-right pr-1 text-muted-foreground select-none">{l.ln ?? ""}</span>
                    <span className="inline-block w-10 text-right pr-2 text-muted-foreground select-none">{l.rn ?? ""}</span>
                    <span className="inline-block w-4 select-none">
                      {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
                    </span>
                    <span className="whitespace-pre-wrap">{l.text}</span>
                  </div>
                ))}
              </pre>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
