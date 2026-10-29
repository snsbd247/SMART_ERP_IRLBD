import { useEffect, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";

const DOC_TYPES = ["PR", "PO", "GRN", "BILL", "PAYMENT"];

const empty: any = { document_type: "PR", min_amount: 0, max_amount: null, step_order: 1, is_active: true };

const ApprovalMatrixPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const [r, t, b] = await Promise.all([
      dataClient.from("purchase_approval_matrix" as any).select("*").order("document_type").order("step_order"),
      dataClient.from("purchase_types" as any).select("id,code,name").eq("is_active", true),
      dataClient.from("branches").select("id,name"),
    ]);
    setRows((r.data || []) as any); setTypes(t.data || []); setBranches(b.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    const payload: any = { ...form };
    if (payload.purchase_type_id === "_any") payload.purchase_type_id = null;
    if (payload.branch_id === "_any") payload.branch_id = null;
    const { error } = editing
      ? await dataClient.from("purchase_approval_matrix" as any).update(payload).eq("id", editing.id)
      : await dataClient.from("purchase_approval_matrix" as any).insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Saved" }); setOpen(false); load(); }
  };
  const remove = async (id: string) => {
    if (!confirm("Delete rule?")) return;
    await dataClient.from("purchase_approval_matrix" as any).delete().eq("id", id);
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Approval Matrix</h1></div>
        <Button size="sm" onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />New Rule</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Doc</TableHead><TableHead>Type</TableHead><TableHead>Branch</TableHead>
            <TableHead className="text-right">Min</TableHead><TableHead className="text-right">Max</TableHead>
            <TableHead>Step</TableHead><TableHead>Approver Role</TableHead>
            <TableHead>Status</TableHead><TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : rows.length === 0 ? <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No rules defined</TableCell></TableRow>
            : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Badge variant="outline">{r.document_type}</Badge></TableCell>
                <TableCell>{types.find(t => t.id === r.purchase_type_id)?.code || "Any"}</TableCell>
                <TableCell>{branches.find(b => b.id === r.branch_id)?.name || "Any"}</TableCell>
                <TableCell className="text-right">{Number(r.min_amount || 0).toLocaleString()}</TableCell>
                <TableCell className="text-right">{r.max_amount != null ? Number(r.max_amount).toLocaleString() : "∞"}</TableCell>
                <TableCell>{r.step_order}</TableCell>
                <TableCell>{r.approver_role || "—"}</TableCell>
                <TableCell>{r.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Off</Badge>}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(r); setForm({ ...r, purchase_type_id: r.purchase_type_id || "_any", branch_id: r.branch_id || "_any" }); setOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(r.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Rule" : "New Approval Rule"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Document Type</Label>
              <Select value={form.document_type} onValueChange={(v) => setForm({ ...form, document_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Purchase Type</Label>
              <Select value={form.purchase_type_id || "_any"} onValueChange={(v) => setForm({ ...form, purchase_type_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Any</SelectItem>
                  {types.map(t => <SelectItem key={t.id} value={t.id}>{t.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Branch</Label>
              <Select value={form.branch_id || "_any"} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Any</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Step Order</Label><Input type="number" value={form.step_order} onChange={(e) => setForm({ ...form, step_order: parseInt(e.target.value) || 1 })} /></div>
            <div className="space-y-1"><Label>Min Amount</Label><Input type="number" value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: parseFloat(e.target.value) || 0 })} /></div>
            <div className="space-y-1"><Label>Max Amount (blank = ∞)</Label><Input type="number" value={form.max_amount ?? ""} onChange={(e) => setForm({ ...form, max_amount: e.target.value === "" ? null : parseFloat(e.target.value) })} /></div>
            <div className="space-y-1"><Label>Approver Role</Label><Input value={form.approver_role || ""} onChange={(e) => setForm({ ...form, approver_role: e.target.value })} placeholder="e.g. Finance Manager" /></div>
            <div className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ApprovalMatrixPage;
