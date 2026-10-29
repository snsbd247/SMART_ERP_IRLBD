import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermission } from "@/hooks/usePermission";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Shield, AlertTriangle, CheckCircle2, ListChecks } from "lucide-react";

/** Canonical permission modules — must match backend seeder & route middleware */
const MODULES: { key: string; label: string; group: string }[] = [
  // Core
  { key: "dashboard", label: "Dashboard", group: "Core" },
  { key: "messaging", label: "Messaging", group: "Core" },
  // Accounting
  { key: "accounts", label: "Chart of Accounts", group: "Accounting" },
  { key: "journal", label: "Journal Voucher", group: "Accounting" },
  { key: "payment", label: "Payment Voucher", group: "Accounting" },
  { key: "receipt", label: "Receipt Voucher", group: "Accounting" },
  { key: "contra", label: "Contra Voucher", group: "Accounting" },
  { key: "money_receipt", label: "Money Receipt", group: "Accounting" },
  // Business
  { key: "sales", label: "Sales", group: "Business" },
  { key: "purchase", label: "Purchase", group: "Business" },
  { key: "customers", label: "Customers", group: "Business" },
  { key: "suppliers", label: "Suppliers", group: "Business" },
  { key: "inventory", label: "Inventory", group: "Business" },
  { key: "manufacturing", label: "Manufacturing", group: "Business" },
  { key: "bank", label: "Bank & Cash", group: "Business" },
  // HRM
  { key: "hrm", label: "HRM & Payroll", group: "HRM" },
  { key: "employees", label: "Employees", group: "HRM" },
  { key: "attendance", label: "Attendance", group: "HRM" },
  { key: "leave", label: "Leave", group: "HRM" },
  { key: "payroll", label: "Payroll", group: "HRM" },
  { key: "portal", label: "Employee Portal", group: "HRM" },
  // Reports
  { key: "reports", label: "Reports", group: "Reports" },
  // Administration
  { key: "branches", label: "Branches", group: "Administration" },
  { key: "users", label: "Users", group: "Administration" },
  { key: "roles", label: "Roles", group: "Administration" },
  { key: "financial_years", label: "Financial Years", group: "Administration" },
  { key: "settings", label: "Settings", group: "Administration" },
  { key: "audit_log", label: "Audit Log", group: "Administration" },
  { key: "backup", label: "Backup", group: "Administration" },
  { key: "sms", label: "SMS Settings", group: "Administration" },
  { key: "branding", label: "Branding", group: "Administration" },
  { key: "shortcuts", label: "Page Shortcuts", group: "Administration" },
  { key: "document_numbering", label: "Document Numbering", group: "Administration" },
  { key: "modules", label: "Module Settings", group: "Administration" },
];

const CANONICAL_KEYS = MODULES.map((m) => m.key);
const PERMISSION_KEYS = ["can_view", "can_add", "can_edit", "can_delete"] as const;
type PermKey = typeof PERMISSION_KEYS[number];

interface CustomRole {
  id: string;
  name: string;
  description: string | null;
}

interface Permission {
  module: string;
  can_view: boolean;
  can_add: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

interface RoleVerification {
  roleId: string;
  roleName: string;
  totalRows: number;
  missingModules: string[];
  orphanModules: string[]; // rows that exist but are not in canonical list
  allViewCount: number;
  fullAccessCount: number;
}

const defaultPermissions = (): Permission[] =>
  MODULES.map((m) => ({ module: m.key, can_view: false, can_add: false, can_edit: false, can_delete: false }));

const RolesPage = () => {
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [allRolePermissions, setAllRolePermissions] = useState<Record<string, Permission[]>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRole, setEditRole] = useState<CustomRole | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>(defaultPermissions());
  const [originalPermissions, setOriginalPermissions] = useState<Permission[]>(defaultPermissions());
  const [saving, setSaving] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const { toast } = useToast();
  const { canCreate, canEdit, canDelete } = usePermission();
  const { user, profile } = useAuth();

