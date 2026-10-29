import { useEffect, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, BookOpen } from "lucide-react";

const FIELDS: [string, string][] = [
  ["inventory_account_id", "Inventory"],
  ["grn_clearing_account_id", "GRN Clearing"],
  ["payable_account_id", "Supplier Payable"],
  ["advance_account_id", "Supplier Advance"],
  ["vat_input_account_id", "VAT Input"],
  ["ait_account_id", "AIT / TDS"],
  ["asset_account_id", "Fixed Asset"],
  ["expense_account_id", "Expense"],
  ["discount_account_id", "Discount Received"],
  ["freight_account_id", "Freight"],
  ["landed_cost_account_id", "Landed Cost Clearing"],
  ["cash_account_id", "Cash"],
  ["bank_account_id", "Bank"],
];

const empty: any = { is_active: true };

const CoaMappingPage = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);
  const { toast } = useToast();

  const load = async () => {
    const [r, t, b, a] = await Promise.all([
      dataClient.from("purchase_coa_mapping" as any).select("*"),
      dataClient.from("purchase_types" as any).select("id,code,name").eq("is_active", true),
      dataClient.from("branches").select("id,name"),
      dataClient.from("chart_of_accounts").select("id,account_code,account_name").eq("is_active", true).order("account_code"),
    ]);
    setRows((r.data || []) as any); setTypes(t.data || []); setBranches(b.data || []); setAccounts(a.data || []);
  };
  useEffect(() => { load(); }, []);

  const acctLabel = (id: string | null) => {
    if (!id) return "—";
    const a = accounts.find((x: any) => x.id === id);
    return a ? `${a.account_code} — ${a.account_name}` : "—";
  };


  const save = async () => {
    const payload: any = { ...form };
    if (payload.purchase_type_id === "_any") payload.purchase_type_id = null;
    if (payload.branch_id === "_any") payload.branch_id = null;
    Object.keys(payload).forEach(k => { if (payload[k] === "_none") payload[k] = null; });
    const { error } = editing
      ? await dataClient.from("purchase_coa_mapping" as any).update(payload).eq("id", editing.id)
      : await dataClient.from("purchase_coa_mapping" as any).insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Saved" }); setOpen(false); load(); }
  };
  const remove = async (id: string) => {
    if (!confirm("Delete mapping?")) return;
    await dataClient.from("purchase_coa_mapping" as any).delete().eq("id", id);
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Purchase COA Mapping</h1></div>
        <Button size="sm" onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}><Plus className="w-4 h-4 mr-1" />New Mapping</Button>
      </div>
      <p className="text-sm text-muted-foreground">Default accounts used for automatic journal posting at GRN / Bill / Payment / Asset / Utility events.</p>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Type</TableHead><TableHead>Branch</TableHead>
            <TableHead>Inventory</TableHead><TableHead>GRN Clr</TableHead><TableHead>Payable</TableHead>
            <TableHead>VAT</TableHead><TableHead>Asset</TableHead><TableHead>Expense</TableHead>
            <TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No mappings</TableCell></TableRow>
            : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{types.find(t => t.id === r.purchase_type_id)?.code || "Any"}</TableCell>
                <TableCell>{branches.find(b => b.id === r.branch_id)?.name || "Any"}</TableCell>
                <TableCell className="font-mono text-xs">{acctLabel(r.inventory_account_id)}</TableCell>
                <TableCell className="font-mono text-xs">{acctLabel(r.grn_clearing_account_id)}</TableCell>
                <TableCell className="font-mono text-xs">{acctLabel(r.payable_account_id)}</TableCell>
                <TableCell className="font-mono text-xs">{acctLabel(r.vat_input_account_id)}</TableCell>
                <TableCell className="font-mono text-xs">{acctLabel(r.asset_account_id)}</TableCell>
                <TableCell className="font-mono text-xs">{acctLabel(r.expense_account_id)}</TableCell>
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Mapping" : "New Mapping"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Purchase Type</Label>
              <Select value={form.purchase_type_id || "_any"} onValueChange={(v) => setForm({ ...form, purchase_type_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Any (default)</SelectItem>
                  {types.map(t => <SelectItem key={t.id} value={t.id}>{t.code} — {t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Branch</Label>
              <Select value={form.branch_id || "_any"} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Any (default)</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {FIELDS.map(([k, l]) => (
              <div key={k} className="space-y-1"><Label>{l}</Label>
                <Select value={form[k] || "_none"} onValueChange={(v) => setForm({ ...form, [k]: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— None —</SelectItem>
                    {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CoaMappingPage;
