import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Eye, Trash2 } from "lucide-react";
import { newPRNumber } from "@/lib/purchase-workflow-utils";

interface PR { id: string; pr_number: string; pr_date: string; status: string; notes: string | null; created_at: string; }
interface Product { id: string; product_name: string; product_code: string; }
interface Row { id: string; product_id: string; qty_required: number; remarks: string; }

const statusBadge = (s: string) => {
  const map: Record<string, string> = { draft: "secondary", approved: "default", rejected: "destructive", closed: "outline" };
  return <Badge variant={(map[s] as any) || "secondary"}>{s}</Badge>;
};

export default function RequisitionsPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { userBranchId } = useBranch();
  const { toast } = useToast();
  const [list, setList] = useState<PR[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([{ id: "1", product_id: "", qty_required: 0, remarks: "" }]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [p, pr] = await Promise.all([
      supabase.from("products").select("id,product_name,product_code").eq("status", "active").order("product_name"),
      supabase.from("purchase_requisitions" as any).select("*").order("created_at", { ascending: false }),
    ]);
    setProducts((p.data as any) || []);
    setList((pr.data as any) || []);
  };
  useEffect(() => { load(); }, []);

  const addRow = () => setRows([...rows, { id: String(Date.now()), product_id: "", qty_required: 0, remarks: "" }]);
  const delRow = (id: string) => setRows(rows.filter(r => r.id !== id));
  const updRow = (id: string, k: keyof Row, v: any) => setRows(rows.map(r => r.id === id ? { ...r, [k]: v } : r));

  const save = async () => {
    const valid = rows.filter(r => r.product_id && r.qty_required > 0);
    if (!valid.length) return toast({ title: "Add at least one item", variant: "destructive" });
    setSaving(true);
    try {
      const pr_number = await newPRNumber();
      const { data: pr, error } = await supabase.from("purchase_requisitions" as any).insert({
        pr_number, pr_date: date, branch_id: userBranchId || null, requested_by: user?.id || null,
        notes: notes || null, status: "draft", created_by: user?.id || null,
      } as any).select().single();
      if (error) throw error;
      const items = valid.map(r => ({
        pr_id: (pr as any).id, product_id: r.product_id, qty_required: r.qty_required, qty_ordered: 0, remarks: r.remarks || null,
      }));
      const { error: e2 } = await supabase.from("purchase_requisition_items" as any).insert(items);
      if (e2) throw e2;
      toast({ title: "Requisition created", description: pr_number });
      setOpen(false); setRows([{ id: "1", product_id: "", qty_required: 0, remarks: "" }]); setNotes("");
      load();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Purchase Requisitions</CardTitle>
          <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Requisition</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>PR Number</TableHead><TableHead>Date</TableHead><TableHead>Notes</TableHead>
              <TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {list.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.pr_number}</TableCell>
                  <TableCell>{p.pr_date}</TableCell>
                  <TableCell className="max-w-xs truncate">{p.notes || "-"}</TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => nav(`/purchase-workflow/requisitions/${p.id}`)}><Eye className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {!list.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No requisitions yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>New Purchase Requisition</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
              <div><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>Items</Label>
                <Button size="sm" variant="outline" onClick={addRow}><Plus className="w-3 h-3 mr-1" />Add</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="w-32">Qty</TableHead><TableHead>Remarks</TableHead><TableHead className="w-12"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Select value={r.product_id} onValueChange={v => updRow(r.id, "product_id", v)}>
                          <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                          <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.product_code} - {p.product_name}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input type="number" value={r.qty_required || ""} onChange={e => updRow(r.id, "qty_required", Number(e.target.value))} /></TableCell>
                      <TableCell><Input value={r.remarks} onChange={e => updRow(r.id, "remarks", e.target.value)} /></TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => delRow(r.id)}><Trash2 className="w-4 h-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
