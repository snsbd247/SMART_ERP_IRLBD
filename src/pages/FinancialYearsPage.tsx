import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Plus, Check, X, Pencil, Trash2 } from "lucide-react";

interface FY { id: string; name: string; start_date: string; end_date: string; is_active: boolean; }

/** Two [start,end] date ranges (inclusive, "YYYY-MM-DD" strings) overlap unless one ends before the other begins. */
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Multiple financial years may be active at once (voucher posting picks the
 * right one by date), but two *active* years must never cover the same date
 * — otherwise which one applies is ambiguous. Returns the conflicting year,
 * or null if the candidate range is safe to activate.
 */
function findActiveOverlap(candidate: { id?: string; start_date: string; end_date: string }, years: FY[]): FY | null {
  return years.find((y) =>
    y.id !== candidate.id &&
    y.is_active &&
    rangesOverlap(candidate.start_date, candidate.end_date, y.start_date, y.end_date)
  ) || null;
}

const FinancialYearsPage = () => {
  const [years, setYears] = useState<FY[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FY | null>(null);
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "", is_active: false });
  const [deleteTarget, setDeleteTarget] = useState<FY | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  useEffect(() => { load(); }, []);

  const load = async () => {
    const { data } = await supabase.from("financial_years").select("*").order("start_date", { ascending: false });
    setYears((data || []) as FY[]);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", start_date: "", end_date: "", is_active: false });
    setOpen(true);
  };

  const openEdit = (y: FY) => {
    setEditing(y);
    setForm({ name: y.name, start_date: y.start_date, end_date: y.end_date, is_active: y.is_active });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.start_date || !form.end_date) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (form.end_date < form.start_date) {
      toast({ title: "Invalid dates", description: "End date must be after start date.", variant: "destructive" });
      return;
    }
    if (form.is_active) {
      const conflict = findActiveOverlap({ id: editing?.id, start_date: form.start_date, end_date: form.end_date }, years);
      if (conflict) {
        toast({
          title: "Dates overlap an active year",
          description: `${conflict.name} (${conflict.start_date} to ${conflict.end_date}) is already active and covers some of these dates. Deactivate it first, or adjust the dates.`,
          variant: "destructive",
        });
        return;
      }
    }
    if (editing) {
      const { error } = await supabase.from("financial_years").update({ ...form }).eq("id", editing.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Financial year updated" });
    } else {
      const { error } = await supabase.from("financial_years").insert({ ...form });
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Financial year created" });
    }
    setOpen(false);
    setEditing(null);
    setForm({ name: "", start_date: "", end_date: "", is_active: false });
    load();
  };

  // Multiple years can be active at the same time — voucher posting picks the
  // right one by date automatically. We only block turning one on if its
  // dates overlap another year that's already active (see findActiveOverlap).
  const setActive = async (id: string) => {
    const y = years.find((x) => x.id === id);
    if (!y) return;
    const conflict = findActiveOverlap(y, years);
    if (conflict) {
      toast({
        title: "Dates overlap an active year",
        description: `${conflict.name} (${conflict.start_date} to ${conflict.end_date}) is already active and covers some of these dates. Deactivate it first.`,
        variant: "destructive",
      });
      return;
    }
    const { error } = await supabase.from("financial_years").update({ is_active: true }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${y.name} activated` });
    load();
  };

  const deactivate = async (id: string) => {
    const y = years.find((x) => x.id === id);
    const { error } = await supabase.from("financial_years").update({ is_active: false }).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${y?.name ?? "Year"} deactivated` });
    load();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Block deletion of the active year.
      if (deleteTarget.is_active) {
        toast({ title: "Cannot delete active year", description: "Set another year active first.", variant: "destructive" });
        return;
      }
      // Dependency check — any voucher referencing this year blocks deletion.
      const { count, error: cErr } = await supabase
        .from("acc_vouchers")
        .select("id", { count: "exact", head: true })
        .eq("financial_year_id", deleteTarget.id);
      if (cErr) throw cErr;
      if ((count ?? 0) > 0) {
        toast({
          title: "Cannot delete",
          description: `This financial year has ${count} voucher entry(ies). Remove or reassign them first.`,
          variant: "destructive",
        });
        return;
      }
      const { error } = await supabase.from("financial_years").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast({ title: "Financial year deleted" });
      setDeleteTarget(null);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1000px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Financial Years</h1>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild><Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" />Add Year</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit Financial Year" : "New Financial Year"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="FY 2026-27" /></div>
              <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
              <div><Label>End Date</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="cursor-pointer">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Multiple years can be active at once — vouchers automatically post to whichever
                    active year contains the voucher date. Active years can't have overlapping dates.
                  </p>
                </div>
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              </div>
              <Button onClick={save} className="w-full">{editing ? "Update" : "Save"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {years.map((y) => (
                <TableRow key={y.id}>
                  <TableCell className="font-medium">{y.name}</TableCell>
                  <TableCell>{y.start_date}</TableCell>
                  <TableCell>{y.end_date}</TableCell>
                  <TableCell>
                    {y.is_active ? (
                      <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">Active</span>
                    ) : (
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Inactive</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {y.is_active ? (
                        <Button size="sm" variant="outline" onClick={() => deactivate(y.id)}>
                          <X className="w-3 h-3 mr-1" />Deactivate
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setActive(y.id)}>
                          <Check className="w-3 h-3 mr-1" />Activate
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(y)} title="Edit">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => setDeleteTarget(y)}
                        disabled={y.is_active}
                        title={y.is_active ? "Set another year active first" : "Delete"}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {years.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No financial years</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Financial Year</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete "{deleteTarget?.name}"? This cannot be undone.
              The year cannot be deleted if any voucher is linked to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FinancialYearsPage;
