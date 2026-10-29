import { useEffect, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Tag, Lock } from "lucide-react";

interface PType {
  id: string; code: string; name: string; description?: string;
  is_system: boolean; is_active: boolean;
  requires_grn: boolean; requires_lc: boolean;
  affects_inventory: boolean; affects_asset: boolean;
}

const empty: Partial<PType> = { is_active: true, requires_grn: true, requires_lc: false, affects_inventory: true, affects_asset: false };

const PurchaseTypesPage = () => {
  const [items, setItems] = useState<PType[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PType | null>(null);
  const [form, setForm] = useState<Partial<PType>>(empty);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data } = await dataClient.from("purchase_types" as any).select("*").order("name");
    setItems((data || []) as any); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (p: PType) => { setEditing(p); setForm(p); setOpen(true); };

  const save = async () => {
    if (!form.code || !form.name) { toast({ title: "Code & Name required", variant: "destructive" }); return; }
    const payload: any = { ...form };
    const { error } = editing
      ? await dataClient.from("purchase_types" as any).update(payload).eq("id", editing.id)
      : await dataClient.from("purchase_types" as any).insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Saved" }); setOpen(false); load(); }
  };
  const remove = async (p: PType) => {
    if (p.is_system) { toast({ title: "System types cannot be deleted", variant: "destructive" }); return; }
    if (!confirm("Delete?")) return;
    const { error } = await dataClient.from("purchase_types" as any).delete().eq("id", p.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Tag className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Purchase Types</h1></div>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" />New Type</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Code</TableHead><TableHead>Name</TableHead>
            <TableHead>GRN</TableHead><TableHead>LC</TableHead>
            <TableHead>Inventory</TableHead><TableHead>Asset</TableHead>
            <TableHead>Status</TableHead><TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : items.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs flex items-center gap-1">{p.code}{p.is_system && <Lock className="w-3 h-3 text-muted-foreground" />}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.requires_grn ? "Yes" : "No"}</TableCell>
                <TableCell>{p.requires_lc ? "Yes" : "No"}</TableCell>
                <TableCell>{p.affects_inventory ? "Yes" : "No"}</TableCell>
                <TableCell>{p.affects_asset ? "Yes" : "No"}</TableCell>
                <TableCell>{p.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" disabled={p.is_system} onClick={() => remove(p)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Purchase Type" : "New Purchase Type"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Code *</Label><Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} disabled={!!editing?.is_system} /></div>
            <div className="space-y-1"><Label>Name *</Label><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="col-span-2 space-y-1"><Label>Description</Label><Input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            {[
              ["requires_grn", "Requires GRN"], ["requires_lc", "Requires LC"],
              ["affects_inventory", "Affects Inventory"], ["affects_asset", "Affects Asset"],
              ["is_active", "Active"],
            ].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={(form as any)[k] || false} onChange={(e) => setForm({ ...form, [k]: e.target.checked } as any)} />
                {l}
              </label>
            ))}
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PurchaseTypesPage;
