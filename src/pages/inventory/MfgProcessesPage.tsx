import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2 } from "lucide-react";

export default function MfgProcessesPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", code: "", description: "" });

  const load = async () => {
    const { data } = await supabase.from("mfg_processes" as any).select("*").order("name");
    setRows((data as any[]) || []);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.code) { toast({ title: "Name & code required", variant: "destructive" }); return; }
    const { error } = editing
      ? await supabase.from("mfg_processes" as any).update(form as any).eq("id", editing.id)
      : await supabase.from("mfg_processes" as any).insert(form as any);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setOpen(false); setEditing(null); setForm({ name: "", code: "", description: "" }); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete?")) return;
    await supabase.from("mfg_processes" as any).delete().eq("id", id);
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">MFG. Processes</h1>
        <Button size="sm" onClick={() => { setEditing(null); setForm({ name: "", code: "", description: "" }); setOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" />New
        </Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead className="w-24"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No processes</TableCell></TableRow>
              : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.description || "—"}</TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm({ name: r.name, code: r.code, description: r.description || "" }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(r.id)}><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Process</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Code *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            </div>
            <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
