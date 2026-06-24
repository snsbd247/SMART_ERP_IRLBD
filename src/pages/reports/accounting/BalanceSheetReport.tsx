import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ReportHeader } from "@/components/ReportHeader";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { useReportData } from "@/hooks/useReportData";
import { fetchAllVoucherEntries, num } from "@/lib/report-fetch";
import { signedOpeningBalance } from "@/lib/balance-format";
import { Scale } from "lucide-react";

const BalanceSheetReport = () => {
  const { accounts, branches, loading, setLoading, fc, printRef, dateFrom, setDateFrom, dateTo, setDateTo, branch, setBranch, handlePrint, handleExportExcel, handleExportPDF } = useReportData();
  const [assets, setAssets] = useState<any[]>([]);
  const [liabilities, setLiabilities] = useState<any[]>([]);
  const [equity, setEquity] = useState<any[]>([]);
  const [netProfit, setNetProfit] = useState(0);

  const fetchData = async () => {
    setLoading(true);
    // "As of" report → fetch from the very beginning of records up to dateTo
    const entries = await fetchAllVoucherEntries({ dateFrom: "1900-01-01", dateTo, branchId: branch });
    const balMap = new Map<string, number>();
    entries.forEach((e: any) => {
      const cur = balMap.get(e.account_id) || 0;
      balMap.set(e.account_id, cur + num(e.debit) - num(e.credit));
    });

    const getBalance = (a: any) => {
      const txn = balMap.get(a.id) || 0;
      const open = signedOpeningBalance(a.opening_balance, a.opening_balance_type);
      return open + txn;
    };

    setAssets(accounts.filter((a) => a.account_type === "asset").map((a) => ({ ...a, balance: getBalance(a) })).filter((a) => a.balance !== 0));
    setLiabilities(accounts.filter((a) => a.account_type === "liability").map((a) => ({ ...a, balance: -getBalance(a) })).filter((a) => a.balance !== 0));
    setEquity(accounts.filter((a) => a.account_type === "equity").map((a) => ({ ...a, balance: -getBalance(a) })).filter((a) => a.balance !== 0));

    // Compute period Net Profit/(Loss) and roll into equity total so BS balances
    const incomeTotal = accounts.filter((a) => a.account_type === "income")
      .reduce((s, a) => s + -(balMap.get(a.id) || 0) * -1, 0); // credit-balance = income
    // Simpler: income natural = credit - debit; expense natural = debit - credit
    let income = 0, expense = 0;
    accounts.forEach((a) => {
      const txn = balMap.get(a.id) || 0; // debit - credit
      if (a.account_type === "income") income += -txn; // flip to credit-positive
      if (a.account_type === "expense") expense += txn;
    });
    setNetProfit(income - expense);
    setLoading(false);
  };

  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);
  const totalEquityAccounts = equity.reduce((s, e) => s + e.balance, 0);
  const totalEquity = totalEquityAccounts + netProfit; // Roll period P&L into equity so BS balances

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto">
      <ReportHeader reportTitle="Balance Sheet" subtitle={`As of ${dateTo}`} />
      <div className="flex items-center gap-2">
        <Scale className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Balance Sheet</h1>
      </div>
      <ReportFilters
        dateFrom={dateFrom} dateTo={dateTo}
        onDateFromChange={setDateFrom} onDateToChange={setDateTo}
        branches={branches} selectedBranch={branch} onBranchChange={setBranch}
        onSearch={fetchData} loading={loading}
        onPrint={() => handlePrint("Balance Sheet")}
        onExportExcel={() => handleExportExcel(
          [...assets.map((a) => ({ ...a, category: "Asset" })), ...liabilities.map((l) => ({ ...l, category: "Liability" })), ...equity.map((e) => ({ ...e, category: "Equity" }))],
          [{ key: "account_code", label: "Code" }, { key: "account_name", label: "Account" }, { key: "category", label: "Type" }, { key: "balance", label: "Amount", format: "currency" }],
          "balance-sheet"
        )}
        onExportPDF={() => handleExportPDF("Balance Sheet")}
      />
      <div ref={printRef}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Assets</CardTitle></CardHeader>
            <CardContent className="p-0"><Table><TableBody>
              {assets.map((a) => (<TableRow key={a.id}><TableCell>{a.account_name}</TableCell><TableCell className="text-right tabular-nums">{fc(a.balance)}</TableCell></TableRow>))}
              <TableRow className="bg-muted/50 font-bold"><TableCell>Total Assets</TableCell><TableCell className="text-right tabular-nums">{fc(totalAssets)}</TableCell></TableRow>
            </TableBody></Table></CardContent>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Liabilities</CardTitle></CardHeader>
              <CardContent className="p-0"><Table><TableBody>
                {liabilities.map((l) => (<TableRow key={l.id}><TableCell>{l.account_name}</TableCell><TableCell className="text-right tabular-nums">{fc(l.balance)}</TableCell></TableRow>))}
                <TableRow className="bg-muted/50 font-bold"><TableCell>Total Liabilities</TableCell><TableCell className="text-right tabular-nums">{fc(totalLiabilities)}</TableCell></TableRow>
              </TableBody></Table></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Equity</CardTitle></CardHeader>
              <CardContent className="p-0"><Table><TableBody>
                {equity.map((e) => (<TableRow key={e.id}><TableCell>{e.account_name}</TableCell><TableCell className="text-right tabular-nums">{fc(e.balance)}</TableCell></TableRow>))}
                <TableRow><TableCell className="text-muted-foreground">Net Profit / (Loss) for the period</TableCell><TableCell className={`text-right tabular-nums ${netProfit < 0 ? "text-destructive" : ""}`}>{fc(netProfit)}</TableCell></TableRow>
                <TableRow className="bg-muted/50 font-bold"><TableCell>Total Equity</TableCell><TableCell className="text-right tabular-nums">{fc(totalEquity)}</TableCell></TableRow>
              </TableBody></Table></CardContent>
            </Card>
          </div>
        </div>
        <Card className="mt-4">
          <CardContent className="py-4">
            <div className="flex justify-between items-center text-sm">
              <span>Assets = Liabilities + Equity</span>
              <span className={`font-bold ${Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.01 ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
                {fc(totalAssets)} = {fc(totalLiabilities + totalEquity)}
                {Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.01 ? " ✓" : ` (Diff: ${fc(totalAssets - totalLiabilities - totalEquity)})`}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BalanceSheetReport;
