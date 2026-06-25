import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logEditAudit } from "@/lib/audit-utils";
import { documentApi } from "@/lib/document-api";
import { createCustomerLedger, syncPartyOpeningToLedger } from "@/lib/party-ledger-utils";
import { validatePartyOpening } from "@/lib/party-opening-validation";
import { getDocumentStatusConfig } from "@/hooks/useDocumentRules";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Check, X, Lock, ShieldAlert, Eye } from "lucide-react";
import { SearchableAccountSelect } from "@/components/accounts/SearchableAccountSelect";
import { AccountCombobox } from "@/components/accounts/AccountCombobox";
import { nextSupplierCode, findDuplicateSupplierCode } from "@/lib/supplier-utils";
import { useAccountBalances } from "@/hooks/useAccountBalances";

interface Customer {
  id: string;
  code?: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  bin_number: string | null;
  status: string;
  receivable_account_id?: string | null;
  opening_balance?: number | null;
  opening_balance_date?: string | null;
}

const CustomersPage = () => {
  const navigate = useNavigate();
  const { user, profile, hasPermission, isSuperAdmin } = useAuth();
  const isAdmin = hasPermission("sales", "can_edit");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({ code: "", name: "", email: "", phone: "", address: "", bin_number: "", opening_balance: 0, opening_balance_date: "" });
  const [codeError, setCodeError] = useState<string | null>(null);
  const [parentAccountId, setParentAccountId] = useState<string>("");
  const [receivableLedgerId, setReceivableLedgerId] = useState<string>("");
  const [assetAccounts, setAssetAccounts] = useState<any[]>([]);
  const [receivableLedgers, setReceivableLedgers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { accounts: accountsWithBal } = useAccountBalances();

  const canEdit = hasPermission("sales", "can_edit") || isSuperAdmin;
  const canAdd = hasPermission("sales", "can_add") || isSuperAdmin;

  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<"approve" | "cancel" | null>(null);
  const [actionTarget, setActionTarget] = useState<Customer | null>(null);

  useEffect(() => { load(); loadAccounts(); }, []);

  const load = async () => {
    const { data } = await supabase.from("customers").select("*").order("name");
    setCustomers(data || []);
  };

  const loadAccounts = async () => {
    const { data } = await supabase
      .from("chart_of_accounts")
      .select("id, account_code, account_name, parent_id")
      .eq("account_type", "asset")
      .eq("is_active", true)
      .order("account_code");
    setAssetAccounts(data || []);
    // Receivable ledgers = direct/indirect children of "Accounts Receivable" (code 1240)
    const ar = (data || []).find((a: any) => a.account_code === "1240");
    if (ar) {
      const arDescendants = (data || []).filter((a: any) => a.parent_id === ar.id);
      setReceivableLedgers(arDescendants);
    } else {
      setReceivableLedgers([]);
    }
  };

  const nextCustomerCode = () => nextSupplierCode(customers as any, "CUS-", 4);

  const openCreate = () => {
    setEditingCustomer(null);
    setCodeError(null);
    setForm({ code: nextCustomerCode(), name: "", email: "", phone: "", address: "", bin_number: "", opening_balance: 0, opening_balance_date: "" });
    setParentAccountId("");
    setReceivableLedgerId("");
    setOpen(true);
  };

  const openEdit = (c: Customer) => {
    const isApproved = c.status === "approved";
    if (isApproved && !isSuperAdmin) {
      toast({ title: "Locked", description: "Only Super Admin can edit approved customers", variant: "destructive" });
      return;
    }
    if (c.status === "cancelled") {
      toast({ title: "Locked", description: "Cancelled records cannot be edited", variant: "destructive" });
      return;
    }
    setEditingCustomer(c);
    setCodeError(null);
    setForm({ code: c.code || "", name: c.name, email: c.email || "", phone: c.phone || "", address: c.address || "", bin_number: c.bin_number || "", opening_balance: Number(c.opening_balance ?? 0), opening_balance_date: c.opening_balance_date || "" });
    setReceivableLedgerId(c.receivable_account_id || "");
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    if (form.code) {
      const dup = findDuplicateSupplierCode(customers as any, form.code, editingCustomer?.id);
      if (dup) {
        setCodeError(`Code "${form.code}" is already used by another customer.`);
        toast({ title: "Duplicate code", description: "Choose a unique customer code.", variant: "destructive" });
        return;
      }
    }
    setCodeError(null);
    const v = validatePartyOpening({ opening_balance: form.opening_balance, opening_balance_date: form.opening_balance_date });
    if (!v.ok) { toast({ title: "Invalid opening balance", description: v.errors.join("; "), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const openingAmt = v.value.opening_balance;
      const openingDate = v.value.opening_balance_date;
      const codeVal = form.code?.trim() || null;
      if (editingCustomer) {
        const isApprovedEdit = editingCustomer.status === "approved";
        const baseFields = {
          code: codeVal,
          name: form.name, email: form.email || null, phone: form.phone || null,
          address: form.address || null, bin_number: form.bin_number || null,
          opening_balance: openingAmt, opening_balance_date: openingDate,
        };
        const newValues: any = { ...baseFields, receivable_account_id: receivableLedgerId || null };
        if (isApprovedEdit && isSuperAdmin) {
          await documentApi.editApproved("customer", editingCustomer.id, newValues);
        } else {
          const oldValues = { ...baseFields, receivable_account_id: editingCustomer.receivable_account_id ?? null,
            code: editingCustomer.code ?? null,
            name: editingCustomer.name, email: editingCustomer.email, phone: editingCustomer.phone, address: editingCustomer.address, bin_number: editingCustomer.bin_number,
            opening_balance: editingCustomer.opening_balance ?? 0, opening_balance_date: editingCustomer.opening_balance_date ?? null };
          const { error } = await supabase.from("customers").update(newValues).eq("id", editingCustomer.id);
          if (error) throw error;
          await logEditAudit({ userId: user?.id, userName: profile?.name, module: "Sales", action: "Edit Customer", recordId: editingCustomer.id, oldValues, newValues });
        }
        await syncPartyOpeningToLedger(receivableLedgerId || editingCustomer.receivable_account_id || null, openingAmt, "debit");
        toast({ title: "Customer updated" });
      } else {
        const { data: inserted, error } = await supabase.from("customers").insert({
          ...form,
          code: codeVal,
          opening_balance: openingAmt,
          opening_balance_date: openingDate,
          status: "active",
        } as any).select("id").single();
        if (error) throw error;
        const ledgerId = await createCustomerLedger(form.name.trim(), parentAccountId || undefined);
        if (ledgerId && inserted?.id) {
          await supabase.from("customers").update({ receivable_account_id: ledgerId } as any).eq("id", inserted.id);
          await syncPartyOpeningToLedger(ledgerId, openingAmt, "debit");
        }
        const parentName = parentAccountId ? assetAccounts.find((a) => a.id === parentAccountId)?.account_name : "Accounts Receivable";
        toast({ title: "Customer added", description: `Ledger created under ${parentName}` });
      }
      setOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  };



  const handleDocAction = async () => {
    if (!actionTarget || !actionType) return;
    setSaving(true);
    try {
      if (actionType === "approve") {
        await documentApi.approve("customer", actionTarget.id);
        toast({ title: `Customer ${actionTarget.name} approved` });
      } else if (actionType === "cancel") {
        await documentApi.cancel("customer", actionTarget.id);
        toast({ title: `Customer ${actionTarget.name} cancelled` });
      }
      setActionDialogOpen(false);
      setActionTarget(null);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const filtered = customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Customers</h1>
        {canAdd && <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" />Add Customer</Button>}
      </div>
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const statusCfg = getDocumentStatusConfig(c.status);
                const isLocked = c.status === "approved" && !isSuperAdmin;
                const isCancelled = c.status === "cancelled";
                return (
                  <TableRow key={c.id} className={isCancelled ? "opacity-60" : ""}>
                    <TableCell className="font-medium">
                      <button onClick={() => navigate(`/customers/${c.id}`)} className="text-primary hover:underline text-left">
                        {c.name}
                      </button>
                    </TableCell>
                    <TableCell>{c.email || "—"}</TableCell>
                    <TableCell>{c.phone || "—"}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.className}`}>
                        {statusCfg.label}
                      </span>
                    </TableCell>
                    <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/customers/${c.id}`)} title="View Profile">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        {(c.status === "active" || c.status === "draft") && (isAdmin || isSuperAdmin) && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600" onClick={() => { setActionTarget(c); setActionType("approve"); setActionDialogOpen(true); }} title="Approve">
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {!isCancelled && !isLocked && canEdit && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)} title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {isSuperAdmin && c.status === "approved" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600" onClick={() => openEdit(c)} title="Super Admin Edit">
                            <ShieldAlert className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {!isCancelled && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { setActionTarget(c); setActionType("cancel"); setActionDialogOpen(true); }} title="Cancel">
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No customers found</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCustomer ? "Edit Customer" : "New Customer"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label>BIN Number</Label><Input value={form.bin_number} onChange={(e) => setForm({ ...form, bin_number: e.target.value })} placeholder="e.g. 123456789-0101" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Opening Balance</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.opening_balance}
                  onChange={(e) => setForm({ ...form, opening_balance: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Positive = receivable (Dr). Negative = advance from customer.</p>
              </div>
              <div>
                <Label>Opening Balance Date</Label>
                <Input
                  type="date"
                  value={form.opening_balance_date}
                  onChange={(e) => setForm({ ...form, opening_balance_date: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground mt-1">As-of date for the brought-forward balance.</p>
              </div>
            </div>
            {!editingCustomer ? (
              <div>
                <Label>Parent Ledger (Chart of Accounts)</Label>
                <SearchableAccountSelect
                  accounts={assetAccounts}
                  value={parentAccountId || "__auto__"}
                  onChange={(v) => setParentAccountId(v === "__auto__" ? "" : v)}
                  allowAll
                  allLabel="Auto (Accounts Receivable)"
                  allValue="__auto__"
                  placeholder="Auto (Accounts Receivable)"
                />
                <p className="text-xs text-muted-foreground mt-1">A dedicated sub-ledger will be created under Accounts Receivable and linked to this customer.</p>
              </div>
            ) : (
              <div>
                <Label>Receivable Ledger</Label>
                <SearchableAccountSelect
                  accounts={receivableLedgers.length > 0 ? receivableLedgers : assetAccounts}
                  value={receivableLedgerId || "__none__"}
                  onChange={(v) => setReceivableLedgerId(v === "__none__" ? "" : v)}
                  allowAll
                  allLabel="— Not linked —"
                  allValue="__none__"
                  placeholder="Select receivable ledger"
                />
                <p className="text-xs text-muted-foreground mt-1">Change the ledger linked to this customer (under Accounts Receivable).</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : editingCustomer ? "Update" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <AlertDialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{actionType === "approve" ? "Approve Customer" : "Cancel Customer"}</AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === "approve"
                ? `Approve customer "${actionTarget?.name}"? This will lock editing for normal users.`
                : `Cancel customer "${actionTarget?.name}"? This record will be deactivated.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDocAction} disabled={saving}>
              {saving ? "Processing..." : actionType === "approve" ? "Approve" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CustomersPage;
