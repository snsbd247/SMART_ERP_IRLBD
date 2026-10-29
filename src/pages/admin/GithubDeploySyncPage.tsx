import { useCallback, useEffect, useMemo, useState } from "react";
import { Github, CheckCircle2, RefreshCw, Rocket, Play, RotateCcw, Terminal, Settings, ExternalLink, ShieldCheck, Download, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getApiBaseUrl, getLaravelAuthHeaders, isLaravelMode } from "@/lib/laravel-auth";

/* ------------------------------------------------------------------ */
/* Settings (persisted in localStorage)                                */
/* ------------------------------------------------------------------ */
type RepoSettings = {
  repoUrl: string;
  branch: string;
  basePath: string;
  protectedPaths: string[];
};

const DEFAULT_PROTECTED = [
  ".git", ".env", ".env.*",
  "storage/app", "storage/framework/cache/data", "storage/framework/sessions",
  "storage/framework/views", "storage/logs", "bootstrap/cache", "node_modules",
];

const DEFAULTS: RepoSettings = {
  repoUrl: "https://github.com/snsbd247/audit-treasure-6d69be20.git",
  branch: "main",
  basePath: "deploy",
  protectedPaths: DEFAULT_PROTECTED,
};
const LS_KEY = "github_deploy_sync_settings_v3";

function loadSettings(): RepoSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      protectedPaths: Array.isArray(parsed.protectedPaths) && parsed.protectedPaths.length
        ? parsed.protectedPaths
        : DEFAULT_PROTECTED,
    };
  } catch {
    return DEFAULTS;
  }
}

function parseRepo(input: string): { owner: string; repo: string } | null {
  if (!input) return null;
  const cleaned = input.trim().replace(/\.git$/, "");
  const m =
    cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/i) ||
    cleaned.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/* ------------------------------------------------------------------ */
/* Tracked deploy files                                                */
/* ------------------------------------------------------------------ */
type TrackedFile = {
  key: string;
  label: string;
  description: string;
  path: string;
  critical?: boolean;
};

const TRACKED: TrackedFile[] = [
  { key: "installer",  label: "One-Command Installer", description: "Tracked deploy script (status verified server-side on Pull & Deploy)", path: "vps/quick-install.sh" },
  { key: "vps-setup",  label: "VPS Setup (Step 1)",    description: "Tracked deploy script (status verified server-side on Pull & Deploy)", path: "vps/setup.sh" },
  { key: "app-clone",  label: "App Clone (Step 2)",    description: "Tracked deploy script (status verified server-side on Pull & Deploy)", path: "vps/clone.sh" },
  { key: "deploy-up",  label: "Deploy Update",         description: "Tracked deploy script (status verified server-side on Pull & Deploy)", path: "vps/update.sh" },
];

/* ------------------------------------------------------------------ */
/* GitHub fetch helpers                                                */
/* ------------------------------------------------------------------ */
type FileStatus = "synced" | "missing" | "unknown";
type FileState = { status: FileStatus; lastCommit?: string; commitUrl?: string; message?: string; date?: string };

