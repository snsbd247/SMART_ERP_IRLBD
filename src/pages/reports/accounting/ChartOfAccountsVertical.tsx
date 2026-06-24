import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportHeader } from "@/components/ReportHeader";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { useReportData } from "@/hooks/useReportData";
import { signedOpeningBalance } from "@/lib/balance-format";
import { supabase } from "@/integrations/supabase/client";
import { ListTree } from "lucide-react";

interface AccountNode {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  parent_id: string | null;
  opening_balance: number;
  opening_balance_type: string;
  children: AccountNode[];
  depth: number;
  self_balance: number;
  rollup_balance: number;
}

const TYPE_ORDER: { key: string; label: string }[] = [
  { key: "asset", label: "ASSETS" },
  { key: "liability", label: "LIABILITIES" },
  { key: "equity", label: "EQUITY" },
  { key: "income", label: "INCOME" },
  { key: "expense", label: "EXPENSES" },
];

const ChartOfAccountsVertical = () => {
  const {
    accounts, branches, loading, setLoading, fc, printRef,
    dateFrom, setDateFrom, dateTo, setDateTo, branch, setBranch,
    handlePrint, handleExportExcel, handleExportPDF,
  } = useReportData();
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [generated, setGenerated] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    let query = supabase.from("voucher_entries")
      .select("account_id, debit, credit, acc_vouchers!inner(status, voucher_date, branch_id)")
      .eq("acc_vouchers.status", "approved")
      .gte("acc_vouchers.voucher_date", dateFrom)
      .lte("acc_vouchers.voucher_date", dateTo);
    if (branch !== "all") query = query.eq("acc_vouchers.branch_id", branch);
    const { data: entries } = await query;

    const map = new Map<string, number>();
    accounts.forEach((a) => {
      const openDr = a.opening_balance_type === "debit" ? Number(a.opening_balance) : 0;
      const openCr = a.opening_balance_type === "credit" ? Number(a.opening_balance) : 0;
      map.set(a.id, openDr - openCr);
    });
    (entries || []).forEach((e: any) => {
      map.set(e.account_id, (map.get(e.account_id) || 0) + Number(e.debit) - Number(e.credit));
    });
    setBalances(map);
    setGenerated(true);
    setLoading(false);
  };

  const tree = useMemo(() => {
    const byId = new Map<string, AccountNode>();
    accounts.forEach((a) =>
      byId.set(a.id, {
        id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
        account_type: a.account_type,
        parent_id: a.parent_id,
        opening_balance: Number(a.opening_balance),
        opening_balance_type: a.opening_balance_type,
        children: [],
        depth: 0,
        self_balance: 0,
        rollup_balance: 0,
      })
    );
    const roots: AccountNode[] = [];
    byId.forEach((n) => {
      if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)!.children.push(n);
      else roots.push(n);
    });
    const setDepth = (nodes: AccountNode[], d: number) => {
      nodes.sort((a, b) => a.account_code.localeCompare(b.account_code));
      nodes.forEach((n) => { n.depth = d; setDepth(n.children, d + 1); });
    };
    setDepth(roots, 0);
    const rollup = (n: AccountNode): number => {
      n.self_balance = balances.get(n.id) || 0;
      const childSum = n.children.reduce((s, c) => s + rollup(c), 0);
      n.rollup_balance = n.self_balance + childSum;
      return n.rollup_balance;
    };
    roots.forEach(rollup);
    return roots;
  }, [accounts, balances]);

  const flatRows = useMemo(() => {
    const out: AccountNode[] = [];
    const walk = (n: AccountNode) => { out.push(n); n.children.forEach(walk); };
    tree.forEach(walk);
    return out;
  }, [tree]);

  const sectionTotal = (typeKey: string) =>
    tree.filter((n) => n.account_type === typeKey).reduce((s, n) => s + n.rollup_balance, 0);

  const exportColumns = [
    { key: "account_code", label: "Code" },
    { key: "account_name", label: "Account Name" },
    { key: "account_type", label: "Type" },
    { key: "self_balance", label: "Own Balance", format: "currency" as const },
    { key: "rollup_balance", label: "Rollup Balance", format: "currency" as const },
  ];

  const renderNode = (n: AccountNode) => {
    const hasChildren = n.children.length > 0;
    const showVal = n.rollup_balance;
    return (
      <div key={n.id}>
        <div
          className={`flex items-center justify-between border-b border-border/40 py-1.5 ${
            n.depth === 0 ? "bg-muted/40 font-semibold" : ""
          }`}
          style={{ paddingLeft: `${n.depth * 20 + 8}px` }}
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground w-16">{n.account_code}</span>
            <span className={n.depth === 0 ? "text-foreground" : "text-foreground/90"}>{n.account_name}</span>
          </div>
          <div className={`text-sm tabular-nums pr-2 ${hasChildren ? "font-semibold" : ""} ${showVal < 0 ? "text-destructive" : ""}`}>
            {fc(showVal)}
          </div>
        </div>
        {n.children.map(renderNode)}
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1200px] mx-auto">
      <ReportHeader reportTitle="Chart of Accounts — Vertical" subtitle={`${dateFrom} to ${dateTo}`} />
      <div className="flex items-center gap-2">
        <ListTree className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Chart of Accounts (Vertical / Hierarchical)</h1>
      </div>
      <ReportFilters
        dateFrom={dateFrom} dateTo={dateTo}
        onDateFromChange={setDateFrom} onDateToChange={setDateTo}
        branches={branches} selectedBranch={branch} onBranchChange={setBranch}
        onSearch={fetchData} loading={loading}
        onPrint={() => handlePrint("Chart of Accounts — Vertical")}
        onExportExcel={() => handleExportExcel(flatRows as any, exportColumns, "chart-of-accounts-vertical")}
        onExportPDF={() => handleExportPDF("Chart of Accounts — Vertical")}
      />
      <div ref={printRef}>
        <Card>
          <CardContent className="p-4 space-y-6">
            {!generated ? (
              <div className="text-center text-muted-foreground py-8">Click "Generate" to load data</div>
            ) : (
              TYPE_ORDER.map((t) => {
                const sectionNodes = tree.filter((n) => n.account_type === t.key);
                if (sectionNodes.length === 0) return null;
                return (
                  <div key={t.key}>
                    <div className="bg-primary/10 text-primary px-3 py-2 font-bold text-sm tracking-wider border-l-4 border-primary">
                      {t.label}
                    </div>
                    <div>{sectionNodes.map(renderNode)}</div>
                    <div className="flex justify-between border-t-2 border-foreground/40 pt-2 mt-1 px-2 font-bold">
                      <span>Total {t.label}</span>
                      <span className="tabular-nums">{fc(sectionTotal(t.key))}</span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ChartOfAccountsVertical;
