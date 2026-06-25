import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useCurrency } from "@/contexts/CurrencyContext";
import { signedOpeningBalance, formatSignedBalance } from "@/lib/balance-format";

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

export function AccountLedgerDialog({ accountId, accountName, openingBalance, openingBalanceType, open, onOpenChange }: Props) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { fc } = useCurrency();

  useEffect(() => {
    if (!accountId || !open) return;
    const fetchLedger = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("voucher_entries")
        .select("id, debit, credit, narration, acc_vouchers!inner(voucher_number, voucher_date, voucher_type, description, status)")
        .eq("account_id", accountId)
        .in("acc_vouchers.status", ["approved", "posted"])
        .order("voucher_date", { foreignTable: "acc_vouchers", ascending: true });

      if (error) console.error("Ledger fetch error:", error);

      let runBal = signedOpeningBalance(openingBalance, openingBalanceType);

      const mapped = (data || []).map((e: any) => {
        runBal += Number(e.debit) - Number(e.credit);
        return {
          id: e.id,
          debit: Number(e.debit),
          credit: Number(e.credit),
          narration: e.narration,
          voucher_number: e.acc_vouchers?.voucher_number || "",
          voucher_date: e.acc_vouchers?.voucher_date || "",
          voucher_type: e.acc_vouchers?.voucher_type || "",
          description: e.acc_vouchers?.description || "",
          running_balance: runBal,
        };
      });

      setEntries(mapped);
      setLoading(false);
    };
    fetchLedger();
  }, [accountId, open, openingBalance, openingBalanceType]);

  const closingBalance = entries.length > 0 ? entries[entries.length - 1].running_balance : signedOpeningBalance(openingBalance, openingBalanceType);
  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

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
              <TableCell colSpan={3} className="font-medium">Opening Balance</TableCell>
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
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : entries.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No transactions</TableCell></TableRow>
            ) : entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.voucher_date}</TableCell>
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
              <TableCell colSpan={3} className="text-right">Total</TableCell>
              <TableCell className="text-right tabular-nums">{fc(totalDebit)}</TableCell>
              <TableCell className="text-right tabular-nums">{fc(totalCredit)}</TableCell>
              <TableCell className={`text-right tabular-nums ${closingBalance < 0 ? "text-destructive" : ""}`}>
                {formatSignedBalance(closingBalance, fc)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
