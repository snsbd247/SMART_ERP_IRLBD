import { useEffect, useMemo, useState } from "react";
import { getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Check, X, Shield } from "lucide-react";

/**
 * Read-only Permission Matrix:
 *   rows  = custom_roles (from GET /v1/roles)
 *   cols  = modules × (view | add | edit | delete)
 * Editing remains on /admin/roles to keep concerns separated.
 */
const ACTIONS = [
  { key: "can_view", label: "View" },
  { key: "can_add", label: "Add" },
  { key: "can_edit", label: "Edit" },
  { key: "can_delete", label: "Delete" },
] as const;

type Perm = { module: string; can_view: number; can_add: number; can_edit: number; can_delete: number };
type Role = { id: string; name: string; description: string | null; permissions: Perm[] };

async function fetchRoles(): Promise<Role[]> {
  const base = (getApiBaseUrl() || "").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/roles`, { headers: { Accept: "application/json", ...getLaravelAuthHeaders() } });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
  const list = Array.isArray(json) ? json : json.data ?? [];
  return list as Role[];
}

export default function PermissionMatrixPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchRoles().then(setRoles).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  const modules = useMemo(() => {
    const set = new Set<string>();
    roles.forEach((r) => r.permissions?.forEach((p) => set.add(p.module)));
    return Array.from(set).sort();
  }, [roles]);

  const filtered = q
    ? modules.filter((m) => m.toLowerCase().includes(q.toLowerCase()))
    : modules;

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Permission Matrix
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Input
              placeholder="Filter modules…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs"
            />
            <div className="text-sm text-muted-foreground">
              {roles.length} role{roles.length === 1 ? "" : "s"} · {modules.length} module{modules.length === 1 ? "" : "s"}
            </div>
          </div>

          {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {err && <div className="text-sm text-destructive">{err}</div>}

          {!loading && !err && (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background">Module</TableHead>
                    {roles.map((r) => (
                      <TableHead key={r.id} colSpan={ACTIONS.length} className="text-center border-l">
                        <div className="font-semibold">{r.name}</div>
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background" />
                    {roles.map((r) => (
                      ACTIONS.map((a) => (
                        <TableHead key={`${r.id}-${a.key}`} className="text-center text-xs">
                          {a.label}
                        </TableHead>
                      ))
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((mod) => (
                    <TableRow key={mod}>
                      <TableCell className="sticky left-0 bg-background font-medium">
                        <Badge variant="outline">{mod}</Badge>
                      </TableCell>
                      {roles.map((r) => {
                        const p = r.permissions?.find((x) => x.module === mod);
                        return ACTIONS.map((a) => {
                          const on = Boolean(p && (p as any)[a.key]);
                          return (
                            <TableCell key={`${r.id}-${mod}-${a.key}`} className="text-center">
                              {on ? (
                                <Check className="mx-auto h-4 w-4 text-primary" />
                              ) : (
                                <X className="mx-auto h-4 w-4 text-muted-foreground/40" />
                              )}
                            </TableCell>
                          );
                        });
                      })}
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={1 + roles.length * ACTIONS.length} className="text-center text-muted-foreground py-6">
                        No modules to display.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Read-only view. Manage roles &amp; permissions on the{" "}
            <a href="/admin/roles" className="underline">Roles</a> page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