  // ── Audit helper ────────────────────────────────────────────────
  const writeAudit = async (action: string, recordId: string | null, details: string, oldData?: any, newData?: any) => {
    try {
      await supabase.from("audit_log").insert({
        user_id: user?.id ?? null,
        user_name: profile?.name || profile?.email || "Unknown",
        module: "Roles & Permissions",
        action,
        record_id: recordId,
        details,
        old_data: oldData ?? null,
        new_data: newData ?? null,
      });
    } catch (e) {
      // Non-fatal — never block the action
      console.warn("audit_log insert failed", e);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: rolesData }, { data: permsData }] = await Promise.all([
      supabase.from("custom_roles").select("*").order("name"),
      supabase.from("role_permissions").select("*"),
    ]);
    const rs = (rolesData || []) as CustomRole[];
    setRoles(rs);
    const map: Record<string, Permission[]> = {};
    (permsData || []).forEach((p: any) => {
      (map[p.custom_role_id] ||= []).push({
        module: p.module,
        can_view: !!p.can_view,
        can_add: !!p.can_add,
        can_edit: !!p.can_edit,
        can_delete: !!p.can_delete,
      });
    });
    setAllRolePermissions(map);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Verification — runs purely from already-loaded data ──────────
  const verifications: RoleVerification[] = useMemo(() => {
    return roles.map((r) => {
      const rows = allRolePermissions[r.id] || [];
      const presentKeys = new Set(rows.map((x) => x.module));
      const missingModules = CANONICAL_KEYS.filter((k) => !presentKeys.has(k));
      const orphanModules = rows.map((x) => x.module).filter((m) => !CANONICAL_KEYS.includes(m));
      const canonicalRows = rows.filter((x) => CANONICAL_KEYS.includes(x.module));
      const allViewCount = canonicalRows.filter((x) => x.can_view).length;
      const fullAccessCount = canonicalRows.filter((x) => x.can_view && x.can_add && x.can_edit && x.can_delete).length;
      return {
        roleId: r.id,
        roleName: r.name,
        totalRows: rows.length,
        missingModules,
        orphanModules,
        allViewCount,
        fullAccessCount,
      };
    });
  }, [roles, allRolePermissions]);

  const globalIssues = useMemo(() => {
    const orphanSet = new Set<string>();
    let rolesWithMissing = 0;
    verifications.forEach((v) => {
      v.orphanModules.forEach((o) => orphanSet.add(o));
      if (v.missingModules.length > 0) rolesWithMissing++;
    });
    return { orphans: Array.from(orphanSet), rolesWithMissing };
  }, [verifications]);

  // ── Dialog ──────────────────────────────────────────────────────
  const openCreate = () => {
    setEditRole(null);
    setFormName("");
    setFormDesc("");
    const fresh = defaultPermissions();
    setPermissions(fresh);
    setOriginalPermissions(fresh.map((p) => ({ ...p })));
    setDialogOpen(true);
  };

  const openEdit = (role: CustomRole) => {
    setEditRole(role);
    setFormName(role.name);
    setFormDesc(role.description || "");
    const perms = defaultPermissions();
    (allRolePermissions[role.id] || []).forEach((p) => {
      const idx = perms.findIndex((pm) => pm.module === p.module);
      if (idx >= 0) perms[idx] = { ...p };
    });
    setPermissions(perms);
    setOriginalPermissions(perms.map((p) => ({ ...p })));
    setDialogOpen(true);
  };

  const togglePerm = (moduleIdx: number, key: PermKey) => {
    setPermissions((prev) => prev.map((p, i) => (i === moduleIdx ? { ...p, [key]: !p[key] } : p)));
  };

  // ── Bulk actions ────────────────────────────────────────────────
  const setAllInColumn = (key: PermKey, value: boolean) => {
    setPermissions((prev) => prev.map((p) => ({ ...p, [key]: value })));
  };
  const setAllInRow = (moduleIdx: number, value: boolean) => {
    setPermissions((prev) =>
      prev.map((p, i) => (i === moduleIdx ? { ...p, can_view: value, can_add: value, can_edit: value, can_delete: value } : p))
    );
  };
  const setAllInGroup = (groupName: string, key: PermKey, value: boolean) => {
    const groupKeys = new Set(MODULES.filter((m) => m.group === groupName).map((m) => m.key));
    setPermissions((prev) => prev.map((p) => (groupKeys.has(p.module) ? { ...p, [key]: value } : p)));
  };
  const setAllEverything = (value: boolean) => {
    setPermissions((prev) =>
      prev.map((p) => ({ ...p, can_view: value, can_add: value, can_edit: value, can_delete: value }))
    );
  };

