import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { voucherApi } from "@/lib/voucher-api";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountCombobox } from "@/components/accounts/AccountCombobox";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeftRight, Loader2, CheckCircle2 } from "lucide-react";
import { toDateInputValue } from "@/lib/date-format";

interface Account { id: string; account_name: string; account_code: string; account_type?: string; }
interface Branch { id: string; name: string; }

export default function BranchFundTransferPage() {
  const { isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ from: string; to: string } | null>(null);

  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [description, setDescription] = useState("");

  useEffect(() => {
    (async () => {
      setLoadingSetup(true);
      const [accRes, brRes] = await Promise.all([voucherApi.listAccounts(), voucherApi.listBranches()]);
      setAccounts(((accRes as any).data || []) as Account[]);
      setBranches(((brRes as any).data || []) as Branch[]);
      setLoadingSetup(false);
    })();
  }, []);

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name || "";

  const canSubmit =
    fromBranchId && toBranchId && fromBranchId !== toBranchId &&
    fromAccountId && toAccountId && date &&
    Number(amount) > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await voucherApi.branchTransfer({
        from_branch_id: fromBranchId,
        to_branch_id: toBranchId,
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: Number(amount),
        voucher_date: date,
        description,
      });
      setResult({ from: res.from_voucher?.voucher_number, to: res.to_voucher?.voucher_number });
      toast({ title: "Transfer posted", description: `${res.from_voucher?.voucher_number} (${branchName(fromBranchId)}) + ${res.to_voucher?.voucher_number} (${branchName(toBranchId)})` });
      setFromAccountId("");
      setToAccountId("");
      setAmount("");
      setDescription("");
    } catch (e: any) {
      toast({ title: "Transfer failed", description: e?.message || "Something went wrong", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Moving funds between branches requires access to both branches — only a Super Admin can use this page.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-2">
        <ArrowLeftRight className="w-5 h-5" />
        <h1 className="text-2xl font-bold">Branch Fund Transfer</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Moves funds from one branch's account to another branch's account. Posts as two linked journal
        vouchers — one on each branch — through the Inter-Branch Clearing account, so each branch's own
        Account Ledger stays complete and self-contained.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Transfer Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Branch</Label>
              <Select value={fromBranchId} onValueChange={setFromBranchId} disabled={loadingSetup}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To Branch</Label>
              <Select value={toBranchId} onValueChange={setToBranchId} disabled={loadingSetup}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branches.filter((b) => b.id !== fromBranchId).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Source Account ({branchName(fromBranchId) || "From Branch"})</Label>
              <AccountCombobox accounts={accounts} value={fromAccountId} onChange={setFromAccountId} placeholder="e.g. HO Bank" />
            </div>
            <div className="space-y-2">
              <Label>Destination Account ({branchName(toBranchId) || "To Branch"})</Label>
              <AccountCombobox accounts={accounts} value={toAccountId} onChange={setToAccountId} placeholder="e.g. Factory Petty Cash" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <DateInput value={date} onChange={setDate} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Narration</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 2 months' petty cash fund" rows={2} />
          </div>

          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="w-full">
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowLeftRight className="w-4 h-4 mr-2" />}
            Post Transfer
          </Button>

          {result && (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-md p-3">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Posted: {result.from} ({branchName(fromBranchId)}) + {result.to} ({branchName(toBranchId)})</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
