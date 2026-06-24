import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ReportHeader } from "@/components/ReportHeader";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { useReportData } from "@/hooks/useReportData";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllVoucherEntries, num } from "@/lib/report-fetch";
import { signedOpeningBalance } from "@/lib/balance-format";
import { applyEntry, verifyClosingBalance } from "@/lib/ledger-balance";
import { downloadCSV } from "@/lib/csv-export";
import { BookOpen, FileDown } from "lucide-react";

const GeneralLedgerReport = () => {
  const { accounts, branches, loading, setLoading, fc, printRef, dateFrom, setDateFrom, dateTo, setDateTo, branch, setBranch, handlePrint, handleExportExcel, handleExportPDF } = useReportData();
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"both" | "approved" | "posted">("both");
  const [data, setData] = useState<any[]>([]);
  const hasFetched = useRef(false);

  const fetchData = async () => {
    setLoading(true);
    hasFetched.current = true;
    const statuses = statusFilter === "both" ? ["approved", "posted"] : [statusFilter];
    const entries = await fetchAllVoucherEntries({
      dateFrom, dateTo, branchId: branch,
      accountId: selectedAccount !== "all" ? selectedAccount : null,
      statuses,
    });

    // Group by account and compute running balance (entries are date-ordered)
    const grouped = new Map<string, any[]>();
    entries.forEach((e: any) => {
      const list = grouped.get(e.account_id) || [];
      list.push(e);
      grouped.set(e.account_id, list);
    });

    const result: any[] = [];
    grouped.forEach((rows, accountId) => {
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc) return;
      let runBal = signedOpeningBalance(acc.opening_balance, acc.opening_balance_type);
      rows.forEach((e) => {
        runBal += num(e.credit) - num(e.debit);
        result.push({
          ...e,
          account_name: acc.account_name,
          account_code: acc.account_code,
          voucher_number: e.acc_vouchers?.voucher_number,
          voucher_date: e.acc_vouchers?.voucher_date,
          description: e.acc_vouchers?.description || e.narration || "—",
          running_balance: runBal,
        });
      });
    });

    setData(result);
    setLoading(false);
  };

  // Auto-refresh on voucher status changes (post/approve)
  useEffect(() => {
    const channel = supabase
      .channel("general-ledger-vouchers")
      .on("postgres_changes", { event: "*", schema: "public", table: "acc_vouchers" }, () => {
        if (hasFetched.current) fetchData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, statusFilter, dateFrom, dateTo, branch]);


  const columns = [
    { key: "voucher_date", label: "Date" }, { key: "account_name", label: "Account" },
    { key: "voucher_number", label: "Voucher #" }, { key: "description", label: "Description" },
    { key: "debit", label: "Debit", format: "currency" as const }, { key: "credit", label: "Credit", format: "currency" as const },
    { key: "running_balance", label: "Balance", format: "currency" as const },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto">
      <ReportHeader reportTitle="General Ledger" subtitle={`${dateFrom} to ${dateTo}`} />
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">General Ledger</h1>
      </div>
      <ReportFilters
        dateFrom={dateFrom} dateTo={dateTo}
        onDateFromChange={setDateFrom} onDateToChange={setDateTo}
        branches={branches} selectedBranch={branch} onBranchChange={setBranch}
        accounts={accounts} selectedAccount={selectedAccount} onAccountChange={setSelectedAccount}
        onSearch={fetchData} loading={loading}
        onPrint={() => handlePrint("General Ledger")}
        onExportExcel={() => handleExportExcel(data, columns, "general-ledger")}
        onExportPDF={() => handleExportPDF("General Ledger")}
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
        <Button variant="outline" size="sm" onClick={() => downloadCSV("general-ledger", columns, data)} disabled={!data.length} className="h-9">
          <FileDown className="w-4 h-4 mr-1" />CSV
        </Button>
      </ReportFilters>
      <div ref={printRef}>
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Account</TableHead><TableHead>Voucher #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {hasFetched.current
                    ? `No ${statusFilter === "both" ? "approved or posted" : statusFilter} voucher entries found for the selected filters.`
                    : 'Select filters and click "Generate"'}
                </TableCell></TableRow>
              ) : (<>
                {selectedAccount !== "all" && (() => {
                  const acc = accounts.find((a) => a.id === selectedAccount);
                  if (!acc) return null;
                  const op = signedOpeningBalance(acc.opening_balance, acc.opening_balance_type);
                  return (
                    <TableRow className="bg-muted/40">
                      <TableCell className="text-sm">{dateFrom}</TableCell>
                      <TableCell className="font-medium text-sm">{acc.account_name}</TableCell>
                      <TableCell className="font-mono text-xs">—</TableCell>
                      <TableCell className="font-medium">Opening Balance</TableCell>
                      <TableCell className="text-right tabular-nums" />
                      <TableCell className="text-right tabular-nums" />
                      <TableCell className={`text-right tabular-nums font-medium ${op < 0 ? "text-destructive" : ""}`}>{fc(op)}</TableCell>
                    </TableRow>
                  );
                })()}
                {data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm">{e.voucher_date}</TableCell>
                  <TableCell className="font-medium text-sm">{e.account_name}</TableCell>
                  <TableCell className="font-mono text-xs">{e.voucher_number}</TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">{e.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(e.debit) > 0 ? fc(Number(e.debit)) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(e.credit) > 0 ? fc(Number(e.credit)) : ""}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${e.running_balance < 0 ? "text-destructive" : ""}`}>
                    {fc(e.running_balance)}
                  </TableCell>
                </TableRow>
              ))}</>)}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>
    </div>
  );
};

export default GeneralLedgerReport;
