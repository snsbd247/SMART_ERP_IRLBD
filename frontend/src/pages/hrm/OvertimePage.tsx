import { useState, useEffect, useCallback } from "react";
import { dataClient } from "@/integrations/data/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, CheckCircle, Upload } from "lucide-react";
import { BulkImportDialog } from "@/components/hrm/BulkImportDialog";

import { DateInput } from "@/components/ui/date-input";
interface Employee { id: string; employee_code: string; first_name: string; last_name: string; }
interface OvertimeRecord { id: string; employee_id: string; date: string; hours: number; status: string; }

export default function OvertimePage() {
  const { hasPermission, user } = useAuth();
  const canManage = hasPermission("hrm", "can_add");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<OvertimeRecord[]>([]);
  const [dialog, setDialog] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", date: new Date().toISOString().split("T")[0], hours: 0 });

  const fetchData = useCallback(async () => {
    const [empRes, otRes] = await Promise.all([
      dataClient.from("employees" as any).select("id, employee_code, first_name, last_name").eq("status", "active"),
      dataClient.from("overtime_records" as any).select("*").order("date", { ascending: false }).limit(100),
    ]);
    if (empRes.data) setEmployees(empRes.data as any);
    if (otRes.data) setRecords(otRes.data as any);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const save = async () => {
    if (!form.employee_id || form.hours <= 0) { toast.error("Select employee and enter hours"); return; }
    const { error } = await dataClient.from("overtime_records" as any).insert(form as any);
    if (error) toast.error(error.message); else { toast.success("Overtime recorded"); setDialog(false); fetchData(); }
  };

  const approve = async (id: string) => {
    await dataClient.from("overtime_records" as any).update({ status: "approved", approved_by: user?.id } as any).eq("id", id);
    toast.success("Overtime approved");
    fetchData();
  };

  const getEmpName = (id: string) => { const e = employees.find(e => e.id === id); return e ? `${e.first_name} ${e.last_name}` : "-"; };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Overtime Management</h1>
          <p className="text-muted-foreground">Track and approve employee overtime hours</p>
        </div>
        {canManage && <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4 mr-2" />Bulk Import</Button>
          <Button onClick={() => { setForm({ employee_id: "", date: new Date().toISOString().split("T")[0], hours: 0 }); setDialog(true); }}><Plus className="w-4 h-4 mr-2" />Record Overtime</Button>
        </div>}
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{getEmpName(r.employee_id)}</TableCell>
                  <TableCell>{r.date}</TableCell>
                  <TableCell className="text-right font-mono">{r.hours}</TableCell>
                  <TableCell><Badge variant={r.status === "approved" ? "default" : "secondary"} className="capitalize">{r.status}</Badge></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {r.status === "pending" && <Button variant="ghost" size="sm" onClick={() => approve(r.id)}><CheckCircle className="w-4 h-4 mr-1" />Approve</Button>}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {records.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No overtime records</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Overtime</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Employee *</Label>
              <Select value={form.employee_id} onValueChange={v => setForm({ ...form, employee_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.first_name} {e.last_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Date</Label><DateInput value={form.date} onChange={(v) => setForm({ ...form, date: v })} /></div>
            <div><Label>Hours</Label><Input type="number" step="0.5" value={form.hours} onChange={e => setForm({ ...form, hours: Number(e.target.value) })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} config={{
        title: "Bulk Import Overtime",
        table: "overtime_records",
        templateFilename: "overtime_template.csv",
        helpText: "Date: YYYY-MM-DD. Hours: decimal (e.g. 2.5).",
        columns: [
          { key: "employee_code", label: "Employee Code", required: true, example: "EMP-0001" },
          { key: "date", label: "Date", required: true, example: "2025-01-15" },
          { key: "hours", label: "Hours", required: true, example: "2.5" },
          { key: "status", label: "Status", example: "pending" },
        ],
        transform: (r) => {
          const emp = employees.find(e => e.employee_code?.toLowerCase() === r.employee_code.toLowerCase());
          if (!emp) throw new Error(`Employee not found: ${r.employee_code}`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new Error("Date must be YYYY-MM-DD");
          const hrs = Number(r.hours);
          if (!(hrs > 0)) throw new Error("Hours must be > 0");
          return {
            employee_id: emp.id,
            date: r.date,
            hours: hrs,
            status: (r.status || "pending").toLowerCase(),
          };
        },
        onSuccess: fetchData,
      }} />
    </div>
  );
}
