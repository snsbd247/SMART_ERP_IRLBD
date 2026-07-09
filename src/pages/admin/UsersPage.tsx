import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import UserDeleteDialog from "@/components/admin/UserDeleteDialog";
import { isLaravelMode, getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

interface UserRow {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  branch_id: string | null;
  status: string;
  roles: string[];
  branch_name?: string;
  branch_ids: string[];
  custom_role_ids: string[];
}

interface Branch { id: string; name: string; }
interface CustomRole { id: string; name: string; }

const UsersPage = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const [formName, setFormName] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<string>("user");
  const [formBranch, setFormBranch] = useState<string>("");
  const [formBranchIds, setFormBranchIds] = useState<string[]>([]);
  const [formStatus, setFormStatus] = useState<string>("active");
  const [formCustomRole, setFormCustomRole] = useState<string>("");

  const { toast } = useToast();
  const { user: authUser, isSuperAdmin, refreshProfile } = useAuth();

  const fetchData = async () => {
    setLoading(true);
    const [profilesRes, rolesRes, branchesRes, customRolesRes, userCustomRolesRes, userBranchesRes] = await Promise.all([
      supabase.from("profiles").select("*").is("deleted_at", null).neq("status", "deleted"),
      supabase.from("user_roles").select("*"),
      supabase.from("branches").select("id, name"),
      supabase.from("custom_roles").select("id, name").order("name"),
      supabase.from("user_custom_roles").select("*"),
      supabase.from("user_branches" as any).select("user_id, branch_id"),
    ]);

    const branchList = (branchesRes.data || []) as Branch[];
    setBranches(branchList);
    setCustomRoles((customRolesRes.data || []) as CustomRole[]);

    const profiles = profilesRes.data || [];
    const rolesList = rolesRes.data || [];
    const userCustomRolesList = userCustomRolesRes.data || [];
    const userBranchesList = (userBranchesRes.data || []) as any[];

    // Filter out super admin users (employee_id IS NULL) for non-super-admin viewers
    const visibleProfiles = isSuperAdmin
      ? profiles
      : profiles.filter((p: any) => p.employee_id !== null && p.employee_id !== undefined);

    const mapped: UserRow[] = visibleProfiles.map((p: any) => {
      const systemRoles = rolesList.filter((r: any) => r.user_id === p.id).map((r: any) => r.role);
      const normalizedRoles = p.employee_id === null || p.employee_id === undefined
        ? ["super_admin", ...systemRoles.filter((r: string) => r !== "super_admin" && r !== "user" && r !== "staff" && r !== "admin")]
        : (systemRoles.includes("super_admin") ? ["super_admin"] : ["user"]);
      const linkedBranchIds = userBranchesList
        .filter((ub: any) => ub.user_id === p.id)
        .map((ub: any) => ub.branch_id as string);
      const branch_ids = linkedBranchIds.length > 0
        ? linkedBranchIds
        : (p.branch_id ? [p.branch_id] : []);
      return {
        ...p,
        roles: normalizedRoles,
        branch_name: branchList.find((b) => b.id === p.branch_id)?.name,
        branch_ids,
        custom_role_ids: userCustomRolesList.filter((ucr: any) => ucr.user_id === p.id).map((ucr: any) => ucr.custom_role_id),
      };
    });
    setUsers(mapped);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    setCurrentUserId(authUser?.id || null);
  }, [authUser?.id]);

  const openCreate = () => {
    setEditUser(null);
    setFormName(""); setFormUsername(""); setFormEmail(""); setFormPhone("");
    setFormPassword(""); setFormRole("user"); setFormBranch(""); setFormBranchIds([]); setFormStatus("active");
    setFormCustomRole("");
    setDialogOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditUser(u);
    setFormName(u.name); setFormUsername(u.username || ""); setFormEmail(u.email || "");
    setFormPhone(u.phone || ""); setFormPassword(""); setFormRole(u.roles.includes("super_admin") ? "super_admin" : "user");
    setFormBranch(u.branch_id || ""); setFormBranchIds(u.branch_ids || []); setFormStatus(u.status);
    setFormCustomRole(u.custom_role_ids[0] || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setCreating(true);
    try {
      if (isLaravelMode()) {
        const base = getApiBaseUrl();
        if (!base) throw new Error("Laravel API URL not configured");
        const headers = getLaravelAuthHeaders(true);
        const primaryBranch = formBranchIds[0] || formBranch || null;
        const payload: any = {
          name: formName,
          username: formUsername,
          email: formEmail || null,
          phone: formPhone || null,
          branch_id: primaryBranch,
          branch_ids: formBranchIds,
          status: formStatus,
          system_role: formRole,
          role_ids: formCustomRole && formCustomRole !== "none" ? [formCustomRole] : [],
        };
        if (formPassword) payload.password = formPassword;

        if (editUser) {
          const res = await fetch(`${base}/v1/users/${editUser.id}`, {
            method: "PUT", headers, body: JSON.stringify(payload),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json?.message || json?.error ||
            (json?.errors ? Object.values(json.errors).flat().join(", ") : `HTTP ${res.status}`));
          toast({ title: "User updated" });
        } else {
          if (!formPassword) throw new Error("Password is required");
          const res = await fetch(`${base}/v1/users`, {
            method: "POST", headers, body: JSON.stringify(payload),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            const errMsg = json?.message || json?.error ||
              (json?.errors ? Object.values(json.errors).flat().join(", ") : `HTTP ${res.status}`);
            throw new Error(errMsg);
          }
          toast({ title: "User created" });
        }
      } else if (editUser) {
        const primaryBranch = formBranchIds[0] || formBranch || null;
        const { error } = await supabase.from("profiles").update({
          name: formName, username: formUsername, email: formEmail, phone: formPhone,
          branch_id: primaryBranch, status: formStatus,
          updated_at: new Date().toISOString(),
        }).eq("id", editUser.id);
        if (error) throw error;

        // Update system role
        await supabase.from("user_roles").delete().eq("user_id", editUser.id);
        await supabase.from("user_roles").insert({ user_id: editUser.id, role: formRole as any });

        // Update custom role
        await supabase.from("user_custom_roles").delete().eq("user_id", editUser.id);
        if (formCustomRole && formCustomRole !== "none") {
          await supabase.from("user_custom_roles").insert({ user_id: editUser.id, custom_role_id: formCustomRole });
        }

        toast({ title: "User updated" });
      } else {
        // Use edge function to create user without logging out current admin
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Not authenticated");

        const res = await supabase.functions.invoke("admin-create-user", {
          body: {
            email: formEmail,
            password: formPassword,
            name: formName,
            username: formUsername,
            phone: formPhone,
            branch_id: formBranch || null,
            status: formStatus,
            role: formRole,
            custom_role_id: formCustomRole || null,
          },
        });

        const errMsg = res.data?.error || res.error?.message;
        if (errMsg) throw new Error(errMsg);

        toast({ title: "User created" });
      }
      setDialogOpen(false);
      fetchData();
      // If the actor edited their own account (e.g. system_role change), refresh
      // permissions immediately so they apply without a manual logout/login.
      if (editUser && currentUserId && editUser.id === currentUserId) {
        try { await refreshProfile(); } catch { /* ignore */ }
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };


  const roleColor = (role: string) => {
    if (role === "super_admin") return "destructive" as const;
    return "secondary" as const;
  };

  const filtered = users.filter((u) => {
    const matchSearch = !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.username || "").toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === "all" || u.roles.includes(filterRole);
    const matchStatus = filterStatus === "all" || u.status === filterStatus;
    return matchSearch && matchRole && matchStatus;
  });

  const getCustomRoleName = (id: string) => customRoles.find((r) => r.id === id)?.name || "";

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">User Management</h1>
        <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1" />Add User</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={filterRole} onValueChange={setFilterRole}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="super_admin">Super Admin</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>System Role</TableHead>
                <TableHead>Custom Role</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No users found</TableCell></TableRow>
              ) : filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.username || "—"}</TableCell>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell className="text-sm">{u.phone || "—"}</TableCell>
                  <TableCell>
                    {u.roles.map((r) => (
                      <Badge key={r} variant={roleColor(r)} className="mr-1 text-xs">{r}</Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-sm">
                    {u.custom_role_ids.map((id) => (
                      <Badge key={id} variant="outline" className="mr-1 text-xs">{getCustomRoleName(id)}</Badge>
                    ))}
                    {u.custom_role_ids.length === 0 && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">{u.branch_name || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={u.status === "active" ? "default" : "secondary"} className="text-xs">{u.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(u)} className="h-8 w-8">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <UserDeleteDialog
                        user={u}
                        allUsers={users}
                        isSuperAdmin={isSuperAdmin}
                        onDeleted={fetchData}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editUser ? "Edit User" : "Create User"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Full Name</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Username</Label>
                <Input value={formUsername} onChange={(e) => setFormUsername(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} disabled={!!editUser} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
              </div>
            </div>
            {!editUser && (
              <div className="space-y-1.5">
                <Label className="text-xs">Password</Label>
                <Input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} minLength={6} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">System Role</Label>
                <Select value={formRole} onValueChange={setFormRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Super Admin bypasses all permissions. Use "User" + Custom Role for granular access.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Custom Role (Permissions)</Label>
                <Select value={formCustomRole} onValueChange={setFormCustomRole}>
                  <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {customRoles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Primary Branch</Label>
                <Select
                  value={formBranchIds[0] || ""}
                  onValueChange={(v) => {
                    setFormBranch(v);
                    setFormBranchIds((prev) => prev.includes(v) ? [v, ...prev.filter((x) => x !== v)] : [v, ...prev]);
                  }}
                  disabled={formBranchIds.length === 0}
                >
                  <SelectTrigger><SelectValue placeholder={formBranchIds.length === 0 ? "Select branches below" : "Primary"} /></SelectTrigger>
                  <SelectContent>
                    {formBranchIds.map((id) => {
                      const b = branches.find((x) => x.id === id);
                      return b ? <SelectItem key={id} value={id}>{b.name}</SelectItem> : null;
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Allowed Branches (multi-select)</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                {branches.length === 0 && <p className="text-xs text-muted-foreground">No branches available</p>}
                {branches.map((b) => {
                  const checked = formBranchIds.includes(b.id);
                  return (
                    <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 rounded hover:bg-accent">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormBranchIds((prev) => [...prev, b.id]);
                            if (!formBranch) setFormBranch(b.id);
                          } else {
                            setFormBranchIds((prev) => {
                              const next = prev.filter((x) => x !== b.id);
                              if (formBranch === b.id) setFormBranch(next[0] || "");
                              return next;
                            });
                          }
                        }}
                      />
                      <span>{b.name}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                User will only see data from selected branches. Super Admins see all branches.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} size="sm">Cancel</Button>
            <Button onClick={handleSave} disabled={creating} size="sm">{creating ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersPage;
