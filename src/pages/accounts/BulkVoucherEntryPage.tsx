import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { voucherApi } from "@/lib/voucher-api";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountCombobox } from "@/components/accounts/AccountCombobox";
import { useToast } from "@/hooks/use-toast";
import { Layers, Plus, Trash2, ClipboardPaste, Loader2, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { evaluateVoucherPermission, type VoucherType } from "@/lib/voucher-permissions";
import { validateEntryNature } from "@/lib/account-nature";
import { logAudit } from "@/lib/audit-utils";
import { cn } from "@/lib/utils";

const VOUCHER_TYPES = [
  { id: "journal", label: "Journal Voucher", prefix: "JV" },
  { id: "payment", label: "Payment Voucher", prefix: "PV" },
  { id: "receipt", label: "Receipt Voucher", prefix: "RV" },
  { id: "contra", label: "Contra Voucher", prefix: "CV" },
];

interface Account { id: string; account_name: string; account_code: string; account_type?: string; }
interface Branch { id: string; name: string; }
interface FinYear { id: string; name: string; start_date?: string; end_date?: string; is_active?: boolean | number; }

interface Row {
  id: string;
  date: string;
  narration: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
}

type RowStatus = "success" | "error";
interface RowResult { rowId: string; status: RowStatus; message?: string; voucherNumber?: string; }

const genId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

const makeRow = (defaults: { date?: string; debitAccountId?: string; creditAccountId?: string } = {}): Row => ({
  id: genId(),
  date: defaults.date || "",
  narration: "",
  debitAccountId: defaults.debitAccountId || "",
  creditAccountId: defaults.creditAccountId || "",
  amount: "",
});

/**
 * Safe arithmetic evaluator for quick-sum entry like "=120+90+50+30" — typed
 * in Narration to auto-fill Amount with the total, or typed in Amount itself
 * to replace it with the computed sum on blur/Tab. Small recursive-descent
 * parser (+ - * / and parens, no eval/Function) so this never executes
 * arbitrary code regardless of what's typed.
 */
function evalArithmeticExpr(input: string): number | null {
  const expr = input.trim().replace(/^=/, "").trim();
  if (!expr) return null;
  if (!/^[\d+\-*/.() \s]+$/.test(expr)) return null;

  let i = 0;
  const peek = () => expr[i];
  const isDigit = (c: string | undefined) => !!c && /[\d.]/.test(c);

  const parseNumber = (): number => {
    const start = i;
    while (isDigit(peek())) i++;
    const numStr = expr.slice(start, i);
    if (!numStr || numStr === ".") throw new Error("bad number");
    return parseFloat(numStr);
  };

  const parseFactor = (): number => {
    while (peek() === " ") i++;
    if (peek() === "(") {
      i++;
      const val = parseExpr();
      while (peek() === " ") i++;
      if (peek() !== ")") throw new Error("expected )");
      i++;
      return val;
    }
    if (peek() === "-") { i++; return -parseFactor(); }
    if (peek() === "+") { i++; return parseFactor(); }
    return parseNumber();
  };

  const parseTerm = (): number => {
    let val = parseFactor();
    for (;;) {
      while (peek() === " ") i++;
      if (peek() === "*") { i++; val *= parseFactor(); }
      else if (peek() === "/") { i++; const d = parseFactor(); if (d === 0) throw new Error("div by zero"); val /= d; }
      else break;
    }
    return val;
  };

  function parseExpr(): number {
    let val = parseTerm();
    for (;;) {
      while (peek() === " ") i++;
      if (peek() === "+") { i++; val += parseTerm(); }
      else if (peek() === "-") { i++; val -= parseTerm(); }
      else break;
    }
    return val;
  }

  try {
    const result = parseExpr();
    while (peek() === " ") i++;
    if (i !== expr.length) return null; // leftover characters → invalid expression
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

/** Accepts YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY; returns ISO or "" if unparseable. */
function parsePastedDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

export default function BulkVoucherEntryPage() {
  const { user, isSuperAdmin, hasPermission } = useAuth();
  const { toast } = useToast();

  const [voucherType, setVoucherType] = useState("payment");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [finYears, setFinYears] = useState<FinYear[]>([]);
  const [loadingSetup, setLoadingSetup] = useState(true);

  const [defaultBranch, setDefaultBranch] = useState("");
  const [defaultDebit, setDefaultDebit] = useState("");
  const [defaultCredit, setDefaultCredit] = useState("");

  const [rows, setRows] = useState<Row[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, RowResult>>({});

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const permCtx = { isSuperAdmin, hasPermission };
  const canCreateForType = (type: string) => evaluateVoucherPermission(permCtx, type as VoucherType, "create").allowed;
  const creatableTypes = VOUCHER_TYPES.filter((t) => canCreateForType(t.id));

  useEffect(() => {
    (async () => {
      setLoadingSetup(true);
      const [accRes, brRes, fyRes] = await Promise.all([
        voucherApi.listAccounts(),
        voucherApi.listBranches(),
        voucherApi.listFinancialYears(),
      ]);
      setAccounts(((accRes as any).data || []) as Account[]);
      setBranches(((brRes as any).data || []) as Branch[]);
      setFinYears(((fyRes as any).data || []) as FinYear[]);
      setLoadingSetup(false);
    })();
  }, []);

  useEffect(() => {
    if (creatableTypes.length && !creatableTypes.some((t) => t.id === voucherType)) {
      setVoucherType(creatableTypes[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatableTypes.length]);

  const matchingFinYearForDate = useCallback((isoDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return undefined;
    return finYears.find((fy) => fy.is_active && fy.start_date && fy.end_date && fy.start_date <= isoDate && fy.end_date >= isoDate);
  }, [finYears]);

  const findAccountByCodeOrName = (text: string): Account | undefined => {
    const t = text.trim().toLowerCase();
    if (!t) return undefined;
    return (
      accounts.find((a) => a.account_code.toLowerCase() === t) ||
      accounts.find((a) => a.account_name.toLowerCase() === t) ||
      accounts.find((a) => a.account_name.toLowerCase().includes(t))
    );
  };

  const addRow = () => {
    setRows((prev) => [...prev, makeRow({ date: prev[prev.length - 1]?.date, debitAccountId: defaultDebit, creditAccountId: defaultCredit })]);
  };
  const addRows = (n: number) => {
    setRows((prev) => [...prev, ...Array.from({ length: n }, () => makeRow({ debitAccountId: defaultDebit, creditAccountId: defaultCredit }))]);
  };
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setRowErrors((prev) => { const { [id]: _drop, ...rest } = prev; return rest; });
  };
  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const clearAll = () => { setRows([]); setRowErrors({}); setResults({}); };

  /** Narration like "=120+90+50+30" — on blur, auto-fills this row's Amount with the sum. */
  const handleNarrationBlur = (id: string, value: string) => {
    if (!value.trim().startsWith("=")) return;
    const sum = evalArithmeticExpr(value);
    if (sum == null) return;
    updateRow(id, { amount: String(Math.round(sum * 100) / 100) });
  };

  /** Amount typed as "=120+90+50+30" — on blur/Tab, replaces the field with the computed sum. */
  const handleAmountBlur = (id: string, value: string) => {
    if (!value.trim().startsWith("=")) return;
    const sum = evalArithmeticExpr(value);
    if (sum == null) return;
    updateRow(id, { amount: String(Math.round(sum * 100) / 100) });
  };

  const parsePasteText = () => {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const parsed: Row[] = [];
    const issues: string[] = [];

    for (const line of lines) {
      const parts = line.split("\t").map((p) => p.trim());
      let date = "", narration = "", debitId = defaultDebit, creditId = defaultCredit, amountStr = "";

      if (parts.length >= 5) {
        // Full: Date  Narration  Debit Account  Credit Account  Amount
        date = parsePastedDate(parts[0]);
        narration = parts[1];
        const dAcc = findAccountByCodeOrName(parts[2]);
        const cAcc = findAccountByCodeOrName(parts[3]);
        if (parts[2] && !dAcc) issues.push(`Debit account not found: "${parts[2]}"`);
        if (parts[3] && !cAcc) issues.push(`Credit account not found: "${parts[3]}"`);
        debitId = dAcc?.id || "";
        creditId = cAcc?.id || "";
        amountStr = parts[4];
      } else if (parts.length >= 3) {
        // Simple: Date  Narration  Amount (uses default accounts)
        date = parsePastedDate(parts[0]);
        narration = parts[1];
        amountStr = parts[2];
      } else if (parts.length === 2) {
        date = parsePastedDate(parts[0]);
        amountStr = parts[1];
      } else {
        continue;
      }

      if (!date) issues.push(`Could not read a date from: "${line}"`);
      parsed.push({
        id: genId(),
        date,
        narration,
        debitAccountId: debitId,
        creditAccountId: creditId,
        amount: amountStr.replace(/[,৳$\s]/g, ""),
      });
    }

    setRows((prev) => [...prev, ...parsed]);
    setPasteText("");
    setPasteOpen(false);
    if (issues.length > 0) {
      toast({
        title: `${parsed.length} row(s) added — ${issues.length} need attention`,
        description: issues.slice(0, 5).join("\n") + (issues.length > 5 ? `\n…and ${issues.length - 5} more` : ""),
        variant: "destructive",
      });
    } else {
      toast({ title: `${parsed.length} row(s) added from paste` });
    }
  };

  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const validateRows = (rowsToCheck: Row[] = rows): Record<string, string> => {
    const errs: Record<string, string> = {};
    for (const r of rowsToCheck) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) { errs[r.id] = "Invalid date"; continue; }
      if (!r.debitAccountId || !r.creditAccountId) { errs[r.id] = "Select both debit and credit accounts"; continue; }
      if (r.debitAccountId === r.creditAccountId) { errs[r.id] = "Debit and credit account must differ"; continue; }
      const amt = Number(r.amount);
      if (!(amt > 0)) { errs[r.id] = "Amount must be greater than 0"; continue; }
    }
    return errs;
  };

  const voucherTypeLabel = VOUCHER_TYPES.find((t) => t.id === voucherType)?.label || "Voucher";

  const handleSubmit = async (submitForApproval: boolean) => {
    if (rows.length === 0) { toast({ title: "Add at least one row first", variant: "destructive" }); return; }

    // Safety net: resolve any "=expr" left in Amount (e.g. from a pasted row
    // whose blur never fired) before validating/submitting. Built into a
    // local array first — setRows() is async, so the rest of this function
    // uses `resolvedRows` throughout rather than the (still-stale) `rows`
    // state closure.
    const resolvedRows = rows.map((r) => {
      if (!r.amount.trim().startsWith("=")) return r;
      const sum = evalArithmeticExpr(r.amount);
      return sum == null ? r : { ...r, amount: String(Math.round(sum * 100) / 100) };
    });
    setRows(resolvedRows);

    const errs = validateRows(resolvedRows);
    setRowErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast({ title: "Fix the highlighted rows before submitting", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    setResults({});
    setProgress({ done: 0, total: resolvedRows.length });

    const finalResults: RowResult[] = [];
    for (const row of resolvedRows) {
      const fy = matchingFinYearForDate(row.date);
      const debitAcc = accounts.find((a) => a.id === row.debitAccountId);
      const creditAcc = accounts.find((a) => a.id === row.creditAccountId);
      const amount = Number(row.amount);

      const nature = validateEntryNature(
        [
          { account_id: row.debitAccountId, dr_cr: "dr", debit: amount, credit: 0 },
          { account_id: row.creditAccountId, dr_cr: "cr", debit: 0, credit: amount },
        ],
        accounts.map((a) => ({ id: a.id, account_code: a.account_code, account_name: a.account_name, account_type: a.account_type })),
      );
      if (nature.errors.length > 0) {
        const res: RowResult = { rowId: row.id, status: "error", message: nature.errors[0].message };
        finalResults.push(res);
        setResults((prev) => ({ ...prev, [row.id]: res }));
        setProgress((p) => ({ ...p, done: p.done + 1 }));
        continue;
      }

      try {
        const { voucher } = await voucherApi.create({
          voucher_type: voucherType,
          voucher_date: row.date,
          branch_id: defaultBranch || undefined,
          financial_year_id: fy?.id || undefined,
          description: row.narration || `${voucherTypeLabel} — bulk entry`,
          entries: [
            { account_id: row.debitAccountId, debit: amount, credit: 0, narration: row.narration },
            { account_id: row.creditAccountId, debit: 0, credit: amount, narration: row.narration },
          ],
          submit: submitForApproval,
        });
        const res: RowResult = { rowId: row.id, status: "success", voucherNumber: voucher?.voucher_number };
        finalResults.push(res);
        setResults((prev) => ({ ...prev, [row.id]: res }));

        try {
          await logAudit({
            userId: user?.id,
            module: "accounting",
            action: "voucher_bulk_create",
            recordId: voucher?.id,
            newData: {
              voucher_type: voucherType,
              voucher_date: row.date,
              debit_account: debitAcc?.account_name,
              credit_account: creditAcc?.account_name,
              amount,
            },
          });
        } catch {
          // Audit-log failures must never block voucher save.
        }
      } catch (err: any) {
        const res: RowResult = { rowId: row.id, status: "error", message: err?.message || "Failed to create voucher" };
        finalResults.push(res);
        setResults((prev) => ({ ...prev, [row.id]: res }));
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setSubmitting(false);
    const successCount = finalResults.filter((r) => r.status === "success").length;
    const failCount = finalResults.length - successCount;
    toast({
      title: `${successCount} voucher(s) created${failCount ? `, ${failCount} failed` : ""}`,
      variant: failCount ? "destructive" : undefined,
    });

    if (failCount === 0) {
      setRows([]);
      setResults({});
    } else {
      const failedIds = new Set(finalResults.filter((r) => r.status === "error").map((r) => r.rowId));
      setRows((prev) => prev.filter((r) => failedIds.has(r.id)));
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Bulk Voucher Entry</h1>
          <p className="text-sm text-muted-foreground">Create many vouchers — same or different dates and ledgers — in one go.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Setup</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Voucher Type</Label>
            <Select value={voucherType} onValueChange={setVoucherType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {creatableTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <Select value={defaultBranch} onValueChange={setDefaultBranch}>
              <SelectTrigger><SelectValue placeholder="All / none" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Default Debit Account</Label>
            <AccountCombobox accounts={accounts} value={defaultDebit} onChange={setDefaultDebit} placeholder="Select debit account" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Default Credit Account</Label>
            <AccountCombobox accounts={accounts} value={defaultCredit} onChange={setDefaultCredit} placeholder="Select credit account" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm">Entries ({rows.length})</CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={addRow}><Plus className="w-4 h-4 mr-1" />Add Row</Button>
            <Button size="sm" variant="outline" onClick={() => addRows(10)}>+10 Rows</Button>
            <Button size="sm" variant="outline" onClick={() => setPasteOpen((v) => !v)}>
              <ClipboardPaste className="w-4 h-4 mr-1" />Paste from Excel
            </Button>
            {rows.length > 0 && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={clearAll}>
                <Trash2 className="w-4 h-4 mr-1" />Clear All
              </Button>
            )}
          </div>
        </CardHeader>

        {pasteOpen && (
          <CardContent className="pt-0 pb-4 space-y-2 border-b">
            <p className="text-xs text-muted-foreground">
              Excel থেকে কপি করে এখানে পেস্ট করুন — প্রতি লাইন একটা ভাউচার। কলামগুলো Tab দিয়ে আলাদা থাকবে (Excel থেকে কপি করলে এমনিতেই হয়ে যায়):
              <br />সহজ ফরম্যাট (ডিফল্ট Debit/Credit অ্যাকাউন্ট ব্যবহার হবে): <code className="font-mono">তারিখ&#9;বিবরণ&#9;টাকা</code>
              <br />বিস্তারিত ফরম্যাট (প্রতি রো নিজস্ব লেজার): <code className="font-mono">তারিখ&#9;বিবরণ&#9;Debit Account&#9;Credit Account&#9;টাকা</code>
              <br />তারিখ DD-MM-YYYY বা YYYY-MM-DD দুই ফরম্যাটেই চলবে। Account কলামে code বা name যেকোনোটা দেওয়া যাবে।
            </p>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"01-08-2026\tCNG bill\t460\n02-08-2026\tRickshaw fare\t50"}
              rows={6}
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={parsePasteText} disabled={!pasteText.trim()}>Parse & Add Rows</Button>
              <Button size="sm" variant="ghost" onClick={() => { setPasteOpen(false); setPasteText(""); }}>Cancel</Button>
            </div>
          </CardContent>
        )}

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Date</TableHead>
                <TableHead>Narration</TableHead>
                <TableHead className="w-64">Debit Account</TableHead>
                <TableHead className="w-64">Credit Account</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {loadingSetup ? "Loading…" : 'No rows yet — click "Add Row" or paste from Excel above.'}
                </TableCell></TableRow>
              ) : rows.map((r) => {
                const err = rowErrors[r.id];
                const res = results[r.id];
                return (
                  <TableRow key={r.id} className={cn(err && "bg-destructive/5", res?.status === "success" && "bg-success/5")}>
                    <TableCell>
                      <DateInput value={r.date} onChange={(v) => updateRow(r.id, { date: v })} className="h-9" />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.narration}
                        onChange={(e) => updateRow(r.id, { narration: e.target.value })}
                        onBlur={(e) => handleNarrationBlur(r.id, e.target.value)}
                        placeholder="Description, or =120+90+50+30 to sum into Amount"
                        className="h-9"
                      />
                    </TableCell>
                    <TableCell>
                      <AccountCombobox accounts={accounts} value={r.debitAccountId} onChange={(v) => updateRow(r.id, { debitAccountId: v })} placeholder="Debit account" />
                    </TableCell>
                    <TableCell>
                      <AccountCombobox accounts={accounts} value={r.creditAccountId} onChange={(v) => updateRow(r.id, { creditAccountId: v })} placeholder="Credit account" />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={r.amount}
                        onChange={(e) => updateRow(r.id, { amount: e.target.value })}
                        onBlur={(e) => handleAmountBlur(r.id, e.target.value)}
                        className="h-9 text-right tabular-nums"
                        placeholder="0.00 or =120+90"
                      />
                    </TableCell>
                    <TableCell>
                      {res?.status === "success" ? (
                        <span title={res.voucherNumber}><CheckCircle2 className="w-4 h-4 text-success" /></span>
                      ) : res?.status === "error" ? (
                        <span title={res.message}><XCircle className="w-4 h-4 text-destructive" /></span>
                      ) : (
                        <Button size="icon" variant="ghost" onClick={() => removeRow(r.id)} disabled={submitting}>
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {rows.some((r) => rowErrors[r.id]) && (
            <div className="px-4 py-2 text-xs text-destructive space-y-0.5 border-t">
              {rows.filter((r) => rowErrors[r.id]).map((r) => (
                <div key={r.id}>Row {rows.indexOf(r) + 1}: {rowErrors[r.id]}</div>
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30 text-sm">
              <span className="text-muted-foreground">{rows.length} entr{rows.length === 1 ? "y" : "ies"}</span>
              <span className="font-semibold tabular-nums">Total: {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          {submitting && (
            <span className="text-sm text-muted-foreground mr-2 flex items-center gap-1">
              <Loader2 className="w-4 h-4 animate-spin" />Creating {progress.done}/{progress.total}…
            </span>
          )}
          {Object.values(results).some((r) => r.status === "error") && !submitting && (
            <Button variant="outline" onClick={() => setResults({})}>
              <RotateCcw className="w-4 h-4 mr-1" />Fix & Retry
            </Button>
          )}
          <Button
            variant="outline"
            className="border-amber-500 bg-amber-100 text-amber-900 hover:bg-amber-200 hover:text-amber-900 dark:bg-amber-500/20 dark:text-amber-100 dark:border-amber-400/60 dark:hover:bg-amber-500/30"
            onClick={() => handleSubmit(false)}
            disabled={submitting}
          >
            Save All as Draft
          </Button>
          <Button onClick={() => handleSubmit(true)} disabled={submitting}>
            Post {rows.length} {voucherTypeLabel}{rows.length === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </div>
  );
}
