import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { voucherApi } from "@/lib/voucher-api";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatDateDMY } from "@/lib/date-format";
import { Loader2 } from "lucide-react";

interface Props {
  voucherId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const VOUCHER_TYPE_LABEL: Record<string, string> = {
  journal: "Journal Voucher",
  payment: "Payment Voucher",
  receipt: "Receipt Voucher",
  contra: "Contra Voucher",
};

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-success/15 text-success",
  posted: "bg-success/15 text-success",
  draft: "bg-muted text-muted-foreground",
  pending: "bg-warning/15 text-warning",
  rejected: "bg-destructive/15 text-destructive",
};

/**
 * Read-only voucher detail popup — fetches by id when opened. Used from
 * Account Ledger (click a Voucher # to see its full entries) and reusable
 * anywhere else a voucher number needs a quick look without navigating away.
 */
export function VoucherDetailDialog({ voucherId, open, onOpenChange }: Props) {
  const { fc } = useCurrency();
  const [loading, setLoading] = useState(false);
  const [voucher, setVoucher] = useState<any>(null);
  const [entries, setEntries] = useState<any[]>([]);

  useEffect(() => {
    if (!open || !voucherId) return;
    setLoading(true);
    setVoucher(null);
    setEntries([]);
    voucherApi.get(voucherId).then(({ voucher: v, entries: e }) => {
      setVoucher(v);
      setEntries(e || []);
    }).finally(() => setLoading(false));
  }, [open, voucherId]);

  const totalDebit = entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
  const totalCredit = entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {voucher && (VOUCHER_TYPE_LABEL[voucher.voucher_type] || "Voucher")} — {voucher?.voucher_number || voucherId}
            {voucher?.status && (
              <Badge variant="outline" className={STATUS_STYLES[voucher.status] || ""}>
                {voucher.status}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />Loading voucher…
          </div>
        ) : voucher ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><span className="text-muted-foreground">Date:</span> <span className="font-medium">{formatDateDMY(voucher.voucher_date)}</span></div>
              <div><span className="text-muted-foreground">Branch:</span> <span className="font-medium">{voucher.branch?.name || "—"}</span></div>
              <div><span className="text-muted-foreground">Amount:</span> <span className="font-medium">{fc(Number(voucher.total_amount) || 0)}</span></div>
              <div><span className="text-muted-foreground">Entered By:</span> <span className="font-medium">{voucher.creator?.name || "—"}</span></div>
            </div>
            {voucher.description && (
              <div className="text-sm"><span className="text-muted-foreground">Description:</span> {voucher.description}</div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Account Code</TableHead>
                  <TableHead>Account Name</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead>Narration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e: any, i: number) => (
                  <TableRow key={e.id || i}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{e.account?.account_code || ""}</TableCell>
                    <TableCell>{e.account?.account_name || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(e.debit) > 0 ? fc(Number(e.debit)) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(e.credit) > 0 ? fc(Number(e.credit)) : ""}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.narration || ""}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-medium">
                  <TableCell colSpan={3} className="text-right">Total</TableCell>
                  <TableCell className="text-right tabular-nums">{fc(totalDebit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fc(totalCredit)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-10">Voucher not found.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
