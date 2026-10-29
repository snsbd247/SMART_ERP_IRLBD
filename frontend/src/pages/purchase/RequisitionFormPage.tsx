import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { nextDocNo, getPurchaseSettings, logAudit } from "@/lib/purchase-numbering";
import { Plus, Trash2, Save, Send, ArrowLeft } from "lucide-react";

import { DateInput } from "@/components/ui/date-input";
const PRIORITIES = ["low", "normal", "high", "urgent"];

const RequisitionFormPage = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast } = useToast();
  const { user, profile } = useAuth() as any;
  const isEdit = !!id;

  const [header, setHeader] = useState<any>({ pr_date: new Date().toISOString().slice(0, 10), priority: "normal", status: "draft" });
  const [lines, setLines] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [t, b, d, w, im, u] = await Promise.all([
        dataClient.from("purchase_types" as any).select("id,code,name").eq("is_active", true),
        dataClient.from("branches").select("id,name"),
        dataClient.from("departments").select("id,name"),
        dataClient.from("warehouses").select("id,name"),
        dataClient.from("item_master").select("id,name,code").limit(1000),
        dataClient.from("units").select("id,name,abbreviation"),
      ]);
      setTypes(t.data || []); setBranches(b.data || []); setDepartments(d.data || []);
      setWarehouses(w.data || []); setItems(im.data || []); setUnits(u.data || []);
      if (isEdit) {
        const [{ data: h }, { data: ls }] = await Promise.all([
          dataClient.from("purchase_requisitions" as any).select("*").eq("id", id).single(),
          dataClient.from("purchase_requisition_items" as any).select("*").eq("pr_id", id).order("line_no"),
        ]);
        if (h) setHeader(h);
        setLines((ls || []) as any);
      }
    })();
  }, [id]);

  const addLine = () => setLines([...lines, { line_no: lines.length + 1, item_description: "", quantity: 0, estimated_price: 0, estimated_amount: 0 }]);
  const updateLine = (i: number, k: string, v: any) => {
    const next = [...lines]; next[i] = { ...next[i], [k]: v };
    if (k === "quantity" || k === "estimated_price") {
      next[i].estimated_amount = (Number(next[i].quantity) || 0) * (Number(next[i].estimated_price) || 0);
    }
    setLines(next);
  };
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + Number(l.estimated_amount || 0), 0);

  const save = async (submit = false) => {
    if (lines.length === 0) { toast({ title: "Add at least one line", variant: "destructive" }); return; }
    setSaving(true);
    try {
      let prId = id;
      let prNo = header.pr_no;
      const headerPayload: any = {
        ...header,
        total_estimated: total,
        status: submit ? "submitted" : header.status || "draft",
        requested_by: user?.id,
        requested_by_name: profile?.name || user?.email,
      };
      delete headerPayload.created_at; delete headerPayload.updated_at;

      if (isEdit) {
        const { error } = await dataClient.from("purchase_requisitions" as any).update(headerPayload).eq("id", id);
        if (error) throw error;
        await dataClient.from("purchase_requisition_items" as any).delete().eq("pr_id", id);
      } else {
        const settings = await getPurchaseSettings();
        prNo = await nextDocNo(settings?.pr_prefix || "PR", "purchase_requisitions", "pr_no");
        headerPayload.pr_no = prNo;
        headerPayload.created_by = user?.id;
        const { data, error } = await dataClient.from("purchase_requisitions" as any).insert(headerPayload).select().single();
        if (error) throw error;
        prId = (data as any).id;
      }

      const linesPayload = lines.map((l, idx) => ({
        pr_id: prId, line_no: idx + 1,
        item_id: l.item_id || null, item_description: l.item_description,
        unit_id: l.unit_id || null, quantity: Number(l.quantity) || 0,
        estimated_price: Number(l.estimated_price) || 0,
        estimated_amount: Number(l.estimated_amount) || 0,
        remarks: l.remarks || null, status: "pending",
      }));
      const { error: e2 } = await dataClient.from("purchase_requisition_items" as any).insert(linesPayload);
      if (e2) throw e2;

      await logAudit({
        document_type: "PR", document_id: prId!, document_no: prNo,
        action: submit ? "SUBMITTED" : (isEdit ? "UPDATED" : "CREATED"),
        performed_by: user?.id, performed_by_name: profile?.name || user?.email,
      });

      toast({ title: submit ? "Requisition submitted" : "Saved" });
      nav(`/purchase/requisitions/${prId}`);
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => nav("/purchase/requisitions")}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-semibold">{isEdit ? `Edit ${header.pr_no || ""}` : "New Purchase Requisition"}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => save(false)} disabled={saving}><Save className="w-4 h-4 mr-1" />Save Draft</Button>
          <Button size="sm" onClick={() => save(true)} disabled={saving}><Send className="w-4 h-4 mr-1" />Submit</Button>
        </div>
      </div>

      <Card><CardHeader><CardTitle className="text-base">Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1"><Label>PR Date</Label><DateInput value={header.pr_date || ""} onChange={(v) => setHeader({ ...header, pr_date: v })} /></div>
          <div className="space-y-1"><Label>Required Date</Label><DateInput value={header.required_date || ""} onChange={(v) => setHeader({ ...header, required_date: v })} /></div>
          <div className="space-y-1"><Label>Purchase Type</Label>
            <Select value={header.purchase_type_id || "_none"} onValueChange={(v) => setHeader({ ...header, purchase_type_id: v === "_none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="_none">—</SelectItem>{types.map(t => <SelectItem key={t.id} value={t.id}>{t.code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Priority</Label>
            <Select value={header.priority} onValueChange={(v) => setHeader({ ...header, priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Branch / Factory</Label>
            <Select value={header.branch_id || "_none"} onValueChange={(v) => setHeader({ ...header, branch_id: v === "_none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="_none">—</SelectItem>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Department</Label>
            <Select value={header.department_id || "_none"} onValueChange={(v) => setHeader({ ...header, department_id: v === "_none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="_none">—</SelectItem>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Store / Warehouse</Label>
            <Select value={header.warehouse_id || "_none"} onValueChange={(v) => setHeader({ ...header, warehouse_id: v === "_none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="_none">—</SelectItem>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2 md:col-span-4"><Label>Remarks</Label><Input value={header.remarks || ""} onChange={(e) => setHeader({ ...header, remarks: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-4 h-4 mr-1" />Add Line</Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10">#</TableHead><TableHead>Item</TableHead><TableHead>Description</TableHead>
              <TableHead>Unit</TableHead><TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Est. Price</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-10"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No lines. Click "Add Line".</TableCell></TableRow>
              : lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>
                    <Select value={l.item_id || "_none"} onValueChange={(v) => {
                      const it = items.find((x: any) => x.id === v);
                      const next = [...lines]; next[i] = { ...next[i], item_id: v === "_none" ? null : v, item_description: it ? it.name : next[i].item_description };
                      setLines(next);
                    }}>
                      <SelectTrigger className="h-8 w-44"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent><SelectItem value="_none">— None —</SelectItem>{items.map((x: any) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input className="h-8" value={l.item_description} onChange={(e) => updateLine(i, "item_description", e.target.value)} /></TableCell>
                  <TableCell>
                    <Select value={l.unit_id || "_none"} onValueChange={(v) => updateLine(i, "unit_id", v === "_none" ? null : v)}>
                      <SelectTrigger className="h-8 w-24"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent><SelectItem value="_none">—</SelectItem>{units.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.abbreviation}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input type="number" className="h-8 w-24 text-right" value={l.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} /></TableCell>
                  <TableCell><Input type="number" className="h-8 w-28 text-right" value={l.estimated_price} onChange={(e) => updateLine(i, "estimated_price", e.target.value)} /></TableCell>
                  <TableCell className="text-right font-mono">{Number(l.estimated_amount || 0).toLocaleString()}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeLine(i)}><Trash2 className="w-3.5 h-3.5" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end p-3 border-t font-medium">Total Estimated: <span className="ml-3 font-mono">{total.toLocaleString()}</span></div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RequisitionFormPage;
