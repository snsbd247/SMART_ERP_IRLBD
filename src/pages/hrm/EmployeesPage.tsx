import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getApiBaseUrl, getLaravelAuthHeaders, isLaravelMode } from "@/lib/laravel-auth";
import { useAuth } from "@/contexts/AuthContext";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Search, Users, Eye, EyeOff, KeyRound, Wand2, Upload } from "lucide-react";
import { BulkImportDialog } from "@/components/hrm/BulkImportDialog";

interface Employee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  mobile: string | null;
  email: string | null;
  address: string | null;
  national_id: string | null;
  tin_no: string | null;
  department_id: string | null;
  designation_id: string | null;
  branch_id: string | null;
  section_id: string | null;
  employee_category: string;
  user_id: string | null;
  joining_date: string;
  salary: number;
  employment_type: string;
  status: string;
  photo_url: string | null;
}

interface Department { id: string; name: string; }
interface Designation { id: string; name: string; }
interface Branch { id: string; name: string; }
interface Section { id: string; name: string; branch_id: string | null; }

const defaultForm = {
  employee_code: "", first_name: "", last_name: "", mobile: "", email: "",
  address: "", national_id: "", tin_no: "", department_id: "", designation_id: "",
  branch_id: "", section_id: "", employee_category: "staff",
  joining_date: new Date().toISOString().split("T")[0],
  salary: 0, employment_type: "permanent", status: "active",
  // Login fields
  create_login: false, username: "", password: "",
};