  // ── Compute diff for audit log ──────────────────────────────────
  const computeDiff = () => {
    const changes: Array<{ module: string; before: Permission; after: Permission }> = [];
    permissions.forEach((after) => {
      const before = originalPermissions.find((o) => o.module === after.module);
      if (!before) {
        changes.push({ module: after.module, before: { module: after.module, can_view: false, can_add: false, can_edit: false, can_delete: false }, after });
        return;
      }
      if (PERMISSION_KEYS.some((k) => before[k] !== after[k])) {
        changes.push({ module: after.module, before, after });
      }
    });
    return changes;
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      let roleId: string;
      let isCreate = false;
      if (editRole) {
        const nameChanged = editRole.name !== formName || (editRole.description || "") !== formDesc;
        if (nameChanged) {
          const { error } = await supabase.from("custom_roles").update({ name: formName, description: formDesc }).eq("id", editRole.id);
          if (error) throw error;
        }
        roleId = editRole.id;
        await supabase.from("role_permissions").delete().eq("custom_role_id", roleId);
      } else {
        isCreate = true;
        const { data, error } = await supabase.from("custom_roles").insert({ name: formName, description: formDesc }).select().single();
        if (error) throw error;
        roleId = (data as any).id;
      }

      const permRows = permissions.map((p) => ({
        custom_role_id: roleId,
        module: p.module,
        can_view: p.can_view,
        can_add: p.can_add,
        can_edit: p.can_edit,
        can_delete: p.can_delete,
      }));
      const { error: permErr } = await supabase.from("role_permissions").insert(permRows);
      if (permErr) throw permErr;

      // Audit
      if (isCreate) {
        await writeAudit("create", roleId, `Role "${formName}" created with ${permissions.filter((p) => p.can_view || p.can_add || p.can_edit || p.can_delete).length} active modules`, null, { name: formName, description: formDesc, permissions });
      } else {
        const diff = computeDiff();
        const meta = { name: { before: editRole?.name, after: formName }, description: { before: editRole?.description, after: formDesc } };
        await writeAudit(
          "edit",
          roleId,
          `Role "${formName}" updated — ${diff.length} module permission change(s)`,
          { ...meta, changes_from: diff.map((c) => ({ module: c.module, ...c.before })) },
          { ...meta, changes_to: diff.map((c) => ({ module: c.module, ...c.after })) }
        );
      }

      toast({ title: editRole ? "Role updated" : "Role created" });
      setDialogOpen(false);
      fetchAll();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role: CustomRole) => {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    const oldPerms = allRolePermissions[role.id] || [];
    const { error } = await supabase.from("custom_roles").delete().eq("id", role.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      await writeAudit("delete", role.id, `Role "${role.name}" deleted (cascade removed ${oldPerms.length} permission rows)`, { role, permissions: oldPerms }, null);
      fetchAll();
    }
  };

  const groups = Array.from(new Set(MODULES.map((m) => m.group)));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold text-foreground">Roles & Permissions</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setVerifyOpen(true)}>
            <ListChecks className="w-4 h-4 mr-1" />Verify Roles
          </Button>
          {canCreate("roles") && (
            <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1" />Add Role</Button>
          )}
        </div>
      </div>

