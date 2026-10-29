import { useEffect, useMemo, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Layers, Search, ChevronRight, ChevronDown, FolderTree, List } from "lucide-react";
import { toast } from "sonner";

interface StockGroup {
  id: string;
  name: string;
  parent_id: string | null;
  primary_group_id: string | null;
  is_default: boolean;
  is_active: boolean;
}

const StockGroupsPage = () => {
  const [groups, setGroups] = useState<StockGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [edit, setEdit] = useState<StockGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "tree">("tree");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const [f, setF] = useState({ name: "", parent_id: "", primary_group_id: "", is_default: false, is_active: true });

  const fetchAll = async () => {
    setLoading(true);
    const { data } = await (dataClient.from as any)("stock_groups").select("*").order("name");
    setGroups((data || []) as StockGroup[]);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  // Primary groups = root groups (no parent)
  const primaryGroups = useMemo(() => groups.filter((g) => !g.parent_id), [groups]);

  // Compute descendant set for the edited group (to prevent circular hierarchy)
  const descendantIds = useMemo(() => {
    if (!edit) return new Set<string>();
    const childrenOf = new Map<string, string[]>();
    groups.forEach((g) => {
      if (g.parent_id) {
        if (!childrenOf.has(g.parent_id)) childrenOf.set(g.parent_id, []);
        childrenOf.get(g.parent_id)!.push(g.id);
      }
    });
    const out = new Set<string>();
    const walk = (id: string) => {
      (childrenOf.get(id) || []).forEach((c) => { if (!out.has(c)) { out.add(c); walk(c); } });
    };
    walk(edit.id);
    return out;
  }, [edit, groups]);

  const openCreate = () => {
    setEdit(null);
    setF({ name: "", parent_id: "", primary_group_id: "", is_default: false, is_active: true });
    setDialogOpen(true);
  };
  const openEdit = (g: StockGroup) => {
    setEdit(g);
    setF({
      name: g.name,
      parent_id: g.parent_id || "",
      primary_group_id: g.primary_group_id || "",
      is_default: g.is_default,
      is_active: g.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!f.name.trim()) { toast.error("Name required"); return; }
    const parent_id = f.parent_id || null;

    // Validation: prevent self-parent
    if (edit && parent_id === edit.id) { toast.error("A group cannot be its own parent"); return; }
    // Validation: prevent circular hierarchy — parent cannot be a descendant of the edited group
    if (edit && parent_id && descendantIds.has(parent_id)) {
      toast.error("Cannot select a descendant as parent (circular hierarchy)"); return;
    }
    // Validation: primary group must be a root group (no parent) and not the group itself
    let primary_group_id: string | null = f.primary_group_id || null;
    if (primary_group_id) {
      if (edit && primary_group_id === edit.id) { toast.error("A group cannot be its own primary"); return; }
      const pg = byId.get(primary_group_id);
      if (!pg) { toast.error("Selected primary group not found"); return; }
      if (pg.parent_id) { toast.error("Primary group must be a root (top-level) group"); return; }
    }
    setSaving(true);
    // If no explicit primary chosen, derive: root => null (self after insert); else inherit from parent
    if (!primary_group_id) {
      if (!parent_id) primary_group_id = null;
      else {
        const p = byId.get(parent_id);
        primary_group_id = p?.primary_group_id || p?.id || null;
      }
    }
    const payload: any = {
      name: f.name.trim(),
      parent_id,
      primary_group_id,
      is_default: f.is_default,
      is_active: f.is_active,
      updated_at: new Date().toISOString(),
    };
    try {
      if (edit) {
        const { error } = await (dataClient.from as any)("stock_groups").update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { data, error } = await (dataClient.from as any)("stock_groups").insert(payload).select().single();
        if (error) throw error;
        // self-primary for new roots
        if (!parent_id && !primary_group_id && data?.id) {
          await (dataClient.from as any)("stock_groups").update({ primary_group_id: data.id }).eq("id", data.id);
        }
      }
      toast.success(edit ? "Stock group updated" : "Stock group created");
      setDialogOpen(false);
      fetchAll();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally { setSaving(false); }
  };

  const handleDelete = async (g: StockGroup) => {
    if (!confirm(`Delete stock group "${g.name}"?`)) return;
    const { error } = await (dataClient.from as any)("stock_groups").delete().eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    fetchAll();
  };

  const filtered = groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()));

  // Build children map for tree view
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, StockGroup[]>();
    groups.forEach((g) => {
      const k = g.parent_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(g);
    });
    return m;
  }, [groups]);

  const renderTreeRow = (g: StockGroup, depth: number): React.ReactNode[] => {
    const kids = childrenOf.get(g.id) || [];
    const isOpen = expanded.has(g.id);
    const matchSelf = !search || g.name.toLowerCase().includes(search.toLowerCase());
    const rows: React.ReactNode[] = [];
    if (matchSelf || search) {
      rows.push(
        <TableRow key={g.id}>
          <TableCell>
            <div className="flex items-center" style={{ paddingLeft: depth * 20 }}>
              {kids.length > 0 ? (
                <button onClick={() => toggleExpand(g.id)} className="mr-1 text-muted-foreground hover:text-foreground">
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              ) : <span className="w-5 inline-block" />}
              <FolderTree className="w-4 h-4 mr-2 text-primary" />
              <span className="font-medium">{g.name}</span>
              {kids.length > 0 && <span className="ml-2 text-xs text-muted-foreground">({kids.length})</span>}
            </div>
          </TableCell>
          <TableCell>{g.primary_group_id ? byId.get(g.primary_group_id)?.name || g.name : g.name}</TableCell>
          <TableCell>{g.is_default ? "Yes" : "—"}</TableCell>
          <TableCell className="text-right">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(g)}><Pencil className="w-3.5 h-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(g)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
          </TableCell>
        </TableRow>
      );
    }
    if (isOpen || search) kids.forEach((k) => rows.push(...renderTreeRow(k, depth + 1)));
    return rows;
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Layers className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold text-foreground">Stock Groups</h1></div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <Button variant={viewMode === "tree" ? "secondary" : "ghost"} size="sm" className="rounded-none h-8" onClick={() => setViewMode("tree")}><FolderTree className="w-4 h-4 mr-1" />Tree</Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="sm" className="rounded-none h-8" onClick={() => setViewMode("list")}><List className="w-4 h-4 mr-1" />List</Button>
          </div>
          <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" />Add Stock Group</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search groups..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card><CardContent className="p-0">
        {viewMode === "tree" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group Name</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Default</TableHead>
                <TableHead className="w-24 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
              ) : (childrenOf.get(null) || []).length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No stock groups</TableCell></TableRow>
              ) : (childrenOf.get(null) || []).flatMap((g) => renderTreeRow(g, 0))}
            </TableBody>
          </Table>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">SL</TableHead>
              <TableHead>Group Name</TableHead>
              <TableHead>Group Parent</TableHead>
              <TableHead>Group Primary</TableHead>
              <TableHead>Default Group</TableHead>
              <TableHead className="w-24 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No stock groups</TableCell></TableRow>
            ) : filtered.map((g, idx) => (
              <TableRow key={g.id}>
                <TableCell>{idx + 1}</TableCell>
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell>{g.parent_id ? byId.get(g.parent_id)?.name || "—" : g.name}</TableCell>
                <TableCell>{g.primary_group_id ? byId.get(g.primary_group_id)?.name || g.name : g.name}</TableCell>
                <TableCell>{g.is_default ? byId.get(g.primary_group_id || g.id)?.name || g.name : "—"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(g)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(g)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{edit ? "Edit Stock Group" : "Add Stock Group"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Group Name *</Label>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div className="space-y-1"><Label>Group Parent</Label>
              <Select value={f.parent_id || "__none__"} onValueChange={(v) => setF({ ...f, parent_id: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="None (root)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (root)</SelectItem>
                  {groups.filter((g) => g.id !== edit?.id && !descendantIds.has(g.id)).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Group Primary</Label>
              <Select value={f.primary_group_id || "__auto__"} onValueChange={(v) => setF({ ...f, primary_group_id: v === "__auto__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Auto from parent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">Auto from parent</SelectItem>
                  {primaryGroups.filter((g) => g.id !== edit?.id).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2"><Switch checked={f.is_default} onCheckedChange={(v) => setF({ ...f, is_default: v })} /><Label>Default Group</Label></div>
            <div className="flex items-center gap-2"><Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StockGroupsPage;
