import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Users, Search, BookOpen } from "lucide-react";
import { createSupplierLedger, syncPartyOpeningToLedger } from "@/lib/party-ledger-utils";
import { validatePartyOpening } from "@/lib/party-opening-validation";
import { AccountLedgerDialog } from "@/components/accounts/AccountLedgerDialog";
import { AccountCombobox } from "@/components/accounts/AccountCombobox";
import { nextSupplierCode, findDuplicateSupplierCode, buildSupplierPayload } from "@/lib/supplier-utils";
import { useAccountBalances } from "@/hooks/useAccountBalances";

interface Supplier {
  id: string; code: string; name: string; supplier_type: string;
  contact_person?: string; phone?: string; email?: string;
  credit_limit?: number; credit_days?: number; currency?: string;
  is_active: boolean; payable_account_id?: string | null; branch_id?: string | null;
  vat_reg_no?: string; bin_no?: string; address?: string;
  opening_balance?: number | null;
  opening_balance_date?: string | null;
}

const SUPPLIER_TYPES = [
  { v: "local", l: "Local" },
  { v: "import", l: "Import" },
  { v: "service", l: "Service" },
  { v: "asset", l: "Asset" },
  { v: "utility", l: "Utility" },
];

const empty: Partial<Supplier> = { supplier_type: "local", currency: "BDT", is_active: true, credit_limit: 0, credit_days: 0, opening_balance: 0, opening_balance_date: null };