      {/* Warning banners */}
      {globalIssues.orphans.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Orphan permission rows detected</AlertTitle>
          <AlertDescription>
            These module keys exist in <code>role_permissions</code> but are NOT in the canonical module list:{" "}
            <span className="font-mono">{globalIssues.orphans.join(", ")}</span>. They are ignored at runtime and should be cleaned up.
          </AlertDescription>
        </Alert>
      )}
      {globalIssues.rolesWithMissing > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{globalIssues.rolesWithMissing} role(s) are missing canonical modules</AlertTitle>
          <AlertDescription>
            Open a role and click Save once — missing module rows will be auto-inserted with the current checkbox state.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-40">Coverage</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : roles.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No custom roles yet</TableCell></TableRow>
              ) : roles.map((r) => {
                const v = verifications.find((x) => x.roleId === r.id);
                const missing = v?.missingModules.length || 0;
                const orphan = v?.orphanModules.length || 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-primary" />{r.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.description || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {v?.allViewCount ?? 0}/{CANONICAL_KEYS.length} view
                        </Badge>
                        {missing > 0 && <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">{missing} missing</Badge>}
                        {orphan > 0 && <Badge variant="destructive" className="text-[10px]">{orphan} orphan</Badge>}
                        {missing === 0 && orphan === 0 && <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1" />OK</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      {canEdit("roles") && (
                        <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
                      )}
                      {canDelete("roles") && (
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(r)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Edit / Create Dialog ───────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRole ? "Edit Role" : "Create Role"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role Name</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Accountant" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Optional description" />
              </div>
            </div>

            {/* Global bulk toolbar */}
            <div className="flex flex-wrap items-center gap-2 p-2 rounded-md border bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground mr-2">Bulk:</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setAllEverything(true)}>Grant All</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setAllEverything(false)}>Revoke All</Button>
              <div className="w-px h-5 bg-border mx-1" />
              {PERMISSION_KEYS.map((k) => (
                <div key={k} className="flex items-center gap-1">
                  <span className="text-[11px] uppercase text-muted-foreground">{k.replace("can_", "")}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAllInColumn(k, true)}>All</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAllInColumn(k, false)}>None</Button>
                </div>
              ))}
            </div>

            {groups.map((groupName) => {
              const groupModules = MODULES.filter((m) => m.group === groupName);
              return (
                <Card key={groupName}>
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm">{groupName}</CardTitle>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => {
                        PERMISSION_KEYS.forEach((k) => setAllInGroup(groupName, k, true));
                      }}>Enable all</Button>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => {
                        PERMISSION_KEYS.forEach((k) => setAllInGroup(groupName, k, false));
                      }}>Disable all</Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Module</TableHead>
                          <TableHead className="text-center w-20">View</TableHead>
                          <TableHead className="text-center w-20">Add</TableHead>
                          <TableHead className="text-center w-20">Edit</TableHead>
                          <TableHead className="text-center w-20">Delete</TableHead>
                          <TableHead className="text-center w-24">All</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groupModules.map((mod) => {
                          const globalIdx = permissions.findIndex((pp) => pp.module === mod.key);
                          const p = permissions[globalIdx];
                          const rowAll = p && p.can_view && p.can_add && p.can_edit && p.can_delete;
                          return (
                            <TableRow key={mod.key}>
                              <TableCell className="font-medium text-sm">{mod.label}<span className="ml-1 text-[10px] text-muted-foreground font-mono">{mod.key}</span></TableCell>
                              {PERMISSION_KEYS.map((key) => (
                                <TableCell key={key} className="text-center">
                                  <Checkbox checked={p?.[key] ?? false} onCheckedChange={() => togglePerm(globalIdx, key)} />
                                </TableCell>
                              ))}
                              <TableCell className="text-center">
                                <Checkbox checked={!!rowAll} onCheckedChange={() => setAllInRow(globalIdx, !rowAll)} />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Verification Report Dialog ──────────────────────────────── */}
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Role Verification Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Canonical modules: <strong>{CANONICAL_KEYS.length}</strong>. Each role should have a row for every canonical
              module. Orphan rows (unknown modules) should be cleaned up.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-center">Rows</TableHead>
                  <TableHead className="text-center">View / Total</TableHead>
                  <TableHead className="text-center">Full Access</TableHead>
                  <TableHead>Missing</TableHead>
                  <TableHead>Orphan</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verifications.map((v) => {
                  const ok = v.missingModules.length === 0 && v.orphanModules.length === 0;
                  return (
                    <TableRow key={v.roleId}>
                      <TableCell className="font-medium">{v.roleName}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{v.totalRows}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{v.allViewCount}/{CANONICAL_KEYS.length}</TableCell>
                      <TableCell className="text-center font-mono text-xs">{v.fullAccessCount}/{CANONICAL_KEYS.length}</TableCell>
                      <TableCell className="text-xs text-amber-600 max-w-[200px] truncate" title={v.missingModules.join(", ")}>
                        {v.missingModules.length > 0 ? v.missingModules.join(", ") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-destructive max-w-[200px] truncate" title={v.orphanModules.join(", ")}>
                        {v.orphanModules.length > 0 ? v.orphanModules.join(", ") : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {ok ? (
                          <Badge variant="outline" className="border-emerald-500 text-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1" />OK</Badge>
                        ) : (
                          <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Issues</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyOpen(false)}>Close</Button>
            <Button onClick={fetchAll}>Re-run</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RolesPage;
