import { useState, useEffect, useCallback } from "react";
import { dataClient } from "@/integrations/data/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Upload } from "lucide-react";
import { BulkImportDialog } from "@/components/hrm/BulkImportDialog";

interface Section {
  id: string;
  name: string;
  branch_id: string | null;
  department_id: string | null;
  description: string | null;
  status: string;
}
interface Branch { id: string; name: string; }
interface Dept { id: string; name: string; }

const defaultForm = { name: "", branch_id: "", department_id: "", description: "", status: "active" };

export default function SectionsPage() {
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission("hrm", "can_edit");
  const [items, setItems] = useState<Section[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [importOpen, setImportOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    const [sRes, bRes, dRes] = await Promise.all([
      dataClient.from("sections" as any).select("*").order("name"),
      dataClient.from("branches").select("id, name").eq("status", "active"),
      dataClient.from("departments" as any).select("id, name").eq("status", "active"),
    ]);
    if (sRes.data) setItems(sRes.data as any);
    if (bRes.data) setBranches(bRes.data as any);
    if (dRes.data) setDepartments(dRes.data as any);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openAdd = () => { setEditId(null); setForm(defaultForm); setDialogOpen(true); };
  const openEdit = (s: Section) => {
    setEditId(s.id);
    setForm({
      name: s.name,
      branch_id: s.branch_id || "",
      department_id: s.department_id || "",
      description: s.description || "",
      status: s.status,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    const payload: any = {
      name: form.name,
      branch_id: form.branch_id || null,
      department_id: form.department_id || null,
      description: form.description || null,
      status: form.status,
      updated_at: new Date().toISOString(),
    };
    const { error } = editId
      ? await dataClient.from("sections" as any).update(payload).eq("id", editId)
      : await dataClient.from("sections" as any).insert(payload);
    if (error) toast.error(error.message);
    else { toast.success(editId ? "Updated" : "Created"); setDialogOpen(false); fetchAll(); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this section?")) return;
    const { error } = await dataClient.from("sections" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); fetchAll(); }
  };

  const getBranch = (id: string | null) => branches.find(b => b.id === id)?.name || "-";
  const getDept = (id: string | null) => departments.find(d => d.id === id)?.name || "-";

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sections</h1>
          <p className="text-muted-foreground">Factory shop floor sections (e.g. Cutting, Sewing)</p>
        </div>
        {isAdmin && <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4 mr-2" />Bulk Import</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4 mr-2" />Add Section</Button>
        </div>}
      </div>
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{getBranch(s.branch_id)}</TableCell>
                  <TableCell>{getDept(s.department_id)}</TableCell>
                  <TableCell className="text-muted-foreground">{s.description || "-"}</TableCell>
                  <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"} className="capitalize">{s.status}</Badge></TableCell>
                  {isAdmin && (
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Edit className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No sections</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Section</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Branch</Label>
                <Select value={form.branch_id} onValueChange={v => setForm({...form, branch_id: v})}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={v => setForm({...form, department_id: v})}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} config={{
        title: "Bulk Import Sections",
        table: "sections",
        templateFilename: "sections_template.csv",
        helpText: "Branch and Department must match existing active names.",
        columns: [
          { key: "name", label: "Name", required: true, example: "Cutting" },
          { key: "branch", label: "Branch", example: "Head Office" },
          { key: "department", label: "Department", example: "Production" },
          { key: "description", label: "Description", example: "" },
          { key: "status", label: "Status", example: "active" },
        ],
        dedupeKey: (r) => r.name?.toLowerCase(),
        transform: (r) => {
          const branch_id = r.branch ? branches.find(b => b.name.toLowerCase() === r.branch.toLowerCase())?.id : null;
          if (r.branch && !branch_id) throw new Error(`Branch not found: ${r.branch}`);
          const department_id = r.department ? departments.find(d => d.name.toLowerCase() === r.department.toLowerCase())?.id : null;
          if (r.department && !department_id) throw new Error(`Department not found: ${r.department}`);
          return {
            name: r.name,
            branch_id: branch_id || null,
            department_id: department_id || null,
            description: r.description || null,
            status: (r.status || "active").toLowerCase(),
          };
        },
        onSuccess: fetchAll,
      }} />
    </div>
  );
}
