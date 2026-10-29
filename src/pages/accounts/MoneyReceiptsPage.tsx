import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { moneyReceiptApi, type MoneyReceipt } from "@/lib/money-receipt-api";
import { voucherApi } from "@/lib/voucher-api";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Settings, Receipt } from "lucide-react";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { ListPagination } from "@/components/sales-workflow/ListPagination";
import { ReceiptVoucherCombobox, type ReceiptVoucherOption } from "@/components/accounts/ReceiptVoucherCombobox";
import { CustomerCombobox, type CustomerOption } from "@/components/accounts/CustomerCombobox";
import { AccountCombobox, type AccountOption } from "@/components/accounts/AccountCombobox";
import { MoneyReceiptPrintButton } from "@/components/accounts/MoneyReceiptPrint";

const PAYMENT_MODE_LABEL: Record<string, string> = { cash: "Cash", cheque: "Cheque", po: "P.O", dd: "D.D." };

function formatDate(d: string): string {
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const emptyForm = {
  id: "" as string | null,
  receipt_voucher_id: null as string | null,
  customer_id: null as string | null,
  received_from: "",
  address: "",
  on_account_of: "",
  on_account_ledger_id: null as string | null,
  payment_mode: "cash",
  payment_ref_no: "",
  receipt_date: new Date().toISOString().slice(0, 10),
  against_bill_no: "",
  against_bill_date: "",
  amount: "",
};

export default function MoneyReceiptsPage() {
  const { hasPermission, isSuperAdmin } = useAuth();
  const { settings: companySettings } = useCompanySettings();
  const { toast } = useToast();

  const canView = isSuperAdmin || hasPermission("money_receipt.view");
  const canCreate = isSuperAdmin || hasPermission("money_receipt.create");
  const canEdit = isSuperAdmin || hasPermission("money_receipt.edit");
  const canDelete = isSuperAdmin || hasPermission("money_receipt.delete");

  const [rows, setRows] = useState<MoneyReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { paged, page, setPage, pageSize, setPageSize, totalPages, total } = usePagedRows(rows);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [receiptVouchers, setReceiptVouchers] = useState<ReceiptVoucherOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastNumberInput, setLastNumberInput] = useState("0");
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await moneyReceiptApi.list({ search: search || undefined, per_page: 500 });
      setRows(data);
    } catch (err: any) {
      toast({ title: "Error loading money receipts", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [search, toast]);

  useEffect(() => { load(); }, [load]);

  // Static pickers (customers + chart of accounts) — loaded once per dialog
  // open. "Link Receipt Voucher" is deliberately NOT here: it's scoped to
  // whichever customer is selected, loaded separately below.
  const loadStaticPickerData = async () => {
    try {
      const [custRes, acctRes] = await Promise.all([
        // Only customers with a ledger (receivable_account_id) assigned —
        // that ledger is what "Link Receipt Voucher" filters against, so a
        // customer without one can never resolve any RVs there.
        supabase.from("customers").select("id,name,address").is("receivable_account_id", "notnull").order("name"),
        voucherApi.listAccounts(),
      ]);
      setCustomers(((custRes.data || []) as any[]).map((c) => ({ id: c.id, name: c.name, address: c.address })));
      setAccounts(((acctRes.data || []) as any[]).map((a) => ({ id: a.id, account_code: a.account_code, account_name: a.account_name })));
    } catch {
      /* pickers are best-effort; form still works with manual entry disabled gracefully */
    }
  };

  const loadReceiptVouchersForCustomer = async (customerId: string | null) => {
    if (!customerId) { setReceiptVouchers([]); return; }
    try {
      const vouchers = await moneyReceiptApi.receiptVouchersForCustomer(customerId);
      setReceiptVouchers(vouchers.map((v) => ({ id: v.id, voucher_number: v.voucher_number, voucher_date: v.voucher_date, total_amount: Number(v.total_amount) })));
    } catch {
      setReceiptVouchers([]);
    }
  };

  const openCreate = () => {
    setForm(emptyForm);
    setReceiptVouchers([]);
    setDialogOpen(true);
    loadStaticPickerData();
  };

  const openEdit = (r: MoneyReceipt) => {
    setForm({
      id: r.id,
      receipt_voucher_id: r.receipt_voucher_id,
      customer_id: r.customer_id,
      received_from: r.received_from,
      address: r.address || "",
      on_account_of: r.on_account_of || "",
      on_account_ledger_id: r.on_account_ledger_id,
      payment_mode: r.payment_mode,
      payment_ref_no: r.payment_ref_no || "",
      receipt_date: r.receipt_date,
      against_bill_no: r.against_bill_no || "",
      against_bill_date: r.against_bill_date || "",
      amount: String(r.amount),
    });
    setDialogOpen(true);
    loadStaticPickerData();
    loadReceiptVouchersForCustomer(r.customer_id);
  };

  const handleSelectVoucher = async (id: string | null) => {
    setForm((f) => ({ ...f, receipt_voucher_id: id }));
    if (!id) return;
    try {
      const { voucher } = await voucherApi.get(id);
      setForm((f) => ({
        ...f,
        amount: String(voucher.total_amount ?? f.amount),
        receipt_date: voucher.voucher_date || f.receipt_date,
      }));
    } catch { /* auto-fill is best-effort */ }
  };

  const handleSelectCustomer = (id: string | null, customer: CustomerOption | null) => {
    setForm((f) => ({
      ...f,
      customer_id: id,
      received_from: customer?.name || f.received_from,
      address: customer ? (customer.address || "") : f.address,
      // A different customer means the previously linked RV (scoped to the
      // old customer's ledger) no longer applies.
      receipt_voucher_id: null,
    }));
    loadReceiptVouchersForCustomer(id);
  };

  const handleSave = async () => {
    if (!form.received_from.trim()) return toast({ title: "Select who the receipt is from", variant: "destructive" });
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return toast({ title: "Enter a valid amount", variant: "destructive" });
    if (!form.receipt_voucher_id && !form.on_account_ledger_id) {
      return toast({ title: "Select an On account of ledger", description: "Required so a Receipt Voucher can be auto-created — or link an existing one instead.", variant: "destructive" });
    }

    setSaving(true);
    try {
      const payload = {
        receipt_voucher_id: form.receipt_voucher_id,
        customer_id: form.customer_id,
        received_from: form.received_from.trim(),
        address: form.address.trim() || null,
        on_account_of: form.on_account_of.trim() || null,
        on_account_ledger_id: form.on_account_ledger_id,
        payment_mode: form.payment_mode as any,
        payment_ref_no: form.payment_ref_no.trim() || null,
        receipt_date: form.receipt_date,
        against_bill_no: form.against_bill_no.trim() || null,
        against_bill_date: form.against_bill_date || null,
        amount,
      };
      if (form.id) {
        await moneyReceiptApi.update(form.id, payload);
        toast({ title: "Money receipt updated" });
      } else {
        await moneyReceiptApi.create(payload);
        toast({ title: "Money receipt created" });
      }
      setDialogOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: MoneyReceipt) => {
    if (!confirm(`Delete Money Receipt No. ${r.receipt_no}?`)) return;
    try {
      await moneyReceiptApi.remove(r.id);
      toast({ title: "Money receipt deleted" });
      load();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
    }
  };

  const openSettings = async () => {
    try {
      const s = await moneyReceiptApi.getSettings();
      setLastNumberInput(String(s.last_number));
      setSettingsOpen(true);
    } catch (err: any) {
      toast({ title: "Could not load settings", description: err?.message, variant: "destructive" });
    }
  };

  const saveSettings = async () => {
    const n = Number(lastNumberInput);
    if (isNaN(n) || n < 0) return toast({ title: "Enter a valid number", variant: "destructive" });
    setSavingSettings(true);
    try {
      const s = await moneyReceiptApi.updateSettings(n);
      toast({ title: "Settings saved", description: `Next receipt will be No. ${s.next_number}` });
      setSettingsOpen(false);
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  if (!canView) {
    return <div className="p-6 text-center text-muted-foreground py-12">You do not have permission to view Money Receipts.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Receipt className="w-6 h-6" />Money Receipt</h1>
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="outline" onClick={openSettings}><Settings className="w-4 h-4 mr-2" />Settings</Button>
          )}
          {canCreate && (
            <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />New Money Receipt</Button>
          )}
        </div>
      </div>

      <Card className="p-4">
        <Input placeholder="Search by receipt no, received from, bill no..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Received From</TableHead>
              <TableHead>On Account Of</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Linked RV</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono font-medium">{r.receipt_no}</TableCell>
                <TableCell>{formatDate(r.receipt_date)}</TableCell>
                <TableCell>{r.received_from}</TableCell>
                <TableCell className="max-w-xs truncate">{r.on_account_of}</TableCell>
                <TableCell><Badge variant="secondary">{PAYMENT_MODE_LABEL[r.payment_mode] || r.payment_mode}</Badge></TableCell>
                <TableCell>{r.receipt_voucher?.voucher_number || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(r.amount).toFixed(2)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <MoneyReceiptPrintButton receipt={r} companySettings={companySettings} />
                  {canEdit && (
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)} title="Edit"><Pencil className="w-4 h-4" /></Button>
                  )}
                  {canDelete && (
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => handleDelete(r)} title="Delete"><Trash2 className="w-4 h-4" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No money receipts yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <ListPagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Money Receipt" : "New Money Receipt"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Received with thanks from *</Label>
              <CustomerCombobox customers={customers} value={form.customer_id} onChange={handleSelectCustomer} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Address</Label>
              <Textarea rows={2} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Link Receipt Voucher</Label>
              <ReceiptVoucherCombobox
                vouchers={receiptVouchers}
                value={form.receipt_voucher_id}
                onChange={handleSelectVoucher}
                placeholder={form.customer_id ? "Link a Receipt Voucher (optional)" : "Select a customer first"}
              />
              {!form.receipt_voucher_id && (
                <p className="text-xs text-muted-foreground mt-1">
                  Left empty, a new Receipt Voucher will be auto-created using the ledger picked below.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">On account of (ledger credited){!form.receipt_voucher_id && " *"}</Label>
              <AccountCombobox
                accounts={accounts}
                value={form.on_account_ledger_id || ""}
                onChange={(id) => {
                  const acc = accounts.find((a) => a.id === id);
                  setForm((f) => ({ ...f, on_account_ledger_id: id, on_account_of: acc?.account_name || f.on_account_of }));
                }}
                placeholder="Select ledger..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Payment Mode</Label>
                <Select value={form.payment_mode} onValueChange={(v) => setForm((f) => ({ ...f, payment_mode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque No.</SelectItem>
                    <SelectItem value="po">P.O</SelectItem>
                    <SelectItem value="dd">D.D.</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.payment_mode !== "cash" && (
                <div>
                  <Label className="text-xs text-muted-foreground">Reference No.</Label>
                  <Input value={form.payment_ref_no} onChange={(e) => setForm((f) => ({ ...f, payment_ref_no: e.target.value }))} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Dated</Label>
                <DateInput value={form.receipt_date} onChange={(v) => setForm((f) => ({ ...f, receipt_date: v }))} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Against Bill No.</Label>
                <Input value={form.against_bill_no} onChange={(e) => setForm((f) => ({ ...f, against_bill_no: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Bill Date</Label>
              <DateInput value={form.against_bill_date} onChange={(v) => setForm((f) => ({ ...f, against_bill_date: v }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Tk. (Amount) *</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Money Receipt Numbering</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Set the last number already used (e.g. on your physical receipt book). The next receipt issued will continue from there.
            </p>
            <div>
              <Label className="text-xs text-muted-foreground">Last Number Used</Label>
              <Input type="number" min="0" value={lastNumberInput} onChange={(e) => setLastNumberInput(e.target.value)} />
            </div>
            <p className="text-sm">
              Next receipt will be No.{" "}
              <span className="font-mono font-semibold">
                {String((Number(lastNumberInput) || 0) + 1).padStart(3, "0")}
              </span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button onClick={saveSettings} disabled={savingSettings}>{savingSettings ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
