import { useEffect, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle, Loader2, Database, Hash, FileText, HardDrive, RefreshCw, Play } from "lucide-react";
import { toast } from "sonner";
import { friendlyRlsMessage } from "@/lib/data-errors";
import { getApiBaseUrl, getLaravelAuthHeaders, isLaravelMode } from "@/lib/laravel-auth";
import { formatDistanceToNow } from "date-fns";

interface AccessRow { table: string; ok: boolean; count?: number; error?: string; }
interface NumAudit { source: string; total: number; missing: number; duplicates: number; }

const TABLES_TO_TEST = [
  "profiles", "user_roles", "acc_vouchers", "voucher_entries",
  "sales_invoices", "purchases", "employees", "chart_of_accounts",
  "audit_log", "number_sequences", "module_settings", "company_settings",
  "branches", "financial_years", "backup_history",
] as const;

const DiagnosticsPage = () => {
  const { user, profile, isSuperAdmin } = useAuth();
  const [accessRows, setAccessRows] = useState<AccessRow[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [validatorResult, setValidatorResult] = useState<{ ok: boolean; details: string[] } | null>(null);
  const [validating, setValidating] = useState(false);
  const [numAudit, setNumAudit] = useState<NumAudit[]>([]);
  const [auditing, setAuditing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [voucherStatus, setVoucherStatus] = useState<{ visible: number; total: number; rls: boolean } | null>(null);
  const [backup, setBackup] = useState<any>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [running, setRunning] = useState(false);

  // ============ A. ACCESS TEST ============
  const runAccessTest = async () => {
    setAccessLoading(true);
    const results: AccessRow[] = [];
    for (const t of TABLES_TO_TEST) {
      const { count, error } = await dataClient
        .from(t as any)
        .select("*", { count: "exact", head: true });
      if (error) {
        results.push({ table: t, ok: false, error: error.message });
      } else {
        results.push({ table: t, ok: true, count: count ?? 0 });
      }
    }
    setAccessRows(results);
    setAccessLoading(false);
  };

  // ============ B. SUPER ADMIN VALIDATOR ============
  const validateSuperAdmin = async () => {
    setValidating(true);
    const details: string[] = [];
    let ok = true;
    try {
      // Check 1: auth user exists
      if (!user) { ok = false; details.push("❌ No authenticated user"); }
      else details.push(`✓ Authenticated as ${profile?.username || profile?.email || user.email}`);

      // Check 2: user_roles row
      const { data: rolesData, error: rolesErr } = await dataClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user?.id || "");
      if (rolesErr) { ok = false; details.push(`❌ user_roles read failed: ${rolesErr.message}`); }
      else {
        const roles = (rolesData || []).map((r: any) => r.role);
        if (roles.includes("super_admin")) details.push(`✓ Has super_admin role`);
        else { ok = false; details.push(`❌ Missing super_admin role (found: ${roles.join(", ") || "none"})`); }
      }

      // Check 3: is_super_admin function
      const { data: rpcData, error: rpcErr } = await dataClient.rpc("is_super_admin", { _uid: user?.id });
      if (rpcErr) { ok = false; details.push(`❌ is_super_admin() RPC failed: ${rpcErr.message}`); }
      else details.push(`${rpcData ? "✓" : "❌"} is_super_admin(${user?.id?.slice(0,8)}…) → ${rpcData}`);

      // Check 4: protected table count
      const { count, error: cErr } = await dataClient
        .from("acc_vouchers")
        .select("*", { count: "exact", head: true });
      if (cErr) { ok = false; details.push(`❌ acc_vouchers read failed: ${cErr.message}`); }
      else details.push(`✓ Can read acc_vouchers (${count} rows)`);

      setValidatorResult({ ok, details });
      if (ok) toast.success("Super Admin access verified");
      else toast.error("Super Admin access check failed");
    } catch (e: any) {
      setValidatorResult({ ok: false, details: [...details, `❌ ${e.message}`] });
    } finally {
      setValidating(false);
    }
  };

  // ============ C. NUMBER AUDIT ============
  const runNumberAudit = async () => {
    setAuditing(true);
    const sources: { name: string; table: string; col: string }[] = [
      { name: "Accounting Vouchers", table: "acc_vouchers", col: "voucher_number" },
      { name: "Sales Invoices", table: "sales_invoices", col: "invoice_number" },
      { name: "Purchases", table: "purchases", col: "purchase_number" },
      { name: "Party Payments", table: "party_payments", col: "reference" },
    ];
    const results: NumAudit[] = [];
    for (const s of sources) {
      try {
        const { data, error } = await dataClient.from(s.table as any).select(`id, ${s.col}`);
        if (error) { results.push({ source: s.name, total: 0, missing: 0, duplicates: 0 }); continue; }
        const rows = data as any[];
        const total = rows.length;
        const nums = rows.map(r => r[s.col]);
        const missing = nums.filter(n => !n).length;
        const counts: Record<string, number> = {};
        nums.forEach(n => { if (n) counts[n] = (counts[n] || 0) + 1; });
        const duplicates = Object.values(counts).filter(c => c > 1).length;
        results.push({ source: s.name, total, missing, duplicates });
      } catch {
        results.push({ source: s.name, total: 0, missing: 0, duplicates: 0 });
      }
    }
    setNumAudit(results);
    setAuditing(false);
  };

  const autoFixNumbering = async () => {
    setFixing(true);
    try {
      // Resync number_sequences.current_number to max serial actually used in tables
      const { data: seqs } = await dataClient.from("number_sequences").select("*");
      const map: Record<string, string> = {
        journal_voucher: "acc_vouchers",
        payment_voucher: "acc_vouchers",
        receipt_voucher: "acc_vouchers",
        contra_voucher: "acc_vouchers",
        sales_invoice: "sales_invoices",
        purchase: "purchases",
      };
      const typeMap: Record<string, string> = {
        journal_voucher: "journal",
        payment_voucher: "payment",
        receipt_voucher: "receipt",
        contra_voucher: "contra",
      };
      let fixed = 0;
      for (const seq of seqs || []) {
        const tbl = map[seq.id];
        if (!tbl) continue;
        const numCol = tbl === "acc_vouchers" ? "voucher_number"
          : tbl === "sales_invoices" ? "invoice_number" : "purchase_number";
        let q = dataClient.from(tbl as any).select(numCol);
        if (tbl === "acc_vouchers" && typeMap[seq.id]) {
          q = (q as any).eq("voucher_type", typeMap[seq.id]);
        }
        const { data } = await q;
        const maxSerial = (data || [])
          .map((r: any) => {
            const m = String(r[numCol] || "").match(/-(\d+)$/);
            return m ? parseInt(m[1]) : 0;
          })
          .reduce((a, b) => Math.max(a, b), 0);
        if (maxSerial > seq.current_number) {
          await dataClient.from("number_sequences").update({ current_number: maxSerial }).eq("id", seq.id);
          fixed++;
        }
      }
      toast.success(`Number sequences re-synced (${fixed} updated)`);
      await runNumberAudit();
    } catch (e: any) {
      toast.error("Auto-fix failed", { description: e.message });
    } finally {
      setFixing(false);
    }
  };

  // ============ D. VOUCHERS PAGE STATUS ============
  const checkVouchers = async () => {
    const { count, error } = await dataClient
      .from("acc_vouchers")
      .select("*", { count: "exact", head: true });
    if (error) {
      setVoucherStatus({ visible: 0, total: 0, rls: !!friendlyRlsMessage(error) });
      return;
    }
    setVoucherStatus({ visible: count || 0, total: count || 0, rls: false });
  };

  // ============ E. BACKUP HEALTH ============
  const loadBackup = async () => {
    setBackupLoading(true);
    const [{ data: latest }, { data: settings }] = await Promise.all([
      dataClient.from("backup_history").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      dataClient.from("backup_settings").select("*").eq("id", "default").maybeSingle(),
    ]);
    setBackup({ latest, settings });
    setBackupLoading(false);
  };

  const runBackupNow = async () => {
    setRunning(true);
    try {
      if (isLaravelMode()) {
        const base = getApiBaseUrl() || "";
        const res = await fetch(`${base}/v1/backups/create`, {
          method: "POST",
          headers: { ...getLaravelAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ format: "json" }),
        });
        const result = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        if (!res.ok || !result.success) throw new Error(result.message || result.error || `HTTP ${res.status}`);
      } else {
        const { error } = await dataClient.functions.invoke("create-backup", { body: { format: "json" } });
        if (error) throw error;
      }
      toast.success("Backup completed");
      await loadBackup();
    } catch (e: any) {
      toast.error("Backup failed", { description: e.message });
    } finally {
      setRunning(false);
    }
  };

  // Demo seeding removed per request.



  useEffect(() => {
    if (isSuperAdmin) {
      runAccessTest();
      checkVouchers();
      loadBackup();
      runNumberAudit();
    }
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
            <p className="text-muted-foreground mt-2">Only Super Admin can view diagnostics.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">System Diagnostics</h1>
          <p className="text-sm text-muted-foreground">RLS, numbering, vouchers, backup health checks</p>
        </div>
      </div>

      {/* CURRENT IDENTITY */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">Current User</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><div className="text-xs text-muted-foreground">User ID</div><div className="font-mono text-xs">{user?.id}</div></div>
          <div><div className="text-xs text-muted-foreground">Username</div><div>{profile?.username || "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">Email</div><div>{profile?.email || user?.email}</div></div>
          <div><div className="text-xs text-muted-foreground">Super Admin</div>
            <Badge variant={isSuperAdmin ? "default" : "secondary"}>{isSuperAdmin ? "YES" : "NO"}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* SUPER ADMIN VALIDATOR */}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Super Admin Validator</CardTitle>
          <CardDescription>Run an authorized query and verify access end-to-end</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={validateSuperAdmin} disabled={validating} size="sm">
            {validating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Validate Super Admin Access
          </Button>
          {validatorResult && (
            <div className={`rounded-md border p-3 ${validatorResult.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}`}>
              <div className="flex items-center gap-2 mb-2">
                {validatorResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-destructive" />}
                <span className="font-semibold text-sm">{validatorResult.ok ? "All checks passed" : "Some checks failed"}</span>
              </div>
              <ul className="text-xs space-y-1 font-mono">
                {validatorResult.details.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* RLS / ACCESS TEST */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4" />RLS / Permission Check</CardTitle>
            <CardDescription>Per-table SELECT access from your current session</CardDescription>
          </div>
          <Button onClick={runAccessTest} disabled={accessLoading} size="sm" variant="outline">
            {accessLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Re-run
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accessRows.map(r => (
                <TableRow key={r.table}>
                  <TableCell className="font-mono text-xs">{r.table}</TableCell>
                  <TableCell>
                    {r.ok
                      ? <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 gap-1"><CheckCircle2 className="w-3 h-3" />OK</Badge>
                      : <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Denied</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.ok ? r.count : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[400px] truncate">
                    {r.error || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* NUMBER AUDIT */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Hash className="w-4 h-4" />Document Numbering Audit</CardTitle>
            <CardDescription>Null / duplicate detection and sequence re-sync</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={runNumberAudit} disabled={auditing} size="sm" variant="outline">
              {auditing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Re-run
            </Button>
            <Button onClick={autoFixNumbering} disabled={fixing} size="sm">
              {fixing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Auto-fix
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Missing</TableHead>
                <TableHead className="text-right">Duplicate Numbers</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {numAudit.map(r => {
                const clean = r.missing === 0 && r.duplicates === 0;
                return (
                  <TableRow key={r.source}>
                    <TableCell>{r.source}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.missing}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.duplicates}</TableCell>
                    <TableCell>
                      {clean
                        ? <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600">Clean</Badge>
                        : <Badge variant="destructive">Issues</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* VOUCHERS STATUS */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" />Vouchers Page Status</CardTitle>
        </CardHeader>
        <CardContent>
          {voucherStatus ? (
            voucherStatus.rls ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-semibold text-destructive">RLS is blocking acc_vouchers</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Re-grant <code>is_super_admin(uuid)</code> EXECUTE permission on the database.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 gap-1">
                  <CheckCircle2 className="w-3 h-3" />Accessible
                </Badge>
                <span className="text-sm">{voucherStatus.visible} vouchers visible</span>
              </div>
            )
          ) : <p className="text-sm text-muted-foreground">Checking…</p>}
        </CardContent>
      </Card>

      {/* BACKUP HEALTH */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><HardDrive className="w-4 h-4" />Backup Health</CardTitle>
            <CardDescription>Latest backup status &amp; quick actions</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={loadBackup} disabled={backupLoading} size="sm" variant="outline">
              {backupLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Refresh
            </Button>
            <Button onClick={runBackupNow} disabled={running} size="sm">
              {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Run Backup Now
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {backup?.latest ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><div className="text-xs text-muted-foreground">Last Backup</div>
                <div>{(() => { const d = backup.latest.created_at ? new Date(backup.latest.created_at) : null; return d && !isNaN(d.getTime()) ? formatDistanceToNow(d, { addSuffix: true }) : "—"; })()}</div>
              </div>
              <div><div className="text-xs text-muted-foreground">File</div>
                <div className="font-mono text-xs truncate">{backup.latest.file_name}</div>
              </div>
              <div><div className="text-xs text-muted-foreground">Size</div>
                <div>{(backup.latest.file_size / 1024).toFixed(1)} KB</div>
              </div>
              <div><div className="text-xs text-muted-foreground">Status</div>
                <Badge variant={backup.latest.status === "completed" ? "default" : "destructive"}>{backup.latest.status}</Badge>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No backup found yet. Click "Run Backup Now" to create one.</p>
          )}
          {backup?.settings && (
            <div className="text-xs text-muted-foreground border-t pt-3">
              Auto-backup: <strong>{backup.settings.auto_backup_enabled ? "Enabled" : "Disabled"}</strong> ·
              {" "}Schedule: {backup.settings.schedule_interval} ·
              {" "}Retention: {backup.settings.retention_days}d
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/admin/backup">Open Backup &amp; Restore →</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DiagnosticsPage;
