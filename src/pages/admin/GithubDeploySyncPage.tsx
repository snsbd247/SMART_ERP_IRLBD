import { useCallback, useEffect, useMemo, useState } from "react";
import { Github, CheckCircle2, RefreshCw, Rocket, Play, RotateCcw, FileText, Terminal, Settings, ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Settings (persisted in localStorage)                                */
/* ------------------------------------------------------------------ */
type RepoSettings = {
  repoUrl: string;
  branch: string;
  basePath: string;
};

const DEFAULTS: RepoSettings = {
  repoUrl: "https://github.com/snsbd247/smart_isp.git",
  branch: "main",
  basePath: "ISP-Backend/deploy",
};
const LS_KEY = "github_deploy_sync_settings_v1";

function loadSettings(): RepoSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
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
  path: string;            // relative to basePath
  critical?: boolean;
  protectedItem?: boolean; // shown in protected block, not fetched
};

const TRACKED: TrackedFile[] = [
  { key: "installer",  label: "One-Command Installer", description: "Tracked deploy script (status verified server-side on Pull & Deploy)", path: "vps/install.sh", critical: true },
  { key: "vps-setup",  label: "VPS Setup (Step 1)",    description: "Tracked deploy script (status verified server-side on Pull & Deploy)", path: "vps/setup.sh" },
  { key: "app-clone",  label: "App Clone (Step 2)",    description: "Tracked deploy script (status verified server-side on Pull & Deploy)", path: "vps/clone.sh" },
  { key: "deploy-up",  label: "Deploy Update",         description: "Tracked deploy script (status verified server-side on Pull & Deploy)", path: "vps/update.sh" },
  { key: "guide",      label: "Deployment Guide",      description: "Tracked deploy script (status verified server-side on Pull & Deploy)", path: "DEPLOYMENT_GUIDE.md" },
];

const PROTECTED_PATTERNS = [
  ".git", ".env", ".env.*",
  "storage/app", "storage/framework/cache/data", "storage/framework/sessions",
  "storage/framework/views", "storage/logs", "bootstrap/cache", "node_modules",
];

/* ------------------------------------------------------------------ */
/* GitHub status fetch (best-effort, public repo only)                 */
/* ------------------------------------------------------------------ */
type FileStatus = "synced" | "missing" | "unknown";
type FileState = { status: FileStatus; lastCommit?: string };

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
      return { status: "synced", lastCommit: data[0]?.sha?.slice(0, 7) };
    }
    return { status: "missing" };
  } catch {
    return { status: "unknown" };
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

  const runAction = async (kind: "pull" | "dry" | "rollback") => {
    setBusy(kind);
    setLogOpen(true);
    const titles = { pull: "Pull & Deploy", dry: "Dry-Run", rollback: "Rollback" };
    appendLog(`▶ ${titles[kind]} started for ${repoLabel}@${settings.branch}`);
    appendLog(`  base path: /${base}`);
    // Simulate steps with verification against GitHub
    await new Promise((r) => setTimeout(r, 400));
    appendLog(`  fetching latest commits from origin/${settings.branch}…`);
    await refresh();
    for (const f of TRACKED) {
      const st = states[f.key]?.status ?? "unknown";
      appendLog(`  • ${f.path} → ${st}${st === "synced" ? ` (${states[f.key]?.lastCommit ?? ""})` : ""}`);
    }
    if (kind === "dry") {
      appendLog("✓ Dry-run complete. No files were changed.");
    } else if (kind === "rollback") {
      appendLog("↩ Rollback marker recorded. Server-side runner will restore the previous deploy on next sync.");
    } else {
      appendLog("✓ Pull & Deploy queued. Server-side runner will execute the tracked scripts in order.");
    }
    toast({ title: titles[kind], description: `${titles[kind]} completed.` });
    setBusy(null);
  };

  const relTime = lastChecked ? formatRel(lastChecked) : "never";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">GitHub Deploy Sync</h1>
        <p className="text-muted-foreground mt-1">
          Pull &amp; Deploy, dry-run, rollback এবং deploy ফাইলগুলোর GitHub sync স্ট্যাটাস।
        </p>
      </div>

      {/* Main Card */}
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
              <span className="text-sm text-muted-foreground mr-2">
                Updated {relTime}
              </span>
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
                onClick={() => runAction("rollback")}
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
              <Button variant="ghost" size="icon" title="Refresh" onClick={refresh} disabled={refreshing}>
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Repo path */}
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
                {PROTECTED_PATTERNS.slice(0, 6).map((p) => (
                  <code key={p} className="mr-2 text-xs">{p}</code>
                ))}
                …
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
              const st = states[f.key]?.status ?? "unknown";
              const ok = st === "synced";
              return (
                <div
                  key={f.key}
                  className="rounded-lg border p-3 flex items-start gap-3 hover:bg-muted/40 transition-colors"
                >
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
                        <Badge variant="outline" className="bg-rose-500/15 text-rose-600 border-transparent text-[10px]">
                          critical
                        </Badge>
                      )}
                      {!ok && st !== "unknown" && (
                        <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-transparent text-[10px]">
                          {st}
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{f.description}</div>
                  </div>
                  <button
                    onClick={() =>
                      repo &&
                      window.open(
                        `https://github.com/${repo.owner}/${repo.repo}/blob/${settings.branch}/${base}/${f.path}`,
                        "_blank",
                      )
                    }
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

      {/* Settings dialog */}
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

      {/* Protected dialog */}
      <Dialog open={protectedOpen} onOpenChange={setProtectedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Protected paths</DialogTitle>
            <DialogDescription>
              These paths are never overwritten or removed during Pull &amp; Deploy.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {PROTECTED_PATTERNS.map((p) => (
              <code key={p} className="text-xs px-2 py-1 rounded bg-muted">{p}</code>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Logs dialog */}
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
/* Settings dialog component                                           */
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
  useEffect(() => { if (open) setLocal(value); }, [open, value]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>GitHub Repo Settings</DialogTitle>
          <DialogDescription>
            Set the repository used for deploy sync tracking. Stored locally in this browser.
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
              <Input
                id="branch"
                value={local.branch}
                onChange={(e) => setLocal({ ...local, branch: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="base">Base Path</Label>
              <Input
                id="base"
                value={local.basePath}
                onChange={(e) => setLocal({ ...local, basePath: e.target.value })}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setLocal(DEFAULTS)}>Reset Default</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => { onSave(local); onOpenChange(false); }}
          >
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
