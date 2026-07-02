import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertCircle, Inbox, Search } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { signedOpeningBalance, formatSignedBalance } from "@/lib/balance-format";
import { isoToDmy, toDateInputValue } from "@/lib/date-format";

interface Props {
  accountId: string | null;
  accountName: string;
  openingBalance: number;
  openingBalanceType: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LedgerEntry {
  id: string;
  debit: number;
  credit: number;
  narration: string | null;
  voucher_number: string;
  voucher_date: string;
  voucher_type: string;
  description: string | null;
  running_balance: number;
}

const VOUCHER_TYPE_LABEL: Record<string, string> = {
  journal: "Journal Voucher",
  payment: "Payment Voucher",
  receipt: "Receipt Voucher",
  contra: "Contra Voucher",
};
const labelVoucherType = (t: string) =>
  VOUCHER_TYPE_LABEL[(t || "").toLowerCase()] || (t ? `${t.charAt(0).toUpperCase()}${t.slice(1)} Voucher` : "Voucher");

const PAGE_SIZE = 25;

export function AccountLedgerDialog({ accountId, accountName, openingBalance, openingBalanceType, open, onOpenChange }: Props) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const { fc } = useCurrency();

  useEffect(() => {
    if (!accountId || !open) return;
    const fetchLedger = async () => {
      setLoading(true);
      setError(null);
      const { data, error: fetchErr } = await supabase
        .from("voucher_entries")
        .select("id, debit, credit, narration, acc_vouchers!inner(voucher_number, voucher_date, voucher_type, description, status)")
        .eq("account_id", accountId)
        .in("acc_vouchers.status", ["approved", "posted"])
        .order("voucher_date", { foreignTable: "acc_vouchers", ascending: true });

      if (fetchErr) {
        console.error("Ledger fetch error:", fetchErr);
        setError(fetchErr.message || "Failed to load ledger");
        setEntries([]);
        setLoading(false);
        return;
      }

      let runBal = signedOpeningBalance(openingBalance, openingBalanceType);

      const mapped = (data || []).map((e: any) => {
        // acc_vouchers may come as object (Supabase FK embed) or array (PostgREST
        // when relation isn't uniquely detected, or the Laravel bridge stitch).
        const v = Array.isArray(e.acc_vouchers) ? e.acc_vouchers[0] : e.acc_vouchers;
        runBal += Number(e.debit) - Number(e.credit);
        return {
          id: e.id,
          debit: Number(e.debit),
          credit: Number(e.credit),
          narration: e.narration,
          voucher_number: v?.voucher_number || "",
          voucher_date: toDateInputValue(v?.voucher_date),
          voucher_type: v?.voucher_type || "",
          description: v?.description || "",
          running_balance: runBal,
        };
      });

      setEntries(mapped);
      setLoading(false);
    };
    fetchLedger();
  }, [accountId, open, openingBalance, openingBalanceType]);

  useEffect(() => { setPage(1); }, [search, dateFrom, dateTo, accountId, open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (dateFrom && e.voucher_date < dateFrom) return false;
      if (dateTo && e.voucher_date > dateTo) return false;
      if (!q) return true;
      return (
        e.voucher_number.toLowerCase().includes(q) ||
        labelVoucherType(e.voucher_type).toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q) ||
        (e.narration || "").toLowerCase().includes(q)
      );
    });
  }, [entries, search, dateFrom, dateTo]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageEntries = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const closingBalance = filtered.length > 0 ? filtered[filtered.length - 1].running_balance : signedOpeningBalance(openingBalance, openingBalanceType);
  const totalDebit = filtered.reduce((s, e) => s + e.debit, 0);
  const totalCredit = filtered.reduce((s, e) => s + e.credit, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Ledger Statement — {accountName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 mb-4">
          <Badge variant="outline" className="text-sm px-3 py-1">
            Opening: {formatSignedBalance(signedOpeningBalance(openingBalance, openingBalanceType), fc)}
          </Badge>
          <Badge variant="outline" className="text-sm px-3 py-1">
            Closing: <span className={closingBalance < 0 ? "text-destructive" : ""}>{formatSignedBalance(closingBalance, fc)}</span>
          </Badge>
        </div>

        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="space-y-1">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Voucher #, type, description…" className="h-9 w-64 pl-7" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-36" />
          </div>
          {(search || dateFrom || dateTo) && (
            <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}>Clear</Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Voucher #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Opening Balance Row */}
            <TableRow className="bg-muted/30">
              <TableCell colSpan={4} className="font-medium">Opening Balance</TableCell>
              <TableCell className="text-right tabular-nums">
                {openingBalanceType === "debit" && openingBalance > 0 ? fc(openingBalance) : ""}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {openingBalanceType === "credit" && openingBalance > 0 ? fc(openingBalance) : ""}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {openingBalance > 0 ? formatSignedBalance(signedOpeningBalance(openingBalance, openingBalanceType), fc) : "—"}
              </TableCell>
            </TableRow>

            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Loading...</TableCell></TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8">
                  <div className="flex flex-col items-center gap-2 text-destructive">
                    <AlertCircle className="w-6 h-6" />
                    <div className="text-sm font-medium">Failed to load ledger</div>
                    <div className="text-xs text-muted-foreground">{error}</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Inbox className="w-6 h-6" />
                    <div className="text-sm">{entries.length === 0 ? "No vouchers posted to this account yet" : "No entries match your filters"}</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : pageEntries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{isoToDmy(e.voucher_date)}</TableCell>
                <TableCell><Badge variant="secondary" className="text-xs">{labelVoucherType(e.voucher_type)}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{e.voucher_number}</TableCell>
                <TableCell className="text-muted-foreground">{e.description || e.narration || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{e.debit > 0 ? fc(e.debit) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{e.credit > 0 ? fc(e.credit) : ""}</TableCell>
                <TableCell className={`text-right tabular-nums font-medium ${e.running_balance < 0 ? "text-destructive" : ""}`}>
                  {formatSignedBalance(e.running_balance, fc)}
                </TableCell>
              </TableRow>
            ))}

            {/* Totals Row */}
            <TableRow className="bg-muted/50 font-bold">
              <TableCell colSpan={4} className="text-right">Total</TableCell>
              <TableCell className="text-right tabular-nums">{fc(totalDebit)}</TableCell>
              <TableCell className="text-right tabular-nums">{fc(totalCredit)}</TableCell>
              <TableCell className={`text-right tabular-nums ${closingBalance < 0 ? "text-destructive" : ""}`}>
                {formatSignedBalance(closingBalance, fc)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <div className="text-muted-foreground">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
              <span className="text-xs text-muted-foreground">Page {currentPage} / {pageCount}</span>
              <Button size="sm" variant="outline" disabled={currentPage === pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
