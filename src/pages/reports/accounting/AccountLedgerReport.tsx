import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { useReportData } from "@/hooks/useReportData";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllVoucherEntries, fetchAccountLedgerEntriesLaravel } from "@/lib/report-fetch";
import { applyEntry, verifyClosingBalance } from "@/lib/ledger-balance";
import { aggregateEntriesByVoucherAccount } from "@/lib/ledger-entry-aggregation";
import { computeAccountPeriodOpening, fetchAccountPriorEntries, type PriorEntry } from "@/lib/period-opening";
import { OpeningDrilldownDialog } from "@/components/accounts/OpeningDrilldownDialog";
import { downloadCSV } from "@/lib/csv-export";
import { ScrollText, FileDown } from "lucide-react";

const AccountLedgerReport = () => {
  const { accounts, branches, loading, setLoading, fc, printRef, dateFrom, setDateFrom, dateTo, setDateTo, branch, setBranch, handlePrint, handleExportExcel, handleExportPDF } = useReportData();
  const [selectedAccount, setSelectedAccount] = useState("");
  const [statusFilter, setStatusFilter] = useState<"both" | "approved" | "posted">("both");
  const [data, setData] = useState<any[]>([]);
  const hasFetched = useRef(false);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [baseOpening, setBaseOpening] = useState<number>(0);
  const [priorEntries, setPriorEntries] = useState<PriorEntry[]>([]);
  const [priorLoading, setPriorLoading] = useState(false);
  const [periodOpening, setPeriodOpening] = useState<number>(0);

  // Prior-period entry breakdown is only needed if the user opens the
  // Opening Balance drilldown — fetched lazily instead of on every report
  // generation, since it means pulling potentially years of history.
  const openDrilldown = async () => {
    setDrilldownOpen(true);
    if (priorEntries.length > 0 || !selectedAccount) return;
    setPriorLoading(true);
    try {
      const { BALANCE_VOUCHER_STATUSES } = await import("@/lib/shared-balance");
      const statuses = statusFilter === "both" ? [...BALANCE_VOUCHER_STATUSES] : [statusFilter];
      const rows = await fetchAccountPriorEntries({
        accountId: selectedAccount, dateFrom, branchId: branch, statuses, baseOpening,
      });
      setPriorEntries(rows);
    } finally {
      setPriorLoading(false);
    }
  };


  const fetchData = async () => {
    if (!selectedAccount || selectedAccount === "all") return;
    setLoading(true);
    hasFetched.current = true;
    // Shared source of truth — see src/lib/shared-balance.ts
    const { BALANCE_VOUCHER_STATUSES } = await import("@/lib/shared-balance");
    const statuses = statusFilter === "both" ? [...BALANCE_VOUCHER_STATUSES] : [statusFilter];
    const acc = accounts.find((a) => a.id === selectedAccount);

    // Opening balance (prior-period) and this period's entries+counter-accounts
    // are fully independent — fetch concurrently. The ledger-entries call
    // hits a dedicated server-side-join endpoint (one request) and only
    // falls back to the old vouchers→entries→counter-accounts chain if that
    // endpoint errors.
    const [open, fast] = await Promise.all([
      computeAccountPeriodOpening({
        accountId: selectedAccount,
        dateFrom,
        branchId: branch,
        statuses,
        account: acc as any,
      }),
      fetchAccountLedgerEntriesLaravel({ accountId: selectedAccount, dateFrom, dateTo, branchId: branch, statuses }),
    ]);
    setBaseOpening(open.baseOpening);
    setPriorEntries([]); // invalidate lazy drilldown cache for the new selection

    let rawEntries: any[];
    let counterMap: Record<string, string[]>;
    if (fast) {
      rawEntries = fast.entries;
      counterMap = fast.counterAccounts;
    } else {
      rawEntries = await fetchAllVoucherEntries({
        dateFrom, dateTo, branchId: branch, accountId: selectedAccount, statuses,
      });
      counterMap = {};
      const voucherIdsForCounter = Array.from(new Set(rawEntries.map((e: any) => e.acc_vouchers?.id).filter(Boolean)));
      if (voucherIdsForCounter.length > 0) {
        const accNameMap = new Map(accounts.map((a: any) => [a.id, a.account_name]));
        const { chunkIds, getInChunkSize, logChunkMetrics } = await import("@/lib/in-chunk");
        const chunkSize = getInChunkSize();
        const chunks = chunkIds(voucherIdsForCounter as string[], chunkSize);
        const chunkResults = await Promise.all(chunks.map((slice) =>
          supabase.from("voucher_entries").select("voucher_id, account_id").in("voucher_id", slice as any)
        ));
        for (const { data: allEntries } of chunkResults) {
          (allEntries || []).forEach((r: any) => {
            if (r.account_id === selectedAccount) return;
            const name = accNameMap.get(r.account_id);
            if (!name) return;
            if (!counterMap[r.voucher_id]) counterMap[r.voucher_id] = [];
            if (!counterMap[r.voucher_id].includes(name)) counterMap[r.voucher_id].push(name);
          });
        }
        logChunkMetrics("AccountLedgerReport/counter-accounts", { totalIds: voucherIdsForCounter.length, chunkSize, chunkCount: chunks.length });
      }
    }

    const entries = aggregateEntriesByVoucherAccount(rawEntries as any[]);
    let runBal = open.opening;
    const opening = runBal;
    const result = entries.map((e: any) => {
      runBal = applyEntry(runBal, { debit: e.debit, credit: e.credit });
      const vid = e.acc_vouchers?.id;
      const particulars = vid && counterMap[vid]?.length ? counterMap[vid].join(", ") : "—";
      return {
        ...e,
        voucher_number: e.acc_vouchers?.voucher_number,
        voucher_date: e.acc_vouchers?.voucher_date,
        particulars,
        description: e.acc_vouchers?.description || e.narration || "—",
        running_balance: runBal,
      };
    });
    if (!verifyClosingBalance(opening, entries as any, runBal)) {
      console.error("[AccountLedgerReport] closing balance mismatch", { opening, runBal });
    }
    setPeriodOpening(opening);
    setData(result);
    setLoading(false);
  };

  // Auto-refresh on voucher status changes (post/approve)
  useEffect(() => {
    const channel = supabase
      .channel("account-ledger-vouchers")
      .on("postgres_changes", { event: "*", schema: "public", table: "acc_vouchers" }, () => {
        if (hasFetched.current) fetchData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, statusFilter, dateFrom, dateTo, branch]);


  const selectedAcc = accounts.find((a) => a.id === selectedAccount);
  const title = selectedAcc ? `${selectedAcc.account_name} Ledger` : "Account Ledger";
  const columns = [
    { key: "voucher_date", label: "Date" }, { key: "voucher_number", label: "Voucher #" },
    { key: "particulars", label: "Particulars (Ledger)" },
    { key: "description", label: "Description" },
    { key: "debit", label: "Debit", format: "currency" as const }, { key: "credit", label: "Credit", format: "currency" as const },
    { key: "running_balance", label: "Balance", format: "currency" as const },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-center gap-2">
        <ScrollText className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Account Ledger</h1>
      </div>
      <ReportFilters
        dateFrom={dateFrom} dateTo={dateTo}
        onDateFromChange={setDateFrom} onDateToChange={setDateTo}
        branches={branches} selectedBranch={branch} onBranchChange={setBranch}
        accounts={accounts} selectedAccount={selectedAccount} onAccountChange={setSelectedAccount}
        onSearch={fetchData} loading={loading}
        onPrint={() => handlePrint(title)}
        onExportExcel={() => handleExportExcel(data, columns, "account-ledger")}
        onExportPDF={() => handleExportPDF(title)}
      >
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Approved + Posted</SelectItem>
              <SelectItem value="approved">Approved only</SelectItem>
              <SelectItem value="posted">Posted only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => downloadCSV("account-ledger", columns, data)} disabled={!data.length} className="h-9">
          <FileDown className="w-4 h-4 mr-1" />CSV
        </Button>
      </ReportFilters>
      <div ref={printRef}>
        {selectedAcc && (
          <div className="mb-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{selectedAcc.account_code}</span> — {selectedAcc.account_name} ({selectedAcc.account_type})
            {" | Opening: "}{fc(periodOpening)}
          </div>
        )}
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Voucher #</TableHead>
              <TableHead>Particulars (Ledger)</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {!selectedAccount || selectedAccount === "all"
                    ? 'Select an account and click "Generate"'
                    : hasFetched.current
                      ? `No ${statusFilter === "both" ? "approved or posted" : statusFilter} voucher entries found for the selected account, date range and branch.`
                      : 'Click "Generate" to load entries'}
                </TableCell></TableRow>
              ) : (<>
                {selectedAcc && (() => {
                  const op = periodOpening;
                  return (
                    <TableRow className="bg-muted/40">
                      <TableCell>{dateFrom}</TableCell>
                      <TableCell className="font-mono text-xs">—</TableCell>
                      <TableCell className="text-sm font-medium">
                        <button
                          type="button"
                          onClick={openDrilldown}
                          className="bg-transparent border-0 p-0 m-0 appearance-none hover:underline print:no-underline"
                          title="See prior-period transactions"
                        >
                          Opening Balance
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">Brought forward</TableCell>
                      <TableCell className="text-right tabular-nums" />
                      <TableCell className="text-right tabular-nums" />
                      <TableCell className={`text-right tabular-nums font-medium ${op < 0 ? "text-destructive" : ""}`}>{fc(op)}</TableCell>
                    </TableRow>
                  );
                })()}
                {data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.voucher_date}</TableCell>
                  <TableCell className="font-mono text-xs">{e.voucher_number}</TableCell>
                  <TableCell className="text-sm">{e.particulars}</TableCell>
                  <TableCell className="text-muted-foreground">{e.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(e.debit) > 0 ? fc(Number(e.debit)) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(e.credit) > 0 ? fc(Number(e.credit)) : ""}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${e.running_balance < 0 ? "text-destructive" : ""}`}>
                    {fc(e.running_balance)}
                  </TableCell>
                </TableRow>
              ))}
              {(() => {
                const totalDebit = data.reduce((s, e) => s + (Number(e.debit) || 0), 0);
                const totalCredit = data.reduce((s, e) => s + (Number(e.credit) || 0), 0);
                return (
                  <TableRow className="bg-muted/40 font-semibold border-t-2">
                    <TableCell colSpan={4} className="text-right">Total</TableCell>
                    <TableCell className="text-right tabular-nums">{fc(totalDebit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fc(totalCredit)}</TableCell>
                    <TableCell />
                  </TableRow>
                );
              })()}</>)}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>
      <OpeningDrilldownDialog
        open={drilldownOpen}
        onOpenChange={setDrilldownOpen}
        title={`Opening Balance — ${selectedAcc?.account_name ?? ""} (as of ${dateFrom})`}
        baseOpening={baseOpening}
        loading={priorLoading}
        rows={priorEntries.map((p) => ({
          id: p.id,
          date: p.voucher_date,
          reference: p.voucher_number,
          description: p.description,
          debit: p.debit,
          credit: p.credit,
          running_balance: p.running_balance,
        }))}
        periodOpening={periodOpening}
      />
    </div>
  );
};

export default AccountLedgerReport;
