import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plus, BookOpen, Filter, Search, X } from "lucide-react";
import { useAccountBalances, AccountWithBalance } from "@/hooks/useAccountBalances";
import { useAuth } from "@/contexts/AuthContext";

import { AccountTreeTable } from "@/components/accounts/AccountTreeTable";
import { AccountLedgerDialog } from "@/components/accounts/AccountLedgerDialog";
import { SearchableAccountSelect } from "@/components/accounts/SearchableAccountSelect";

const ACCOUNT_TYPES = ["asset", "liability", "income", "expense", "equity"] as const;

const ChartOfAccounts = () => {
  const { toast } = useToast();
  const { isSuperAdmin } = useAuth();

  // Filters
  const [financialYears, setFinancialYears] = useState<{ id: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [filterFY, setFilterFY] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");

  const { accounts, loading, refetch } = useAccountBalances({
    financialYearId: filterFY || undefined,
    branchId: filterBranch || undefined,
    dateFrom: filterFrom || undefined,
    dateTo: filterTo || undefined,
  });

  // Form state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editAcc, setEditAcc] = useState<AccountWithBalance | null>(null);
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formType, setFormType] = useState<string>("asset");
  const [formParent, setFormParent] = useState<string>("");
  const [formOpeningBalance, setFormOpeningBalance] = useState<string>("0");
  const [formOpeningBalanceType, setFormOpeningBalanceType] = useState<"debit" | "credit">("debit");
  const [saving, setSaving] = useState(false);

  // Ledger dialog
  const [ledgerAccount, setLedgerAccount] = useState<AccountWithBalance | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("financial_years").select("id, name").order("start_date", { ascending: false }),
      supabase.from("branches").select("id, name").eq("status", "active"),
    ]).then(([fyRes, brRes]) => {
      setFinancialYears((fyRes.data || []) as any[]);
      setBranches((brRes.data || []) as any[]);
    });
  }, []);

  const openCreate = () => {
    setEditAcc(null);
    setFormName(""); setFormCode(""); setFormType("asset"); setFormParent("");
    setDialogOpen(true);
  };

  const openEdit = (a: AccountWithBalance) => {
    setEditAcc(a);
    setFormName(a.account_name); setFormCode(a.account_code); setFormType(a.account_type);
    setFormParent(a.parent_id || "");
    setDialogOpen(true);
  };

  const handleDelete = async (a: AccountWithBalance) => {
    // Block delete when account has children
    const hasChildren = accounts.some((x) => x.parent_id === a.id);
    if (hasChildren) {
      toast({ title: "Cannot delete", description: "Account has child accounts. Delete or reassign them first.", variant: "destructive" });
      return;
    }
    // Block delete when account has voucher entries (DB FK is RESTRICT)
    const { count, error: cntErr } = await supabase
      .from("voucher_entries")
      .select("id", { count: "exact", head: true })
      .eq("account_id", a.id);
    if (cntErr) {
      toast({ title: "Error", description: cntErr.message, variant: "destructive" });
      return;
    }
    if ((count || 0) > 0) {
      toast({ title: "Cannot delete", description: `Account "${a.account_name}" has ${count} voucher entries. Reverse / delete those vouchers first.`, variant: "destructive" });
      return;
    }
    if (!confirm(`Delete account "${a.account_code} — ${a.account_name}"?\n\nIts IFRS mapping will also be removed.`)) return;
    try {
      // ifrs_account_mapping cascades via FK, but remove explicitly to be safe
      await supabase.from("ifrs_account_mapping").delete().eq("account_id", a.id);
      const { error } = await supabase.from("chart_of_accounts").delete().eq("id", a.id);
      if (error) throw error;
      toast({ title: "Account deleted" });
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };


  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const keep = new Set<string>();
    accounts.forEach((a) => {
      if (a.account_name.toLowerCase().includes(q) || a.account_code.toLowerCase().includes(q)) {
        let cur: AccountWithBalance | undefined = a;
        while (cur) {
          keep.add(cur.id);
          cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
        }
      }
    });
    return accounts.filter((a) => keep.has(a.id));
  }, [accounts, search]);

  const handleSave = async () => {
    const name = formName.trim();
    const code = formCode.trim();
    if (!name || !code) {
      toast({ title: "Validation", description: "Account name and code are required.", variant: "destructive" });
      return;
    }
    // Enforce 4-digit numeric code (Bangladesh CoA standard)
    if (!/^\d{4}$/.test(code)) {
      toast({ title: "Invalid code", description: "Account code must be exactly 4 digits (e.g. 1201).", variant: "destructive" });
      return;
    }
    // Prevent duplicates (DB has unique constraint, but catch early)
    const dup = accounts.find((a) => a.account_code === code && a.id !== editAcc?.id);
    if (dup) {
      toast({ title: "Duplicate code", description: `Code ${code} already used by "${dup.account_name}".`, variant: "destructive" });
      return;
    }
    // Prevent self/cyclic parent
    if (formParent && editAcc && formParent === editAcc.id) {
      toast({ title: "Invalid parent", description: "An account cannot be its own parent.", variant: "destructive" });
      return;
    }
    // Parent type must match (a 4-digit "1xxx" account belongs under an asset parent, etc.)
    if (formParent) {
      const parent = accounts.find((a) => a.id === formParent);
      if (parent && parent.account_type !== formType) {
        toast({
          title: "Parent type mismatch",
          description: `Parent "${parent.account_name}" is ${parent.account_type}; child must share the same type.`,
          variant: "destructive",
        });
        return;
      }
    }

    setSaving(true);
    try {
      const payload: any = {
        account_name: name,
        account_code: code,
        account_type: formType,
        parent_id: formParent || null,
        updated_at: new Date().toISOString(),
      };

      // Ledger opening balances are kept at zero; historical balances must be posted by voucher.
      payload.opening_balance = 0;
      payload.opening_balance_type = "debit";

      if (editAcc) {
        const { error } = await supabase.from("chart_of_accounts").update(payload).eq("id", editAcc.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("chart_of_accounts").insert(payload);
        if (error) throw error;
      }
      toast({ title: editAcc ? "Account updated" : "Account created" });
      setDialogOpen(false);
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Chart of Accounts</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="w-4 h-4 mr-1" />{showFilters ? "Hide Filters" : "Filters"}
          </Button>
          <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1" />Add Account</Button>
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="py-3 flex flex-wrap gap-4 items-end">
            <div className="space-y-1 w-48">
              <Label className="text-xs">Financial Year</Label>
              <Select value={filterFY || "__all__"} onValueChange={(v) => setFilterFY(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Years</SelectItem>
                  {financialYears.map((fy) => <SelectItem key={fy.id} value={fy.id}>{fy.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-48">
              <Label className="text-xs">Branch</Label>
              <Select value={filterBranch || "__all__"} onValueChange={(v) => setFilterBranch(v === "__all__" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Branches</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="w-40" />
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setFilterFY(""); setFilterBranch(""); setFilterFrom(""); setFilterTo(""); }}>
              Clear
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="p-3 border-b flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or code (e.g. 1201, Marico, Bank)..."
                className="pl-8 pr-8 h-9"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {filteredAccounts.length} of {accounts.length} accounts
            </span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading accounts...</div>
          ) : (
            <AccountTreeTable accounts={filteredAccounts} onEdit={openEdit} onDrillDown={(a) => setLedgerAccount(a)} onDelete={handleDelete} />
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editAcc ? "Edit Account" : "Create Account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Account Name</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Cash in Hand" /></div>
              <div className="space-y-2"><Label>Account Code</Label><Input value={formCode} onChange={(e) => setFormCode(e.target.value)} placeholder="1001" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Account Type</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Parent Account</Label>
                <SearchableAccountSelect
                  accounts={accounts.filter((a) => a.id !== editAcc?.id)}
                  value={formParent || "__none__"}
                  onChange={(v) => setFormParent(v === "__none__" ? "" : v)}
                  allowAll
                  allLabel="None (root level)"
                  allValue="__none__"
                  placeholder="None (root level)"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
              Opening balance is fixed at 0. Post any historical balance through an opening journal voucher.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ledger Drill-Down Dialog */}
      <AccountLedgerDialog
        accountId={ledgerAccount?.id || null}
        accountName={ledgerAccount?.account_name || ""}
        openingBalance={ledgerAccount?.opening_balance || 0}
        openingBalanceType={ledgerAccount?.opening_balance_type || "debit"}
        open={!!ledgerAccount}
        onOpenChange={(open) => { if (!open) setLedgerAccount(null); }}
      />
    </div>
  );
};

export default ChartOfAccounts;
