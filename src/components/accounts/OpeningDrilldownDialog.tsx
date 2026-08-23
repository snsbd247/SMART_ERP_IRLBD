import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatDateDMY } from "@/lib/date-format";

export interface DrilldownRow {
  id: string;
  date: string;
  reference?: string | null;
  description?: string | null;
  debit: number;
  credit: number;
  running_balance: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  baseOpening: number;
  rows: DrilldownRow[];
  /** Final opening for the selected period (= last running_balance) */
  periodOpening: number;
  /** Label for the "base opening" row, e.g. "System Opening" or "Pre-period start" */
  baseLabel?: string;
  /** True while the detailed breakdown is being fetched (fetched lazily on open). */
  loading?: boolean;
}

/**
 * Shows how a ledger's period opening was derived: base opening + every
 * prior transaction, with a running balance. Used on the Opening Balance row
 * of ledgers and the Customer Statement.
 */
export function OpeningDrilldownDialog({
  open,
  onOpenChange,
  title,
  baseOpening,
  rows,
  periodOpening,
  baseLabel = "Base Opening (chart of accounts)",
  loading = false,
}: Props) {
  const { fc } = useCurrency();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Prior-period transactions that produce this period's opening balance.
            Final opening:{" "}
            <span className={periodOpening < 0 ? "text-destructive font-medium" : "font-medium"}>
              {fc(periodOpening)}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Date</TableHead>
                <TableHead className="w-32">Reference</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right w-28">Debit</TableHead>
                <TableHead className="text-right w-28">Credit</TableHead>
                <TableHead className="text-right w-32">Running</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40">
                <TableCell>—</TableCell>
                <TableCell className="font-mono text-xs">—</TableCell>
                <TableCell className="font-medium">{baseLabel}</TableCell>
                <TableCell className="text-right tabular-nums" />
                <TableCell className="text-right tabular-nums" />
                <TableCell className={`text-right tabular-nums font-medium ${baseOpening < 0 ? "text-destructive" : ""}`}>
                  {fc(baseOpening)}
                </TableCell>
              </TableRow>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6 text-sm">
                    Loading prior transactions…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6 text-sm">
                    No prior transactions — opening equals the base opening.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{formatDateDMY(r.date)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.reference || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.description || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{r.debit > 0 ? fc(r.debit) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{r.credit > 0 ? fc(r.credit) : ""}</TableCell>
                    <TableCell className={`text-right tabular-nums text-sm font-medium ${r.running_balance < 0 ? "text-destructive" : ""}`}>
                      {fc(r.running_balance)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