const SuppliersPage = () => {
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<Partial<Supplier>>(empty);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const [ledgerFor, setLedgerFor] = useState<Supplier | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const { accounts: accountsWithBal } = useAccountBalances();


  const load = async () => {
    setLoading(true);
    const [s, a, b] = await Promise.all([
      supabase.from("suppliers" as any).select("*").order("name"),
      supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, parent_id, account_type")
        .eq("is_active", true)
        .eq("account_type", "liability")
        .order("account_code"),
      supabase.from("branches").select("id,name").order("name"),
    ]);
    setItems((s.data || []) as any);
    // Restrict payable-account dropdown to descendants of "Accounts & Other Payable" (2210)
    const all = (a.data || []) as any[];
    const ap = all.find((x) => x.account_code === "2210");
    setAccounts(ap ? all.filter((x) => x.parent_id === ap.id) : all);
    setBranches(b.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Merge live signed balances into the payable-ledger picker options.
  const balanceMap = new Map(accountsWithBal.map((a) => [a.id, a]));
  const accountsForPicker = accounts.map((a) => {
    const bal = balanceMap.get(a.id);
    return { ...a, signed_balance: bal?.signed_balance, account_type: a.account_type || bal?.account_type };
  });

  const openCreate = () => { setEditing(null); setCodeError(null); setForm({ ...empty, code: nextSupplierCode(items) }); setOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setCodeError(null); setForm(s); setOpen(true); };


  const save = async () => {
    if (!form.code || !form.name) { toast({ title: "Code & Name required", variant: "destructive" }); return; }
    const dupId = findDuplicateSupplierCode(items, String(form.code), editing?.id);
    if (dupId) {
      setCodeError(`Code "${form.code}" is already used by another supplier.`);
      toast({ title: "Duplicate code", description: "Choose a unique supplier code.", variant: "destructive" });
      return;
    }
    setCodeError(null);
    const v = validatePartyOpening({ opening_balance: form.opening_balance ?? 0, opening_balance_date: form.opening_balance_date ?? null });
    if (!v.ok) { toast({ title: "Invalid opening balance", description: v.errors.join("; "), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload: any = buildSupplierPayload({
        ...form,
        opening_balance: v.value.opening_balance,
        opening_balance_date: v.value.opening_balance_date,
      });
      const prevActive = editing?.is_active;
      if (editing) {
        const { error } = await supabase.from("suppliers" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        if (!payload.payable_account_id) {
          const ledgerId = await createSupplierLedger(String(form.name).trim());
          if (ledgerId) payload.payable_account_id = ledgerId;
        }
        const { error } = await supabase.from("suppliers" as any).insert(payload);
        if (error) throw error;
      }
      await syncPartyOpeningToLedger(payload.payable_account_id, payload.opening_balance, "credit");
      // Status-aware confirmation toast so the user sees the saved active state.
      const statusChanged = editing && prevActive !== payload.is_active;
      const statusNote = statusChanged
        ? (payload.is_active ? "Supplier activated." : "Supplier deactivated.")
        : `Status: ${payload.is_active ? "Active" : "Inactive"}.`;
      const linkNote = !editing && payload.payable_account_id ? " Linked ledger under Accounts & Other Payable." : "";
      toast({ title: editing ? "Supplier updated" : "Supplier created", description: statusNote + linkNote });
      setOpen(false); load();
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };


  const remove = async (id: string) => {
    if (!confirm("Delete this supplier?")) return;
    const { error } = await supabase.from("suppliers" as any).delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); load(); }
  };

  const filtered = items.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Supplier Master</h1></div>
        <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" />New Supplier</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search by name or code…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead>
            <TableHead>Contact</TableHead><TableHead>Phone</TableHead>
            <TableHead className="text-right">Credit Limit</TableHead>
            <TableHead>Status</TableHead><TableHead className="w-24">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            : filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No suppliers</TableCell></TableRow>
            : filtered.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.code}</TableCell>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{s.supplier_type}</Badge></TableCell>
                <TableCell>{s.contact_person || "—"}</TableCell>
                <TableCell>{s.phone || "—"}</TableCell>
                <TableCell className="text-right">{(s.credit_limit || 0).toLocaleString()}</TableCell>
                <TableCell>{s.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title={s.payable_account_id ? "View accounting ledger" : "No linked ledger"}
                      disabled={!s.payable_account_id}
                      onClick={() => setLedgerFor(s)}
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(s.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Supplier" : "New Supplier"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Code *</Label><Input placeholder="Auto-generated (editable)" value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div className="space-y-1"><Label>Name *</Label><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Supplier Type</Label>
              <Select value={form.supplier_type} onValueChange={(v) => setForm({ ...form, supplier_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SUPPLIER_TYPES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Branch</Label>
              <Select value={form.branch_id || "_none"} onValueChange={(v) => setForm({ ...form, branch_id: v === "_none" ? null : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— None —</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Contact Person</Label><Input value={form.contact_person || ""} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-1"><Label>Email</Label><Input value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1"><Label>Currency</Label><Input value={form.currency || ""} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
            <div className="space-y-1"><Label>VAT Reg No</Label><Input value={form.vat_reg_no || ""} onChange={(e) => setForm({ ...form, vat_reg_no: e.target.value })} /></div>
            <div className="space-y-1"><Label>BIN No</Label><Input value={form.bin_no || ""} onChange={(e) => setForm({ ...form, bin_no: e.target.value })} /></div>
            <div className="space-y-1"><Label>Credit Limit</Label><Input type="number" value={form.credit_limit ?? 0} onChange={(e) => setForm({ ...form, credit_limit: parseFloat(e.target.value) || 0 })} /></div>
            <div className="space-y-1"><Label>Credit Days</Label><Input type="number" value={form.credit_days ?? 0} onChange={(e) => setForm({ ...form, credit_days: parseInt(e.target.value) || 0 })} /></div>
            <div className="space-y-1">
              <Label>Opening Balance</Label>
              <Input type="number" step="0.01" value={form.opening_balance ?? 0} onChange={(e) => setForm({ ...form, opening_balance: parseFloat(e.target.value) || 0 })} />
              <p className="text-[11px] text-muted-foreground">Positive = payable (Cr). Negative = advance paid to supplier.</p>
            </div>
            <div className="space-y-1">
              <Label>Opening Balance Date</Label>
              <Input type="date" value={form.opening_balance_date || ""} onChange={(e) => setForm({ ...form, opening_balance_date: e.target.value || null })} />
              <p className="text-[11px] text-muted-foreground">As-of date for the brought-forward balance.</p>
            </div>
            <div className="col-span-2 space-y-1"><Label>Address</Label><Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="col-span-2 space-y-1"><Label>Payable Ledger (under Accounts & Other Payable)</Label>
              <div className="flex items-center gap-2">
                <AccountCombobox
                  accounts={accounts as any}
                  value={form.payable_account_id || ""}
                  onChange={(id) => setForm({ ...form, payable_account_id: id || null })}
                  placeholder={editing ? "— Not linked —" : "Auto — create new ledger"}
                  className="flex-1"
                />
                {form.payable_account_id && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, payable_account_id: null })}>Clear</Button>
                )}
              </div>
              {!editing && <p className="text-xs text-muted-foreground">Search by code or name. Leave empty to auto-create a dedicated ledger under "Accounts & Other Payable".</p>}
            </div>

            <div className="col-span-2 flex items-center gap-2">
              <input id="active" type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              <Label htmlFor="active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AccountLedgerDialog
        accountId={ledgerFor?.payable_account_id || null}
        accountName={ledgerFor ? `${ledgerFor.name} (Payable)` : ""}
        openingBalance={Number(ledgerFor?.opening_balance) || 0}
        openingBalanceType="credit"
        open={!!ledgerFor}
        onOpenChange={(o) => { if (!o) setLedgerFor(null); }}
      />
    </div>
  );
};

export default SuppliersPage;