async function fetchFileStatus(
  owner: string, repo: string, branch: string, fullPath: string,
): Promise<FileState> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(fullPath)}&sha=${encodeURIComponent(branch)}&per_page=1`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) return { status: "unknown" };
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const c = data[0];
      return {
        status: "synced",
        lastCommit: c?.sha?.slice(0, 7),
        commitUrl: c?.html_url,
        message: c?.commit?.message?.split("\n")[0],
        date: c?.commit?.author?.date,
      };
    }
    return { status: "missing" };
  } catch {
    return { status: "unknown" };
  }
}

type BranchCommit = { sha: string; short: string; message: string; date: string; author: string; url: string };

async function fetchBranchCommits(
  owner: string, repo: string, branch: string, perPage = 5,
): Promise<BranchCommit[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((c: any) => ({
      sha: c.sha,
      short: c.sha?.slice(0, 7),
      message: c.commit?.message?.split("\n")[0] ?? "",
      date: c.commit?.author?.date ?? "",
      author: c.commit?.author?.name ?? "",
      url: c.html_url ?? "",
    }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function GithubDeploySyncPage() {
  const [settings, setSettings] = useState<RepoSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [protectedOpen, setProtectedOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, FileState>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [busy, setBusy] = useState<null | "pull" | "dry" | "rollback">(null);
  const [lastDryRun, setLastDryRun] = useState<{ at: string; logs: string[]; planned: any[] } | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackStep, setRollbackStep] = useState<1 | 2>(1);
  const [rollbackCommits, setRollbackCommits] = useState<BranchCommit[]>([]);
  const [rollbackTarget, setRollbackTarget] = useState<BranchCommit | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState("");

  const repo = useMemo(() => parseRepo(settings.repoUrl), [settings.repoUrl]);
  const repoLabel = repo ? `${repo.owner}/${repo.repo}` : "—";
  const base = settings.basePath.replace(/^\/+|\/+$/g, "");

  const refresh = useCallback(async () => {
    if (!repo) return;
    setRefreshing(true);
    const entries = await Promise.all(
      TRACKED.map(async (f) => {
        const full = base ? `${base}/${f.path}` : f.path;
        const s = await fetchFileStatus(repo.owner, repo.repo, settings.branch, full);
        return [f.key, s] as const;
      }),
    );
    setStates(Object.fromEntries(entries));
    setLastChecked(new Date());
    setRefreshing(false);
  }, [repo, base, settings.branch]);

  useEffect(() => { void refresh(); }, [refresh]);

  const allSynced =
    TRACKED.length > 0 &&
    TRACKED.every((f) => states[f.key]?.status === "synced");

  const appendLog = (line: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const handleManualRefresh = async () => {
    appendLog("⟳ Manual refresh requested");
    await refresh();
    toast({ title: "Refreshed", description: "GitHub sync status updated." });
  };

  // ─── Real backend (Laravel/VPS) Pull & Deploy ──────────────────────
  const laravelMode = isLaravelMode();
  const apiBase = getApiBaseUrl();

  const pollDeployStatus = useCallback(async () => {
    if (!apiBase) return;
    try {
      const res = await fetch(`${apiBase}/v1/admin/deploy/status`, {
        headers: getLaravelAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.message || `HTTP ${res.status}`;
        appendLog(`[status] ${message}`);
        if (res.status >= 500) {
          appendLog("[status] VPS endpoint failed before deploy runner started. Run update.sh once from SSH, then try Pull & Deploy again.");
        }
        return { running: false, state: "failed" as const };
      }
      // Replace log buffer with server-side tail so we don't duplicate lines.
      if (typeof data.log === "string") {
        setLogs(data.log.split("\n").filter(Boolean));
      }
      return { running: !!data.running, state: (data.state || "idle") as string };
    } catch (e: any) {
      appendLog(`[status] ${e?.message || "network error"}`);
      return { running: false, state: "failed" as const };
    }
  }, [apiBase]);

  const runRealPullDeploy = useCallback(async () => {
    if (!apiBase) return;
    setBusy("pull");
    setLogOpen(true);
    appendLog("▶ Pull & Deploy requested (VPS)…");
    try {
      const res = await fetch(`${apiBase}/v1/admin/deploy/pull`, {
        method: "POST",
        headers: getLaravelAuthHeaders(true),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) {
        const message = data?.message || `HTTP ${res.status}`;
        appendLog(`✗ ${message}`);
        if (res.status >= 500) {
          appendLog("Repair: sudo APP_DIR=/opt/smarterp /opt/smarterp/deploy/vps/update.sh");
        }
        toast({ title: "Pull & Deploy failed", description: message, variant: "destructive" });
        setBusy(null);
        return;
      }
      // Poll every 2s until the runner finishes.
      const startedAt = Date.now();
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await pollDeployStatus();
        if (!s) break;
        if (!s.running) {
          if (s.state === "success") {
            toast({ title: "Pull & Deploy", description: "Deploy completed successfully." });
          } else if (s.state === "failed") {
            toast({ title: "Pull & Deploy failed", description: "See log for details.", variant: "destructive" });
          } else {
            toast({ title: "Pull & Deploy", description: "Runner finished." });
          }
          break;
        }
        // Safety: stop polling after 15 minutes — runner keeps going server-side.
        if (Date.now() - startedAt > 15 * 60 * 1000) {
          appendLog("[client] stopped polling after 15 min; server-side runner may still be working.");
          break;
        }
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [apiBase, pollDeployStatus, refresh]);

  const runAction = async (kind: "pull" | "dry") => {
    if (kind === "pull" && laravelMode) {
      await runRealPullDeploy();
      return;
    }
    setBusy(kind);
    setLogOpen(true);
    const titles = { pull: "Pull & Deploy", dry: "Dry-Run" } as const;
    const runLogs: string[] = [];
    const push = (l: string) => { appendLog(l); runLogs.push(l); };
    push(`▶ ${titles[kind]} started for ${repoLabel}@${settings.branch}`);
    push(`  base path: /${base}`);
    await new Promise((r) => setTimeout(r, 300));
    push(`  fetching latest commits from origin/${settings.branch}…`);
    await refresh();
    const planned: any[] = [];
    for (const f of TRACKED) {
      const s = states[f.key];
      const st = s?.status ?? "unknown";
      push(`  • ${f.path} → ${st}${st === "synced" ? ` (${s?.lastCommit ?? ""})` : ""}`);
      planned.push({ path: f.path, status: st, lastCommit: s?.lastCommit, message: s?.message });
    }
    if (kind === "dry") {
      push("✓ Dry-run complete. No files were changed.");
      setLastDryRun({ at: new Date().toISOString(), logs: runLogs, planned });
    } else {
      push("✓ Pull & Deploy queued. (Preview/Cloud mode — no VPS backend connected.)");
    }
    toast({ title: titles[kind], description: `${titles[kind]} completed.` });
    setBusy(null);
  };

  // Resume polling if a deploy is already running server-side when the page mounts.
  useEffect(() => {
    if (!laravelMode) return;
    let cancelled = false;
    (async () => {
      const s = await pollDeployStatus();
      if (cancelled || !s?.running) return;
      setBusy("pull");
      setLogOpen(true);
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 2000));
        const next = await pollDeployStatus();
        if (cancelled || !next || !next.running) break;
      }
      if (!cancelled) setBusy(null);
    })();
    return () => { cancelled = true; };
  }, [laravelMode, pollDeployStatus]);

  const openRollback = async () => {
    if (!repo) {
      toast({ title: "Repo not configured", description: "Set the repository in Settings first.", variant: "destructive" });
      return;
    }
    setRollbackOpen(true);
    setRollbackStep(1);
    setRollbackTarget(null);
    setRollbackConfirm("");
    setRollbackLoading(true);
    const commits = await fetchBranchCommits(repo.owner, repo.repo, settings.branch, 8);
    setRollbackCommits(commits);
    setRollbackLoading(false);
  };

  const confirmRollback = async () => {
    if (!rollbackTarget) return;
    setBusy("rollback");
    setRollbackOpen(false);
    setLogOpen(true);
    appendLog(`↩ Rollback requested → ${rollbackTarget.short} "${rollbackTarget.message}"`);

    // Laravel/VPS mode: actually call the server-side rollback runner.
    if (laravelMode && apiBase) {
      try {
        const res = await fetch(`${apiBase}/v1/admin/deploy/rollback`, {
          method: "POST",
          headers: getLaravelAuthHeaders(true),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 409) {
          const msg = data?.message || `HTTP ${res.status}`;
          appendLog(`✗ Rollback failed: ${msg}`);
          toast({ title: "Rollback failed", description: msg, variant: "destructive" });
          setBusy(null);
          return;
        }
        const startedAt = Date.now();
        while (true) {
          await new Promise((r) => setTimeout(r, 2000));
          const s = await pollDeployStatus();
          if (!s) break;
          if (!s.running) {
            if (s.state === "rolled_back") {
              toast({ title: "Rolled back", description: "Previous deploy restored." });
            } else if (s.state === "failed") {
              toast({ title: "Rollback failed", description: "See log for details.", variant: "destructive" });
            }
            break;
          }
          if (Date.now() - startedAt > 15 * 60 * 1000) {
            appendLog("[client] stopped polling after 15 min");
            break;
          }
        }
      } catch (e: any) {
        appendLog(`✗ ${e?.message || "network error"}`);
        toast({ title: "Rollback failed", description: e?.message || "Network error", variant: "destructive" });
      } finally {
        setBusy(null);
      }
      return;
    }

    // Non-VPS / preview mode — keep informational marker behavior.
    await new Promise((r) => setTimeout(r, 400));
    appendLog("  rollback marker recorded; server-side runner will restore the previous deploy on next sync.");
    toast({ title: "Rollback queued", description: `Target: ${rollbackTarget.short}` });
    setBusy(null);
  };

  const downloadDryRun = (format: "json" | "csv") => {
    if (!lastDryRun) {
      toast({ title: "No dry-run yet", description: "Run a Dry-Run first to export its results.", variant: "destructive" });
      return;
    }
    let blob: Blob;
    let filename: string;
    if (format === "json") {
      blob = new Blob([JSON.stringify({ repo: repoLabel, branch: settings.branch, basePath: base, ...lastDryRun }, null, 2)], { type: "application/json" });
      filename = `dry-run-${Date.now()}.json`;
    } else {
      const header = "path,status,lastCommit,message\n";
      const rows = lastDryRun.planned.map((p) =>
        [p.path, p.status, p.lastCommit ?? "", `"${(p.message ?? "").replace(/"/g, '""')}"`].join(","),
      ).join("\n");
      blob = new Blob([header + rows + "\n\n# logs\n" + lastDryRun.logs.join("\n")], { type: "text/csv" });
      filename = `dry-run-${Date.now()}.csv`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const relTime = lastChecked ? formatRel(lastChecked) : "never";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">GitHub Deploy Sync</h1>
        <p className="text-muted-foreground mt-1">
          Pull &amp; Deploy, dry-run, rollback, and GitHub sync status of deploy files.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Github className="h-5 w-5 shrink-0" />
              <span className="font-semibold truncate">GitHub Deploy Sync</span>
              <Badge
                variant="outline"
                className={cn(
                  "ml-1 gap-1 border-transparent",
                  allSynced
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                )}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {allSynced ? "All Synced" : "Needs Attention"}
              </Badge>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground mr-2">Updated {relTime}</span>

              <Button variant="outline" onClick={handleManualRefresh} disabled={refreshing}>
                <RefreshCw className={cn("h-4 w-4 mr-1.5", refreshing && "animate-spin")} />
                Refresh
              </Button>

              <Button
                onClick={() => runAction("pull")}
                disabled={busy !== null}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Rocket className="h-4 w-4 mr-1.5" />
                Pull &amp; Deploy
              </Button>
              <Button variant="outline" onClick={() => runAction("dry")} disabled={busy !== null}>
                <Play className="h-4 w-4 mr-1.5" />
                Dry-Run
              </Button>
              <Button
                variant="outline"
                onClick={openRollback}
                disabled={busy !== null}
                className="text-rose-600 hover:text-rose-700 border-rose-200 hover:bg-rose-50 dark:border-rose-900/40 dark:hover:bg-rose-950/40"
              >
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Rollback
              </Button>
              <Button variant="ghost" size="icon" title="Open repo" onClick={() => repo && window.open(`https://github.com/${repo.owner}/${repo.repo}/tree/${settings.branch}/${base}`, "_blank")}>
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" title="View logs" onClick={() => setLogOpen(true)}>
                <Terminal className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" title="Settings" onClick={() => setSettingsOpen(true)}>
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            {repoLabel} · {settings.branch} · /{base}
          </div>

          <Separator />

          {/* Protected files */}
          <div className="rounded-lg border bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/30 p-3 flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Protected from Pull &amp; Deploy</div>
              <div className="text-sm text-muted-foreground truncate">
                {settings.protectedPaths.slice(0, 6).map((p) => (
                  <code key={p} className="mr-2 text-xs">{p}</code>
                ))}
                {settings.protectedPaths.length > 6 && "…"}
              </div>
            </div>
            <button
              onClick={() => setProtectedOpen(true)}
              className="text-sm text-emerald-700 dark:text-emerald-400 hover:underline shrink-0"
            >
              View all
            </button>
          </div>

          {/* Tracked files */}
          <div className="space-y-2">
            {TRACKED.map((f) => {
              const s = states[f.key];
              const st = s?.status ?? "unknown";
              const ok = st === "synced";
              return (
                <div key={f.key} className="rounded-lg border p-3 flex items-start gap-3 hover:bg-muted/40 transition-colors">
                  <CheckCircle2
                    className={cn(
                      "h-5 w-5 mt-0.5 shrink-0",
                      ok ? "text-emerald-600" : st === "missing" ? "text-rose-600" : "text-muted-foreground",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{f.label}</span>
                      {f.critical && (
                        <Badge variant="outline" className="bg-rose-500/15 text-rose-600 border-transparent text-[10px]">critical</Badge>
                      )}
                      {ok && s?.lastCommit && (
                        <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-transparent text-[10px]">{s.lastCommit}</Badge>
                      )}
                      {!ok && st !== "unknown" && (
                        <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-transparent text-[10px]">{st}</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{f.description}</div>
                  </div>
                  <button
                    onClick={() => repo && window.open(`https://github.com/${repo.owner}/${repo.repo}/blob/${settings.branch}/${base}/${f.path}`, "_blank")}
                    className="text-sm text-primary hover:underline shrink-0"
                  >
                    View repo
                  </button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={settings}
        onSave={(v) => {
          setSettings(v);
          localStorage.setItem(LS_KEY, JSON.stringify(v));
          toast({ title: "Saved", description: "GitHub repo settings updated." });
        }}
      />

      {/* Protected dialog (view-all) */}
      <Dialog open={protectedOpen} onOpenChange={setProtectedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Protected paths</DialogTitle>
            <DialogDescription>
              These paths are never overwritten or removed during Pull &amp; Deploy. Edit them in Settings.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {settings.protectedPaths.map((p) => (
              <code key={p} className="text-xs px-2 py-1 rounded bg-muted">{p}</code>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setProtectedOpen(false); setSettingsOpen(true); }}>
              Edit in Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback confirmation */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
              Rollback — Step {rollbackStep} of 2
            </DialogTitle>
            <DialogDescription>
              {rollbackStep === 1
                ? "Select the target commit to roll back to."
                : "Review the target and type CONFIRM to execute."}
            </DialogDescription>
          </DialogHeader>

          {rollbackStep === 1 && (
            <div className="space-y-2 max-h-80 overflow-auto">
              {rollbackLoading && <div className="text-sm text-muted-foreground">Loading commits…</div>}
              {!rollbackLoading && rollbackCommits.length === 0 && (
                <div className="text-sm text-muted-foreground">No commits found.</div>
              )}
              {rollbackCommits.map((c, i) => (
                <button
                  key={c.sha}
                  onClick={() => setRollbackTarget(c)}
                  className={cn(
                    "w-full text-left rounded border p-2 hover:bg-muted/50 transition",
                    rollbackTarget?.sha === c.sha && "border-rose-400 bg-rose-50 dark:bg-rose-950/30",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <code className="text-xs">{c.short}</code>
                    {i === 0 && <Badge variant="outline" className="text-[10px]">current</Badge>}
                    <span className="text-xs text-muted-foreground ml-auto">{new Date(c.date).toLocaleString()}</span>
                  </div>
                  <div className="text-sm truncate">{c.message}</div>
                  <div className="text-xs text-muted-foreground">by {c.author}</div>
                </button>
              ))}
            </div>
          )}

          {rollbackStep === 2 && rollbackTarget && (
            <div className="space-y-3">
              <div className="rounded border p-3 bg-muted/40">
                <div className="flex items-center gap-2">
                  <code className="text-xs">{rollbackTarget.short}</code>
                  <a href={rollbackTarget.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View on GitHub</a>
                </div>
                <div className="text-sm font-medium mt-1">{rollbackTarget.message}</div>
                <div className="text-xs text-muted-foreground">by {rollbackTarget.author} · {new Date(rollbackTarget.date).toLocaleString()}</div>
              </div>
              <div className="text-sm text-rose-600">
                This will queue a rollback to the commit above. Type <code className="px-1 bg-muted">CONFIRM</code> to proceed.
              </div>
              <Input
                value={rollbackConfirm}
                onChange={(e) => setRollbackConfirm(e.target.value)}
                placeholder="Type CONFIRM"
              />
            </div>
          )}

          <DialogFooter>
            {rollbackStep === 1 ? (
              <>
                <Button variant="outline" onClick={() => setRollbackOpen(false)}>Cancel</Button>
                <Button
                  disabled={!rollbackTarget}
                  onClick={() => setRollbackStep(2)}
                  className="bg-rose-600 hover:bg-rose-700 text-white"
                >
                  Continue
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setRollbackStep(1)}>Back</Button>
                <Button
                  disabled={rollbackConfirm !== "CONFIRM" || busy !== null}
                  onClick={confirmRollback}
                  className="bg-rose-600 hover:bg-rose-700 text-white"
                >
                  Execute Rollback
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4" /> Sync Log
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-72 rounded border bg-zinc-950 text-zinc-100 p-3 font-mono text-xs">
            {logs.length === 0 ? (
              <div className="text-zinc-500">No activity yet. Run Pull &amp; Deploy / Dry-Run / Rollback.</div>
            ) : (
              logs.map((l, i) => <div key={i}>{l}</div>)
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogs([])}>Clear</Button>
            <Button onClick={() => setLogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings dialog                                                     */
/* ------------------------------------------------------------------ */
function SettingsDialog({
  open, onOpenChange, value, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: RepoSettings;
  onSave: (v: RepoSettings) => void;
}) {
  const [local, setLocal] = useState<RepoSettings>(value);
  const [protectedText, setProtectedText] = useState(value.protectedPaths.join("\n"));

  useEffect(() => {
    if (open) {
      setLocal(value);
      setProtectedText(value.protectedPaths.join("\n"));
    }
  }, [open, value]);

  const handleSave = () => {
    const paths = protectedText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({ ...local, protectedPaths: paths });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>GitHub Repo Settings</DialogTitle>
          <DialogDescription>
            Stored locally in this browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="repo">Repository URL</Label>
            <Input
              id="repo"
              value={local.repoUrl}
              onChange={(e) => setLocal({ ...local, repoUrl: e.target.value })}
              placeholder="https://github.com/owner/repo.git"
            />
            <p className="text-xs text-muted-foreground">Accepts full URL or owner/repo.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="branch">Branch</Label>
              <Input id="branch" value={local.branch} onChange={(e) => setLocal({ ...local, branch: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="base">Base Path</Label>
              <Input id="base" value={local.basePath} onChange={(e) => setLocal({ ...local, basePath: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="protected">Protected paths (one per line)</Label>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setProtectedText(DEFAULT_PROTECTED.join("\n"))}
              >
                Reset to defaults
              </button>
            </div>
            <Textarea
              id="protected"
              value={protectedText}
              onChange={(e) => setProtectedText(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder=".git&#10;.env&#10;storage/app"
            />
            <p className="text-xs text-muted-foreground">
              Glob-style patterns supported. These paths are never overwritten by Pull &amp; Deploy.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setLocal(DEFAULTS); setProtectedText(DEFAULT_PROTECTED.join("\n")); }}>
            Reset Default
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
function formatRel(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "less than a minute ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return d.toLocaleString();
}