export default function EmployeesPage() {
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission("hrm.edit");
  const navigate = useNavigate();
  
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(false);
  const [linkedUsers, setLinkedUsers] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  const fetchAll = useCallback(async () => {
    const [empRes, deptRes, desigRes, branchRes, secRes] = await Promise.all([
      supabase.from("employees" as any).select("*").neq("approval_status", "pending").order("employee_code"),
      supabase.from("departments" as any).select("id, name").eq("status", "active"),
      supabase.from("designations" as any).select("id, name").eq("status", "active"),
      supabase.from("branches").select("id, name").eq("status", "active"),
      supabase.from("sections" as any).select("id, name, branch_id").eq("status", "active"),
    ]);
    if (empRes.data) setEmployees(empRes.data as any);
    if (deptRes.data) setDepartments(deptRes.data as any);
    if (desigRes.data) setDesignations(desigRes.data as any);
    if (branchRes.data) setBranches(branchRes.data as any);
    if (secRes.data) setSections(secRes.data as any);

    // Fetch which employees have linked user accounts
    const { data: profiles } = await supabase.from("profiles").select("id, employee_id, username").not("employee_id", "is", null);
    if (profiles) {
      const map: Record<string, string> = {};
      (profiles as any[]).forEach(p => {
        if (p.employee_id) map[p.employee_id] = p.username || "linked";
      });
      setLinkedUsers(map);
    }
  }, []);


  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = employees.filter(e => {
    const q = search.toLowerCase();
    return (e.first_name + " " + e.last_name + " " + e.employee_code).toLowerCase().includes(q);
  });

  const openAdd = () => { setEditId(null); setForm(defaultForm); setShowPassword(false); setDialogOpen(true); };
  const openEdit = (emp: Employee) => {
    setEditId(emp.id);
    const hasLogin = !!linkedUsers[emp.id];
    setForm({
      employee_code: emp.employee_code, first_name: emp.first_name, last_name: emp.last_name,
      mobile: emp.mobile || "", email: emp.email || "", address: emp.address || "",
      national_id: emp.national_id || "", tin_no: emp.tin_no || "", department_id: emp.department_id || "",
      designation_id: emp.designation_id || "", branch_id: emp.branch_id || "",
      section_id: emp.section_id || "", employee_category: emp.employee_category || "staff",
      joining_date: emp.joining_date, salary: emp.salary,
      employment_type: emp.employment_type, status: emp.status,
      create_login: hasLogin, username: hasLogin ? linkedUsers[emp.id] : "", password: "",
    });

    setShowPassword(false);
    setDialogOpen(true);
  };

  /** Auto-generate username in EMP-XXXX format */
  const generateUsername = useCallback(() => {
    // Find the highest existing EMP-XXXX number
    let maxNum = 0;
    Object.values(linkedUsers).forEach(uname => {
      const match = uname.match(/^EMP-(\d+)$/i);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    });
    // Also check employee codes for a fallback
    employees.forEach(emp => {
      const match = emp.employee_code.match(/(\d+)/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    });
    const nextNum = maxNum + 1;
    return `EMP-${String(nextNum).padStart(4, "0")}`;
  }, [linkedUsers, employees]);

  const handleSave = async () => {
    if (!form.employee_code || !form.first_name || !form.last_name) {
      toast.error("Employee code, first name and last name are required");
      return;
    }

    // Validate login fields only when toggle is ON
    if (form.create_login) {
      if (!form.username) { toast.error("Username is required for login"); return; }
      // Password required for new employees or new login accounts
      const isNewLogin = !editId || !linkedUsers[editId!];
      if (isNewLogin && (!form.password || form.password.length < 6)) {
        toast.error("Password must be at least 6 characters"); return;
      }
      if (form.password && form.password.length > 0 && form.password.length < 6) {
        toast.error("Password must be at least 6 characters"); return;
      }
    }

    setLoading(true);
    const payload: any = {
      employee_code: form.employee_code,
      first_name: form.first_name,
      last_name: form.last_name,
      mobile: form.mobile || null,
      email: form.email || null,
      address: form.address || null,
      national_id: form.national_id || null,
      tin_no: form.tin_no || null,
      department_id: form.department_id || null,
      designation_id: form.designation_id || null,
      branch_id: form.branch_id || null,
      section_id: form.section_id || null,
      employee_category: form.employee_category || "staff",
      joining_date: form.joining_date,
      salary: form.salary,
      employment_type: form.employment_type,
      status: form.status,
      updated_at: new Date().toISOString(),
    };


    try {
      if (editId) {
        const { error } = await supabase.from("employees" as any).update(payload).eq("id", editId);
        if (error) { toast.error(error.message); setLoading(false); return; }

        // Handle login account changes
        if (form.create_login) {
          const { data: existingProfile } = await supabase.from("profiles").select("id, username").eq("employee_id", editId).single();
          if (existingProfile) {
            // Update existing profile - restore active status and username
            const updateData: any = { username: form.username, status: "active" };
            await supabase.from("profiles").update(updateData).eq("id", existingProfile.id);
            // Re-link employee user_id if it was cleared
            await supabase.from("employees" as any).update({ user_id: (existingProfile as any).id }).eq("id", editId);
            // If password provided, update via edge function
            if (form.password) {
              const { error: fnError } = await supabase.functions.invoke("admin-create-user", {
                body: {
                  email: form.email || `${form.username}@erp.local`,
                  password: form.password,
                  name: `${form.first_name} ${form.last_name}`,
                  username: form.username,
                  employee_id: editId,
                  branch_id: form.branch_id || null,
                },
              });
              if (fnError) toast.error("Password update failed: " + fnError.message);
            }
          } else {
            // Create new login for existing employee
            const { data: fnData, error: fnError } = await supabase.functions.invoke("admin-create-user", {
              body: {
                email: form.email || `${form.username}@erp.local`,
                password: form.password,
                name: `${form.first_name} ${form.last_name}`,
                username: form.username,
                employee_id: editId,
                branch_id: form.branch_id || null,
              },
            });
            if (fnError) {
              toast.error("Login account creation failed: " + fnError.message);
            } else if (fnData?.user_id) {
              await supabase.from("employees" as any).update({ user_id: fnData.user_id }).eq("id", editId);
            }
          }
        } else {
          // Toggle OFF: disable login by setting profile status to inactive
          const { data: existingProfile } = await supabase.from("profiles").select("id").eq("employee_id", editId).single();
          if (existingProfile) {
            await supabase.from("profiles").update({ status: "inactive", username: null }).eq("id", existingProfile.id);
            await supabase.from("employees" as any).update({ user_id: null }).eq("id", editId);
          }
        }

        toast.success("Employee updated");
        setDialogOpen(false);
        fetchAll();
      } else {
        const { data, error } = await supabase.from("employees" as any).insert(payload).select().single();
        if (error) { toast.error(error.message); setLoading(false); return; }

        // Create login account if toggle is ON
        if (form.create_login && data) {
          try {
            const { data: fnData, error: fnError } = await supabase.functions.invoke("admin-create-user", {
              body: {
                email: form.email || `${form.username}@erp.local`,
                password: form.password,
                name: `${form.first_name} ${form.last_name}`,
                username: form.username,
                employee_id: (data as any).id,
                branch_id: form.branch_id || null,
              },
            });
            if (fnError) throw fnError;
            if (fnData?.user_id) {
              await supabase.from("employees" as any).update({ user_id: fnData.user_id }).eq("id", (data as any).id);
            }
          } catch (err: any) {
            toast.error("Employee created but login account failed: " + (err.message || "Unknown error"));
          }
        }
        toast.success("Employee created");
        setDialogOpen(false);
        fetchAll();
      }
    } catch (err: any) {
      toast.error(err.message || "Save failed");
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this employee?")) return;
    const { error } = await supabase.from("employees" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Employee deleted"); fetchAll(); }
  };

  const getDeptName = (id: string | null) => departments.find(d => d.id === id)?.name || "-";
  const getDesigName = (id: string | null) => designations.find(d => d.id === id)?.name || "-";
  const getBranchName = (id: string | null) => branches.find(b => b.id === id)?.name || "-";

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employees</h1>
          <p className="text-muted-foreground">Manage employee records</p>
        </div>
        {isAdmin && <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4 mr-2" />Bulk Import</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" />Add Employee</Button>
        </div>}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search employees..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Badge variant="secondary"><Users className="w-3 h-3 mr-1" />{filtered.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(emp => (
                <TableRow key={emp.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/hrm/employees/${emp.id}`)}>
                  <TableCell className="font-mono">{emp.employee_code}</TableCell>
                  <TableCell className="font-medium">{emp.first_name} {emp.last_name}</TableCell>
                  <TableCell>{getDeptName(emp.department_id)}</TableCell>
                  <TableCell>{getDesigName(emp.designation_id)}</TableCell>
                  <TableCell>{getBranchName(emp.branch_id)}</TableCell>
                  <TableCell>
                    {linkedUsers[emp.id] ? (
                      <Badge variant="outline" className="text-xs gap-1"><KeyRound className="w-3 h-3" />{linkedUsers[emp.id]}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">No login</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant={emp.status === "active" ? "default" : "secondary"} className="capitalize">{emp.status || "unknown"}</Badge></TableCell>
                  {isAdmin && (
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" aria-label="View employee" onClick={(e) => { e.stopPropagation(); navigate(`/hrm/employees/${emp.id}`); }}><Eye className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label="Edit employee" onClick={(e) => { e.stopPropagation(); openEdit(emp); }}><Edit className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label="Delete employee" onClick={(e) => { e.stopPropagation(); handleDelete(emp.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No employees found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Employee Code *</Label><Input value={form.employee_code} onChange={e => setForm({...form, employee_code: e.target.value})} /></div>
            <div><Label>First Name *</Label><Input value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} /></div>
            <div><Label>Last Name *</Label><Input value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} /></div>
            <div><Label>Mobile</Label><Input value={form.mobile} onChange={e => setForm({...form, mobile: e.target.value})} /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
            <div><Label>National ID</Label><Input value={form.national_id} onChange={e => setForm({...form, national_id: e.target.value})} /></div>
            <div><Label>TIN Number</Label><Input value={form.tin_no} onChange={e => setForm({...form, tin_no: e.target.value})} placeholder="e.g. 123456789012" /></div>
            <div className="col-span-2"><Label>Address</Label><Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></div>
            <div>
              <Label>Department</Label>
              <Select value={form.department_id} onValueChange={v => setForm({...form, department_id: v})}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Designation</Label>
              <Select value={form.designation_id} onValueChange={v => setForm({...form, designation_id: v})}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{designations.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Branch</Label>
              <Select value={form.branch_id} onValueChange={v => setForm({...form, branch_id: v, section_id: ""})}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Section</Label>
              <Select value={form.section_id} onValueChange={v => setForm({...form, section_id: v})}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {sections.filter(s => !form.branch_id || s.branch_id === form.branch_id).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.employee_category} onValueChange={v => setForm({...form, employee_category: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">Worker</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="officer">Officer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div><Label>Joining Date</Label><Input type="date" value={form.joining_date} onChange={e => setForm({...form, joining_date: e.target.value})} /></div>
            <div><Label>Salary</Label><Input type="number" value={form.salary} onChange={e => setForm({...form, salary: Number(e.target.value)})} /></div>
            <div>
              <Label>Employment Type</Label>
              <Select value={form.employment_type} onValueChange={v => setForm({...form, employment_type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="permanent">Permanent</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="probation">Probation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Login Account Section */}
          <div className="border-t pt-4 mt-2 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-medium flex items-center gap-2">
                  <KeyRound className="w-4 h-4" /> Employee Login Account
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {form.create_login
                    ? "This employee can login to the Employee Portal"
                    : "Enable to allow this employee to login"}
                </p>
              </div>
              <Switch
                checked={form.create_login}
                onCheckedChange={v => {
                  setForm({
                    ...form,
                    create_login: v,
                    ...(!v ? { username: "", password: "" } : {}),
                    ...(v && !form.username ? { username: generateUsername() } : {}),
                  });
                  if (!v) setShowPassword(false);
                }}
              />
            </div>
            {form.create_login && (
              <div className="grid grid-cols-2 gap-4 bg-muted/50 p-3 rounded-lg border border-border/50">
                <div>
                  <Label>Username *</Label>
                  <div className="flex gap-1">
                    <Input
                      value={form.username}
                      onChange={e => setForm({...form, username: e.target.value})}
                      placeholder="EMP-0001"
                      autoComplete="off"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Auto-generate username"
                      onClick={() => setForm({...form, username: generateUsername()})}
                      title="Auto-generate username"
                    >
                      <Wand2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <Label>{editId && linkedUsers[editId!] ? "New Password (leave blank to keep)" : "Password *"}</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={e => setForm({...form, password: e.target.value})}
                      placeholder={editId && linkedUsers[editId!] ? "Leave blank to keep current" : "Min 6 characters"}
                      autoComplete="new-password"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {!form.create_login && editId && linkedUsers[editId!] && (
              <p className="text-xs text-destructive bg-destructive/10 p-2 rounded">
                ⚠️ Turning off will disable this employee's login access
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} config={{
        title: "Bulk Import Employees",
        table: "employees",
        templateFilename: "employees_template.csv",
        helpText: "Department/Designation/Branch/Section must match existing active names. Joining Date: YYYY-MM-DD.",
        columns: [
          { key: "employee_code", label: "Employee Code", required: true, example: "EMP-0001" },
          { key: "first_name", label: "First Name", required: true, example: "John" },
          { key: "last_name", label: "Last Name", required: true, example: "Doe" },
          { key: "mobile", label: "Mobile", example: "01700000000" },
          { key: "email", label: "Email", example: "john@example.com" },
          { key: "national_id", label: "National ID", example: "" },
          { key: "tin_no", label: "TIN Number", example: "" },
          { key: "address", label: "Address", example: "" },
          { key: "department", label: "Department", example: "Production" },
          { key: "designation", label: "Designation", example: "Manager" },
          { key: "branch", label: "Branch", example: "Head Office" },
          { key: "section", label: "Section", example: "Cutting" },
          { key: "joining_date", label: "Joining Date", example: "2025-01-01" },
          { key: "salary", label: "Salary", example: "25000" },
          { key: "employment_type", label: "Employment Type", example: "permanent" },
          { key: "status", label: "Status", example: "active" },
        ],
        dedupeKey: (r) => r.employee_code?.toLowerCase(),
        transform: (r) => {
          const findId = (list: any[], name: string, field = "name") => {
            if (!name) return null;
            const m = list.find((x: any) => (x[field] || "").toLowerCase() === name.toLowerCase());
            if (!m) throw new Error(`${field} not found: ${name}`);
            return m.id;
          };
          if (r.joining_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.joining_date)) throw new Error("Joining Date must be YYYY-MM-DD");
          return {
            employee_code: r.employee_code,
            first_name: r.first_name,
            last_name: r.last_name,
            mobile: r.mobile || null,
            email: r.email || null,
            national_id: r.national_id || null,
            tin_no: r.tin_no || null,
            address: r.address || null,
            department_id: r.department ? findId(departments, r.department) : null,
            designation_id: r.designation ? findId(designations, r.designation) : null,
            branch_id: r.branch ? findId(branches, r.branch) : null,
            section_id: r.section ? findId(sections, r.section) : null,
            joining_date: r.joining_date || new Date().toISOString().split("T")[0],
            salary: Number(r.salary || 0),
            employment_type: (r.employment_type || "permanent").toLowerCase(),
            status: (r.status || "active").toLowerCase(),
            approval_status: "approved",
          };
        },
        onSuccess: fetchAll,
      }} />
    </div>
  );
}
