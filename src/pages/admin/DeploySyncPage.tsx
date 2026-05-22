import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { GitBranch, Download, Undo2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

type StatusFile = { path: string; remote_sha: string; local_sha?: string; size?: number };
type StatusData = {
  branch: string;
  repo: string;
  counts: { added: number; modified: number; unchanged: number };
  added: StatusFile[];
  modified: StatusFile[];
  last_pulled_at: string | null;
  has_backup: boolean;
};

const apiBase = "/api/v1/deploy-sync";

async function call(path: string, method: "GET" | "POST" = "GET") {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || `HTTP ${res.status}`);
  }
  return json.data;
}

export default function DeploySyncPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const data = await call("/status");
      setStatus(data);
    } catch (e: any) {
      toast({ title: "Status check failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const doPull = async () => {
    if (!confirm("Pull latest changes from GitHub? Old files will be backed up.")) return;
    setPulling(true);
    try {
      const data = await call("/pull", "POST");
      toast({ title: "Pull complete", description: `${data.pulled_count} file(s) updated. Backup: ${data.backup_id}` });
      await loadStatus();
    } catch (e: any) {
      toast({ title: "Pull failed", description: e.message, variant: "destructive" });
    } finally {
      setPulling(false);
    }
  };

  const doRollback = async () => {
    if (!confirm("Restore latest backup? This overwrites current files.")) return;
    try {
      const data = await call("/rollback", "POST");
      toast({ title: "Rollback complete", description: `${data.restored_count} file(s) restored.` });
      await loadStatus();
    } catch (e: any) {
      toast({ title: "Rollback failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitBranch className="w-6 h-6" /> GitHub Deploy Sync
          </h1>
          <p className="text-sm text-muted-foreground">
            Pull latest backend updates from GitHub directly into cPanel. Protected paths (.env, vendor, storage) are never touched.
          </p>
        </div>
        <Button onClick={loadStatus} disabled={loading} variant="outline">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Check for Updates
        </Button>
      </div>

      {status && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Repository: <span className="font-mono text-sm">{status.repo}</span>
                <Badge variant="secondary">{status.branch}</Badge>
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
                <Button
                  onClick={doPull}
                  disabled={pulling || status.counts.added + status.counts.modified === 0}
                >
                  <Download className={`w-4 h-4 mr-2 ${pulling ? "animate-pulse" : ""}`} />
                  {pulling ? "Pulling..." : `Pull ${status.counts.added + status.counts.modified} change(s)`}
                </Button>
                {status.has_backup && (
                  <Button variant="outline" onClick={doRollback}>
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
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                  Pending Changes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-72 border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-2 w-20">Type</th>
                        <th className="text-left p-2">Path</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.modified.map((f) => (
                        <tr key={f.path} className="border-t">
                          <td className="p-2"><Badge variant="outline" className="text-orange-600">MOD</Badge></td>
                          <td className="p-2 font-mono">{f.path}</td>
                        </tr>
                      ))}
                      {status.added.map((f) => (
                        <tr key={f.path} className="border-t">
                          <td className="p-2"><Badge variant="outline" className="text-green-600">NEW</Badge></td>
                          <td className="p-2 font-mono">{f.path}</td>
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

      {!status && !loading && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Click <strong>Check for Updates</strong> to compare your installation with GitHub.
          </CardContent>
        </Card>
      )}

      <Card className="bg-muted/30">
        <CardContent className="py-3 text-xs text-muted-foreground space-y-1">
          <p><strong>How it works:</strong> Compares whitelisted backend paths (app, config, routes, migrations, views) against the GitHub branch. Pull downloads changed files via GitHub API and backs up old versions to <code>storage/app/deploy_sync/backups</code>.</p>
          <p><strong>Never modified:</strong> .env, vendor/, storage/, .git/, node_modules/, public/storage</p>
          <p><strong>After pulling migrations:</strong> SSH to cPanel and run <code>php artisan migrate --force</code></p>
        </CardContent>
      </Card>
    </div>
  );
}
