import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  GitBranch, Download, Undo2, RefreshCw, AlertTriangle, CheckCircle2,
  Eye, Settings, Database, Loader2, FileSearch,
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
  last_pulled_at: string | null; last_backup_id: string | null;
};
type Job = {
  type: string; status: "queued" | "running" | "done" | "failed";
  progress: number; message: string;
  pulled_count?: number; pulled?: string[]; errors?: any[];
  restored_count?: number; backup_id?: string; migrate_output?: string;
};

const API = "/api/v1/deploy-sync";

async function call(path: string, opts: { method?: string; body?: any } = {}) {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(`${API}${path}`, {
    method: opts.method || "GET",
    headers: {
      Accept: "application/json", "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  // LCS-based minimal diff
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
  const pollRef = useRef<number | null>(null);

  // Config form state
  const [form, setForm] = useState({ owner: "", repo: "", branch: "", token: "", auto_migrate: false });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cfg, st] = await Promise.all([call("/config"), call("/status")]);
      setConfig(cfg);
      setStatus(st);
      setForm({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: "", auto_migrate: cfg.auto_migrate });
    } catch (e: any) {
      toast({ title: "Failed to load", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const loadConfigOnly = async () => {
    try {
      const cfg = await call("/config");
      setConfig(cfg);
      setForm({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: "", auto_migrate: cfg.auto_migrate });
    } catch (e: any) {
      toast({ title: "Failed to load config", description: e.message, variant: "destructive" });
    }
  };

  useEffect(() => { loadConfigOnly(); }, []);

  // Job polling
  useEffect(() => {
    if (!jobId) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const j: Job = await call(`/jobs/${jobId}`);
        setJob(j);
        if (j.status === "done" || j.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (j.status === "done") {
            toast({ title: `${j.type === "pull" ? "Pull" : "Rollback"} complete`, description: j.message });
            loadAll();
          } else {
            toast({ title: "Job failed", description: j.message, variant: "destructive" });
          }
        }
      } catch (e: any) {
        if (pollRef.current) clearInterval(pollRef.current);
        toast({ title: "Polling error", description: e.message, variant: "destructive" });
      }
    }, 1500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
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

  const doRollback = async () => {
    if (!confirm("Restore latest backup? This overwrites current files.")) return;
    try {
      const d = await call("/rollback", { method: "POST" });
      setJobId(d.job_id);
      setJob({ type: "rollback", status: "queued", progress: 0, message: "Starting..." });
    } catch (e: any) { toast({ title: "Rollback failed to start", description: e.message, variant: "destructive" }); }
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

  const jobActive = job && (job.status === "queued" || job.status === "running");
  const diffLines = diffData ? buildLineDiff(diffData.local, diffData.remote) : [];

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="w-6 h-6" /> GitHub Deploy Sync
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure GitHub source, preview changes, and pull updates safely. Background jobs report progress.
          </p>
        </div>
      </div>

      <Tabs defaultValue="sync">
        <TabsList>
          <TabsTrigger value="sync"><GitBranch className="w-4 h-4 mr-2" />Sync</TabsTrigger>
          <TabsTrigger value="settings"><Settings className="w-4 h-4 mr-2" />Settings</TabsTrigger>
        </TabsList>

        {/* ─── Sync tab ─── */}
        <TabsContent value="sync" className="space-y-4">
          <div className="flex gap-2">
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

          {/* Job progress */}
          {job && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {jobActive ? <Loader2 className="w-4 h-4 animate-spin" /> :
                   job.status === "done" ? <CheckCircle2 className="w-4 h-4 text-green-600" /> :
                   <AlertTriangle className="w-4 h-4 text-destructive" />}
                  {job.type === "pull" ? "Pull Job" : "Rollback Job"} — {job.status}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Progress value={job.progress} />
                <p className="text-xs text-muted-foreground">{job.message}</p>
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

          {/* Dry run result */}
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

          {/* Status */}
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
                      <Button variant="outline" onClick={doRollback} disabled={!!jobActive}>
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
              <Button onClick={saveConfig}>Save Settings</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Diff Dialog */}
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
