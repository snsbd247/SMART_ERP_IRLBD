import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ReportHeader } from "@/components/ReportHeader";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useCurrency } from "@/contexts/CurrencyContext";
import { signedOpeningBalance } from "@/lib/balance-format";
import { supabase } from "@/integrations/supabase/client";
import { printReport } from "@/lib/report-utils";
import {
  IFRSLine, IFRS_LINE_LABEL, defaultMapping,
  PL_SECTIONS, BS_SECTIONS,
} from "@/lib/ifrs-mapping";
import { FileText, Printer, FileSpreadsheet, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";

type Account = {
  id: string; account_name: string; account_code: string;
  account_type: string; opening_balance: number; opening_balance_type: string;
};

type LineRow = { line: IFRSLine; label: string; accounts: { name: string; amount: number }[]; total: number };

const fmt = (n: number) => {
  if (!isFinite(n)) n = 0;
  const a = Math.abs(Math.round(n));
  const s = a.toLocaleString("en-US");
  return n < 0 ? `(${s})` : s;
};

const IFRSFinancialStatements = () => {
  const { settings } = useCompanySettings();
  const { fc } = useCurrency();

  // Two periods (current + previous) for comparative IFRS view
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStart = `${today.getFullYear() - 1}-07-01`;
  const prevStart = `${today.getFullYear() - 2}-07-01`;
  const prevEnd = `${today.getFullYear() - 1}-06-30`;

  const [curFrom, setCurFrom] = useState(defaultStart);
  const [curTo, setCurTo] = useState(defaultEnd);
  const [prvFrom, setPrvFrom] = useState(prevStart);
  const [prvTo, setPrvTo] = useState(prevEnd);
  const [preset, setPreset] = useState<string>("custom");
  const [financialYears, setFinancialYears] = useState<{ id: string; name: string; start_date: string; end_date: string }[]>([]);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [overrides, setOverrides] = useState<Map<string, IFRSLine>>(new Map());
  const [curBal, setCurBal] = useState<Map<string, number>>(new Map());
  const [prvBal, setPrvBal] = useState<Map<string, number>>(new Map());
  const [curMovement, setCurMovement] = useState<Map<string, number>>(new Map());
  const [prvMovement, setPrvMovement] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [activeTab, setActiveTab] = useState("pl");

  useEffect(() => {
    (async () => {
      const [a, m, fy] = await Promise.all([
        supabase.from("chart_of_accounts").select("id, account_name, account_code, account_type, opening_balance, opening_balance_type"),
        supabase.from("ifrs_account_mapping").select("account_id, ifrs_line"),
        supabase.from("financial_years").select("id, name, start_date, end_date").order("start_date", { ascending: false }),
      ]);
      setAccounts((a.data || []) as Account[]);
      const om = new Map<string, IFRSLine>();
      (m.data || []).forEach((r: any) => om.set(r.account_id, r.ifrs_line));
      setOverrides(om);
      const fys = (fy.data || []) as any[];
      setFinancialYears(fys);
      // Auto-select active FY vs previous if available
      if (fys.length >= 2) {
        setCurFrom(fys[0].start_date); setCurTo(fys[0].end_date);
        setPrvFrom(fys[1].start_date); setPrvTo(fys[1].end_date);
        setPreset("fy_compare");
      } else if (fys.length === 1) {
        setCurFrom(fys[0].start_date); setCurTo(fys[0].end_date);
      }
    })();
  }, []);

  const applyPreset = (val: string) => {
    setPreset(val);
    const t = new Date();
    if (val === "fy_compare" && financialYears.length >= 2) {
      setCurFrom(financialYears[0].start_date); setCurTo(financialYears[0].end_date);
      setPrvFrom(financialYears[1].start_date); setPrvTo(financialYears[1].end_date);
    } else if (val === "last_12m") {
      const end = new Date(t); const start = new Date(t); start.setFullYear(start.getFullYear() - 1);
      const pEnd = new Date(start); pEnd.setDate(pEnd.getDate() - 1);
      const pStart = new Date(pEnd); pStart.setFullYear(pStart.getFullYear() - 1); pStart.setDate(pStart.getDate() + 1);
      setCurFrom(start.toISOString().slice(0, 10)); setCurTo(end.toISOString().slice(0, 10));
      setPrvFrom(pStart.toISOString().slice(0, 10)); setPrvTo(pEnd.toISOString().slice(0, 10));
    } else if (val === "ytd") {
      const start = new Date(t.getFullYear(), 0, 1);
      const pStart = new Date(t.getFullYear() - 1, 0, 1);
      const pEnd = new Date(t.getFullYear() - 1, t.getMonth(), t.getDate());
      setCurFrom(start.toISOString().slice(0, 10)); setCurTo(t.toISOString().slice(0, 10));
      setPrvFrom(pStart.toISOString().slice(0, 10)); setPrvTo(pEnd.toISOString().slice(0, 10));
    }
  };

  const getLine = (acc: Account): IFRSLine =>
    overrides.get(acc.id) || defaultMapping(acc.account_name, acc.account_type, acc.account_code);

  const fetchPeriod = async (from: string, to: string) => {
    // Balance at "to" date (cumulative since beginning incl. opening balance)
    // Movement during [from..to]
    const balMap = new Map<string, number>();
    const moveMap = new Map<string, number>();

    accounts.forEach(a => {
      balMap.set(a.id, signedOpeningBalance(a.opening_balance, a.opening_balance_type));
      moveMap.set(a.id, 0);
    });

    // All entries up to "to" (for balance)
    const { data: balRows } = await supabase
      .from("voucher_entries")
      .select("account_id, debit, credit, acc_vouchers!inner(status, voucher_date)")
      .eq("acc_vouchers.status", "approved")
      .lte("acc_vouchers.voucher_date", to);
    (balRows || []).forEach((e: any) => {
      balMap.set(e.account_id, (balMap.get(e.account_id) || 0) + Number(e.debit) - Number(e.credit));
    });

    // Entries during period (for P&L movement)
    const { data: mvRows } = await supabase
      .from("voucher_entries")
      .select("account_id, debit, credit, acc_vouchers!inner(status, voucher_date)")
      .eq("acc_vouchers.status", "approved")
      .gte("acc_vouchers.voucher_date", from)
      .lte("acc_vouchers.voucher_date", to);
    (mvRows || []).forEach((e: any) => {
      moveMap.set(e.account_id, (moveMap.get(e.account_id) || 0) + Number(e.debit) - Number(e.credit));
    });

    return { balMap, moveMap };
  };

  const generate = async () => {
    if (accounts.length === 0) return;
    setLoading(true);
    const [cur, prv] = await Promise.all([
      fetchPeriod(curFrom, curTo),
      fetchPeriod(prvFrom, prvTo),
    ]);
    setCurBal(cur.balMap); setCurMovement(cur.moveMap);
    setPrvBal(prv.balMap); setPrvMovement(prv.moveMap);
    setGenerated(true); setLoading(false);
  };

  // Build P&L lines: use movements with sign normalization
  // For income/other_income: amount = -movement (credit positive)
  // For expense lines: amount = movement (debit positive)
  const buildPLLines = (mv: Map<string, number>): Record<IFRSLine, LineRow> => {
    const out = {} as Record<IFRSLine, LineRow>;
    accounts.forEach(a => {
      const line = getLine(a);
      const isIncome = line === "revenue" || line === "other_income";
      const isPLExpense = ["cogs","admin_expense","selling_expense","financial_expense","tax_provision","deferred_tax"].includes(line);
      if (!isIncome && !isPLExpense) return;
      const raw = mv.get(a.id) || 0;
      const val = isIncome ? -raw : raw;
      if (!out[line]) out[line] = { line, label: IFRS_LINE_LABEL[line], accounts: [], total: 0 };
      out[line].accounts.push({ name: a.account_name, amount: val });
      out[line].total += val;
    });
    return out;
  };

  // Build BS lines from balances at period end with sign normalization
  // Assets debit positive; liabilities/equity credit positive (display as positive => -balance)
  const buildBSLines = (bal: Map<string, number>, plNet: number): Record<IFRSLine, LineRow> => {
    const out = {} as Record<IFRSLine, LineRow>;
    accounts.forEach(a => {
      const line = getLine(a);
      const isAsset = BS_SECTIONS.non_current_assets.includes(line) || BS_SECTIONS.current_assets.includes(line);
      const isLiab = BS_SECTIONS.non_current_liabilities.includes(line) || BS_SECTIONS.current_liabilities.includes(line);
      const isEq = BS_SECTIONS.equity.includes(line);
      if (!isAsset && !isLiab && !isEq) return;
      const raw = bal.get(a.id) || 0;
      const val = isAsset ? raw : -raw;
      if (!out[line]) out[line] = { line, label: IFRS_LINE_LABEL[line], accounts: [], total: 0 };
      out[line].accounts.push({ name: a.account_name, amount: val });
      out[line].total += val;
    });
    // Add Net Profit / (Loss) for the period into Retained Earnings line
    if (out["retained_earnings"]) {
      out["retained_earnings"].accounts.push({ name: "Net Profit/(Loss) for the period", amount: plNet });
      out["retained_earnings"].total += plNet;
    } else {
      out["retained_earnings"] = {
        line: "retained_earnings", label: IFRS_LINE_LABEL["retained_earnings"],
        accounts: [{ name: "Net Profit/(Loss) for the period", amount: plNet }], total: plNet,
      };
    }
    return out;
  };

  const data = useMemo(() => {
    if (!generated) return null;
    const plCur = buildPLLines(curMovement);
    const plPrv = buildPLLines(prvMovement);

    const sumLines = (m: Record<IFRSLine, LineRow>, lines: IFRSLine[]) =>
      lines.reduce((s, l) => s + (m[l]?.total || 0), 0);

    const compute = (m: Record<IFRSLine, LineRow>) => {
      const revenue = sumLines(m, PL_SECTIONS.revenue);
      const cogs = sumLines(m, PL_SECTIONS.cogs);
      const grossProfit = revenue - cogs;
      const admin = m["admin_expense"]?.total || 0;
      const selling = m["selling_expense"]?.total || 0;
      const finance = m["financial_expense"]?.total || 0;
      const opExpense = admin + selling + finance;
      const opProfit = grossProfit - opExpense;
      const otherInc = sumLines(m, PL_SECTIONS.other_income);
      const pbt = opProfit + otherInc;
      const tax = m["tax_provision"]?.total || 0;
      const defTax = m["deferred_tax"]?.total || 0;
      const netProfit = pbt - tax - defTax;
      return { revenue, cogs, grossProfit, admin, selling, finance, opExpense, opProfit, otherInc, pbt, tax, defTax, netProfit };
    };

    const pl = { cur: compute(plCur), prv: compute(plPrv), curMap: plCur, prvMap: plPrv };
    const bsCur = buildBSLines(curBal, pl.cur.netProfit);
    const bsPrv = buildBSLines(prvBal, pl.prv.netProfit);

    const bsTotals = (m: Record<IFRSLine, LineRow>) => ({
      ncAssets: sumLines(m, BS_SECTIONS.non_current_assets),
      cAssets: sumLines(m, BS_SECTIONS.current_assets),
      equity: sumLines(m, BS_SECTIONS.equity),
      ncLiab: sumLines(m, BS_SECTIONS.non_current_liabilities),
      cLiab: sumLines(m, BS_SECTIONS.current_liabilities),
    });
    const bs = {
      curMap: bsCur, prvMap: bsPrv,
      cur: bsTotals(bsCur), prv: bsTotals(bsPrv),
    };
    return { pl, bs };
  }, [generated, curMovement, prvMovement, curBal, prvBal, accounts, overrides]);

  const printRef = useMemo(() => ({ current: null as HTMLDivElement | null }), []);
  const handlePrint = (title: string) => {
    printReport({ current: printRef.current } as any, title, settings?.company_name, {
      address: settings?.address || undefined, phone: settings?.phone || undefined, email: settings?.email || undefined,
    });
  };

  // ─── Excel Export (all 5 statements as separate sheets) ──────
  const exportExcel = () => {
    if (!data) return;
    const { pl, bs } = data;
    const wb = XLSX.utils.book_new();
    const round = (n: number) => Math.round(n);

    // P&L Sheet
    const plRows: any[][] = [
      ["Particulars", `Current (${curFrom} to ${curTo})`, `Previous (${prvFrom} to ${prvTo})`],
      ["Revenue", round(pl.cur.revenue), round(pl.prv.revenue)],
      ["Less: Cost of Goods Sold", round(pl.cur.cogs), round(pl.prv.cogs)],
      ["Gross Profit", round(pl.cur.grossProfit), round(pl.prv.grossProfit)],
      [],
      ["Less: Administrative Expenses", round(pl.cur.admin), round(pl.prv.admin)],
      ["Less: Selling & Distribution Expenses", round(pl.cur.selling), round(pl.prv.selling)],
      ["Less: Financial Expenses", round(pl.cur.finance), round(pl.prv.finance)],
      ["Total Operating Expenses", round(pl.cur.opExpense), round(pl.prv.opExpense)],
      ["Operating Profit", round(pl.cur.opProfit), round(pl.prv.opProfit)],
      [],
      ["Add: Other Income", round(pl.cur.otherInc), round(pl.prv.otherInc)],
      ["Profit/(Loss) before Tax", round(pl.cur.pbt), round(pl.prv.pbt)],
      ["Less: Provision for Income Tax", round(pl.cur.tax), round(pl.prv.tax)],
      ["Deferred Tax (Expense)/Income", round(pl.cur.defTax), round(pl.prv.defTax)],
      ["Net Profit/(Loss) after Tax", round(pl.cur.netProfit), round(pl.prv.netProfit)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plRows), "P&L");

    // Balance Sheet
    const bsRows: any[][] = [["Particulars", `As at ${curTo}`, `As at ${prvTo}`], ["NON-CURRENT ASSETS"]];
    BS_SECTIONS.non_current_assets.forEach(l => {
      if (bs.curMap[l] || bs.prvMap[l]) bsRows.push([IFRS_LINE_LABEL[l], round(bs.curMap[l]?.total || 0), round(bs.prvMap[l]?.total || 0)]);
    });
    bsRows.push(["Total Non-Current Assets", round(bs.cur.ncAssets), round(bs.prv.ncAssets)], ["CURRENT ASSETS"]);
    BS_SECTIONS.current_assets.forEach(l => {
      if (bs.curMap[l] || bs.prvMap[l]) bsRows.push([IFRS_LINE_LABEL[l], round(bs.curMap[l]?.total || 0), round(bs.prvMap[l]?.total || 0)]);
    });
    bsRows.push(
      ["Total Current Assets", round(bs.cur.cAssets), round(bs.prv.cAssets)],
      ["TOTAL ASSETS", round(bs.cur.ncAssets + bs.cur.cAssets), round(bs.prv.ncAssets + bs.prv.cAssets)],
      [], ["EQUITY"]
    );
    BS_SECTIONS.equity.forEach(l => {
      if (bs.curMap[l] || bs.prvMap[l]) bsRows.push([IFRS_LINE_LABEL[l], round(bs.curMap[l]?.total || 0), round(bs.prvMap[l]?.total || 0)]);
    });
    bsRows.push(["Total Equity", round(bs.cur.equity), round(bs.prv.equity)], ["NON-CURRENT LIABILITIES"]);
    BS_SECTIONS.non_current_liabilities.forEach(l => {
      if (bs.curMap[l] || bs.prvMap[l]) bsRows.push([IFRS_LINE_LABEL[l], round(bs.curMap[l]?.total || 0), round(bs.prvMap[l]?.total || 0)]);
    });
    bsRows.push(["Total Non-Current Liabilities", round(bs.cur.ncLiab), round(bs.prv.ncLiab)], ["CURRENT LIABILITIES"]);
    BS_SECTIONS.current_liabilities.forEach(l => {
      if (bs.curMap[l] || bs.prvMap[l]) bsRows.push([IFRS_LINE_LABEL[l], round(bs.curMap[l]?.total || 0), round(bs.prvMap[l]?.total || 0)]);
    });
    bsRows.push(
      ["Total Current Liabilities", round(bs.cur.cLiab), round(bs.prv.cLiab)],
      ["TOTAL EQUITY & LIABILITIES", round(bs.cur.equity + bs.cur.ncLiab + bs.cur.cLiab), round(bs.prv.equity + bs.prv.ncLiab + bs.prv.cLiab)]
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bsRows), "Balance Sheet");

    // Equity
    const openShare = bs.prvMap["share_capital"]?.total || 0;
    const openRE = (bs.prvMap["retained_earnings"]?.total || 0) - pl.prv.netProfit;
    const openRev = bs.prvMap["revaluation_reserve"]?.total || 0;
    const closeShare = bs.curMap["share_capital"]?.total || 0;
    const closeRE = bs.curMap["retained_earnings"]?.total || 0;
    const closeRev = bs.curMap["revaluation_reserve"]?.total || 0;
    const eqRows = [
      ["Particulars", "Share Capital", "Retained Earnings", "Revaluation Reserve", "Total"],
      [`Opening Balance as on ${curFrom}`, round(openShare), round(openRE), round(openRev), round(openShare + openRE + openRev)],
      ["Net Profit/(Loss) for the year", 0, round(pl.cur.netProfit), 0, round(pl.cur.netProfit)],
      [`Closing Balance as on ${curTo}`, round(closeShare), round(closeRE), round(closeRev), round(closeShare + closeRE + closeRev)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(eqRows), "Equity Changes");

    // Cash Flow
    const chg = (l: IFRSLine) => (bs.curMap[l]?.total || 0) - (bs.prvMap[l]?.total || 0);
    const cfRows: any[][] = [
      ["Particulars", `${curFrom} to ${curTo}`],
      ["A. Cash Flow from Operating Activities"],
      ["Profit/(Loss) after tax", round(pl.cur.netProfit)],
      ["(Increase)/Decrease in Inventories", round(-chg("inventory"))],
      ["(Increase)/Decrease in Accounts Receivable", round(-chg("accounts_receivable"))],
      ["(Increase)/Decrease in Advance Income Tax", round(-chg("advance_income_tax"))],
      ["(Increase)/Decrease in Advance, Deposit & Prepayments", round(-chg("advance_deposit"))],
      ["Increase/(Decrease) in Accounts Payable", round(chg("accounts_payable"))],
      ["Increase/(Decrease) in Other Liabilities", round(chg("other_liability"))],
      ["Increase/(Decrease) in Provision for Income Tax", round(chg("provision_income_tax"))],
      ["Increase/(Decrease) in VAT Current Account", round(chg("vat_payable"))],
      ["B. Cash Flow from Investing Activities"],
      ["Acquisition of PPE", round(-chg("ppe"))],
      ["Acquisition of Intangible Assets", round(-chg("intangible_asset"))],
      ["C. Cash Flow from Financing Activities"],
      ["Long Term Loan movement", round(chg("long_term_loan"))],
      ["Short Term Loan movement", round(chg("short_term_loan"))],
      ["Share Capital Issue", round(chg("share_capital"))],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cfRows), "Cash Flow");

    // Notes
    const noteRows: any[][] = [["Note", "IFRS Line Item / Account", "Current", "Previous"]];
    const allLines: IFRSLine[] = [
      ...BS_SECTIONS.non_current_assets, ...BS_SECTIONS.current_assets,
      ...BS_SECTIONS.equity, ...BS_SECTIONS.non_current_liabilities, ...BS_SECTIONS.current_liabilities,
      "revenue", "cogs", "admin_expense", "selling_expense", "financial_expense", "other_income", "tax_provision", "deferred_tax",
    ];
    let n = 4;
    allLines.forEach(l => {
      const cur = bs.curMap[l] || pl.curMap[l];
      const prv = bs.prvMap[l] || pl.prvMap[l];
      if (!cur && !prv) return;
      noteRows.push([`${n}.00`, IFRS_LINE_LABEL[l], "", ""]);
      const names = new Set<string>();
      (cur?.accounts || []).forEach(a => names.add(a.name));
      (prv?.accounts || []).forEach(a => names.add(a.name));
      names.forEach(name => {
        noteRows.push([
          "", name,
          round(cur?.accounts.find(a => a.name === name)?.amount || 0),
          round(prv?.accounts.find(a => a.name === name)?.amount || 0),
        ]);
      });
      noteRows.push(["", "Total", round(cur?.total || 0), round(prv?.total || 0)]);
      n++;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(noteRows), "Notes");

    XLSX.writeFile(wb, `IFRS-Financial-Statements_${curFrom}_to_${curTo}.xlsx`);
  };

  // ─── Render helpers ────────────────────────────────────────
  const Row = ({ label, cur, prv, bold = false, total = false, indent = 0 }: { label: string; cur: number; prv: number; bold?: boolean; total?: boolean; indent?: number }) => (
    <tr className={total ? "border-t-2 border-foreground/60 font-bold" : bold ? "font-semibold" : ""}>
      <td className="py-1.5 px-2" style={{ paddingLeft: `${8 + indent * 16}px` }}>{label}</td>
      <td className="py-1.5 px-3 text-right tabular-nums">{fmt(cur)}</td>
      <td className="py-1.5 px-3 text-right tabular-nums">{fmt(prv)}</td>
    </tr>
  );

  const SectionHeader = ({ label }: { label: string }) => (
    <tr className="bg-primary/10"><td colSpan={3} className="py-1.5 px-2 font-bold text-primary uppercase tracking-wide text-xs">{label}</td></tr>
  );

  const renderPL = () => {
    if (!data) return null;
    const { pl } = data;
    return (
      <table className="w-full text-sm border border-border">
        <thead>
          <tr className="bg-muted">
            <th className="text-left py-2 px-2">Particulars</th>
            <th className="text-right py-2 px-3 w-44">Current Period<br/><span className="text-xs font-normal">{curFrom} to {curTo}</span></th>
            <th className="text-right py-2 px-3 w-44">Previous Period<br/><span className="text-xs font-normal">{prvFrom} to {prvTo}</span></th>
          </tr>
        </thead>
        <tbody>
          <Row label="Revenue" cur={pl.cur.revenue} prv={pl.prv.revenue} bold />
          <Row label="Less: Cost of Goods Sold" cur={pl.cur.cogs} prv={pl.prv.cogs} />
          <Row label="Gross Profit" cur={pl.cur.grossProfit} prv={pl.prv.grossProfit} total />
          <tr><td colSpan={3} className="py-2"></td></tr>
          <Row label="Less: Administrative Expenses" cur={pl.cur.admin} prv={pl.prv.admin} />
          <Row label="Less: Selling and Distribution Expenses" cur={pl.cur.selling} prv={pl.prv.selling} />
          <Row label="Less: Financial Expenses" cur={pl.cur.finance} prv={pl.prv.finance} />
          <Row label="Total Operating Expenses" cur={pl.cur.opExpense} prv={pl.prv.opExpense} bold />
          <Row label="Operating Profit" cur={pl.cur.opProfit} prv={pl.prv.opProfit} total />
          <tr><td colSpan={3} className="py-2"></td></tr>
          <Row label="Add: Other Income" cur={pl.cur.otherInc} prv={pl.prv.otherInc} />
          <Row label="Profit/(Loss) before Tax" cur={pl.cur.pbt} prv={pl.prv.pbt} total />
          <tr><td colSpan={3} className="py-2"></td></tr>
          <Row label="Less: Provision for Income Tax" cur={pl.cur.tax} prv={pl.prv.tax} />
          <Row label="Deferred Tax (Expense)/Income" cur={pl.cur.defTax} prv={pl.prv.defTax} />
          <Row label="Net Profit/(Loss) after Tax" cur={pl.cur.netProfit} prv={pl.prv.netProfit} total />
        </tbody>
      </table>
    );
  };

  const renderBSGroup = (
    m: Record<IFRSLine, LineRow>, pm: Record<IFRSLine, LineRow>, lines: IFRSLine[]
  ) => lines.filter(l => m[l] || pm[l]).map(l => (
    <Row key={l} label={IFRS_LINE_LABEL[l]} cur={m[l]?.total || 0} prv={pm[l]?.total || 0} />
  ));

  const renderBS = () => {
    if (!data) return null;
    const { bs } = data;
    return (
      <table className="w-full text-sm border border-border">
        <thead>
          <tr className="bg-muted">
            <th className="text-left py-2 px-2">Particulars</th>
            <th className="text-right py-2 px-3 w-44">As at {curTo}</th>
            <th className="text-right py-2 px-3 w-44">As at {prvTo}</th>
          </tr>
        </thead>
        <tbody>
          <SectionHeader label="Non-Current Assets" />
          {renderBSGroup(bs.curMap, bs.prvMap, BS_SECTIONS.non_current_assets)}
          <Row label="Total Non-Current Assets" cur={bs.cur.ncAssets} prv={bs.prv.ncAssets} bold />

          <SectionHeader label="Current Assets" />
          {renderBSGroup(bs.curMap, bs.prvMap, BS_SECTIONS.current_assets)}
          <Row label="Total Current Assets" cur={bs.cur.cAssets} prv={bs.prv.cAssets} bold />

          <Row label="TOTAL ASSETS" cur={bs.cur.ncAssets + bs.cur.cAssets} prv={bs.prv.ncAssets + bs.prv.cAssets} total />

          <SectionHeader label="Equity" />
          {renderBSGroup(bs.curMap, bs.prvMap, BS_SECTIONS.equity)}
          <Row label="Total Equity" cur={bs.cur.equity} prv={bs.prv.equity} bold />

          <SectionHeader label="Non-Current Liabilities" />
          {renderBSGroup(bs.curMap, bs.prvMap, BS_SECTIONS.non_current_liabilities)}
          <Row label="Total Non-Current Liabilities" cur={bs.cur.ncLiab} prv={bs.prv.ncLiab} bold />

          <SectionHeader label="Current Liabilities" />
          {renderBSGroup(bs.curMap, bs.prvMap, BS_SECTIONS.current_liabilities)}
          <Row label="Total Current Liabilities" cur={bs.cur.cLiab} prv={bs.prv.cLiab} bold />

          <Row label="TOTAL EQUITY & LIABILITIES" cur={bs.cur.equity + bs.cur.ncLiab + bs.cur.cLiab} prv={bs.prv.equity + bs.prv.ncLiab + bs.prv.cLiab} total />
        </tbody>
      </table>
    );
  };

  const renderEquity = () => {
    if (!data) return null;
    const { bs, pl } = data;
    const openShare = bs.prvMap["share_capital"]?.total || 0;
    const openRE = (bs.prvMap["retained_earnings"]?.total || 0) - pl.prv.netProfit; // remove current year movement that we added
    const openRev = bs.prvMap["revaluation_reserve"]?.total || 0;
    const closeShare = bs.curMap["share_capital"]?.total || 0;
    const closeRE = bs.curMap["retained_earnings"]?.total || 0;
    const closeRev = bs.curMap["revaluation_reserve"]?.total || 0;
    return (
      <table className="w-full text-sm border border-border">
        <thead>
          <tr className="bg-muted">
            <th className="text-left py-2 px-2">Particulars</th>
            <th className="text-right py-2 px-3">Share Capital</th>
            <th className="text-right py-2 px-3">Retained Earnings</th>
            <th className="text-right py-2 px-3">Revaluation Reserve</th>
            <th className="text-right py-2 px-3 font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-semibold"><td className="py-1.5 px-2">Opening Balance as on {curFrom}</td>
            <td className="text-right px-3 tabular-nums">{fmt(openShare)}</td>
            <td className="text-right px-3 tabular-nums">{fmt(openRE)}</td>
            <td className="text-right px-3 tabular-nums">{fmt(openRev)}</td>
            <td className="text-right px-3 tabular-nums">{fmt(openShare + openRE + openRev)}</td>
          </tr>
          <tr><td className="py-1.5 px-2">Net Profit/(Loss) for the year</td>
            <td className="text-right px-3">-</td>
            <td className="text-right px-3 tabular-nums">{fmt(pl.cur.netProfit)}</td>
            <td className="text-right px-3">-</td>
            <td className="text-right px-3 tabular-nums">{fmt(pl.cur.netProfit)}</td>
          </tr>
          <tr className="border-t-2 border-foreground/60 font-bold">
            <td className="py-1.5 px-2">Closing Balance as on {curTo}</td>
            <td className="text-right px-3 tabular-nums">{fmt(closeShare)}</td>
            <td className="text-right px-3 tabular-nums">{fmt(closeRE)}</td>
            <td className="text-right px-3 tabular-nums">{fmt(closeRev)}</td>
            <td className="text-right px-3 tabular-nums">{fmt(closeShare + closeRE + closeRev)}</td>
          </tr>
        </tbody>
      </table>
    );
  };

  const renderCashFlow = () => {
    if (!data) return null;
    const { bs, pl } = data;
    const chg = (l: IFRSLine) => (bs.curMap[l]?.total || 0) - (bs.prvMap[l]?.total || 0);
    // Operating
    const profitAfterTax = pl.cur.netProfit;
    const incInventory = -chg("inventory");
    const incReceivable = -chg("accounts_receivable");
    const incAdvTax = -chg("advance_income_tax");
    const incAdvDep = -chg("advance_deposit");
    const incPayable = chg("accounts_payable");
    const incOtherLiab = chg("other_liability");
    const incTaxProv = chg("provision_income_tax");
    const incVat = chg("vat_payable");
    const incDefTaxAsset = -chg("deferred_tax_asset");
    const incDefTaxLiab = chg("deferred_tax_liability");
    const wcChanges = incInventory + incReceivable + incAdvTax + incAdvDep + incPayable + incOtherLiab + incTaxProv + incVat + incDefTaxAsset + incDefTaxLiab;
    const netOp = profitAfterTax + wcChanges;
    // Investing
    const ppeChg = -chg("ppe");
    const intChg = -chg("intangible_asset");
    const netInv = ppeChg + intChg;
    // Financing
    const ltChg = chg("long_term_loan");
    const stChg = chg("short_term_loan");
    const eqChg = chg("share_capital");
    const netFin = ltChg + stChg + eqChg;
    const netChange = netOp + netInv + netFin;
    const cashEnd = bs.curMap["cash_bank"]?.total || 0;
    const cashStart = bs.prvMap["cash_bank"]?.total || 0;

    return (
      <table className="w-full text-sm border border-border">
        <thead>
          <tr className="bg-muted">
            <th className="text-left py-2 px-2">Particulars</th>
            <th className="text-right py-2 px-3 w-44">{curFrom} to {curTo}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-bold bg-muted/40"><td colSpan={2} className="py-1.5 px-2">A. Cash Flow from Operating Activities</td></tr>
          <tr><td className="py-1.5 px-2">Profit/(Loss) after tax</td><td className="text-right px-3 tabular-nums">{fmt(profitAfterTax)}</td></tr>
          <tr className="font-semibold"><td className="py-1.5 px-2 pl-6">Change in Working Capital</td><td></td></tr>
          <tr><td className="py-1.5 px-2 pl-8">(Increase)/Decrease in Inventories</td><td className="text-right px-3 tabular-nums">{fmt(incInventory)}</td></tr>
          <tr><td className="py-1.5 px-2 pl-8">(Increase)/Decrease in Accounts Receivable</td><td className="text-right px-3 tabular-nums">{fmt(incReceivable)}</td></tr>
          <tr><td className="py-1.5 px-2 pl-8">(Increase)/Decrease in Advance Income Tax</td><td className="text-right px-3 tabular-nums">{fmt(incAdvTax)}</td></tr>
          <tr><td className="py-1.5 px-2 pl-8">(Increase)/Decrease in Advance, Deposit & Prepayments</td><td className="text-right px-3 tabular-nums">{fmt(incAdvDep)}</td></tr>
          <tr><td className="py-1.5 px-2 pl-8">(Increase)/Decrease in Deferred Tax Assets</td><td className="text-right px-3 tabular-nums">{fmt(incDefTaxAsset)}</td></tr>
          <tr><td className="py-1.5 px-2 pl-8">Increase/(Decrease) in Accounts Payable</td><td className="text-right px-3 tabular-nums">{fmt(incPayable)}</td></tr>
          <tr><td className="py-1.5 px-2 pl-8">Increase/(Decrease) in Other Liabilities</td><td className="text-right px-3 tabular-nums">{fmt(incOtherLiab)}</td></tr>
          <tr><td className="py-1.5 px-2 pl-8">Increase/(Decrease) in Provision for Income Tax</td><td className="text-right px-3 tabular-nums">{fmt(incTaxProv)}</td></tr>
          <tr><td className="py-1.5 px-2 pl-8">Increase/(Decrease) in VAT Current Account</td><td className="text-right px-3 tabular-nums">{fmt(incVat)}</td></tr>
          <tr><td className="py-1.5 px-2 pl-8">Increase/(Decrease) in Deferred Tax Liability</td><td className="text-right px-3 tabular-nums">{fmt(incDefTaxLiab)}</td></tr>
          <tr className="border-t font-bold"><td className="py-1.5 px-2">Net cash flows from operating activities</td><td className="text-right px-3 tabular-nums">{fmt(netOp)}</td></tr>

          <tr className="font-bold bg-muted/40"><td colSpan={2} className="py-1.5 px-2">B. Cash Flow from Investing Activities</td></tr>
          <tr><td className="py-1.5 px-2">Acquisition of Property, Plant and Equipment</td><td className="text-right px-3 tabular-nums">{fmt(ppeChg)}</td></tr>
          <tr><td className="py-1.5 px-2">Acquisition of Intangible Assets</td><td className="text-right px-3 tabular-nums">{fmt(intChg)}</td></tr>
          <tr className="border-t font-bold"><td className="py-1.5 px-2">Net cash flows from investing activities</td><td className="text-right px-3 tabular-nums">{fmt(netInv)}</td></tr>

          <tr className="font-bold bg-muted/40"><td colSpan={2} className="py-1.5 px-2">C. Cash Flow from Financing Activities</td></tr>
          <tr><td className="py-1.5 px-2">Proceed from/(Repayment of) Long Term Loan</td><td className="text-right px-3 tabular-nums">{fmt(ltChg)}</td></tr>
          <tr><td className="py-1.5 px-2">Proceed from/(Repayment of) Short Term Loan</td><td className="text-right px-3 tabular-nums">{fmt(stChg)}</td></tr>
          <tr><td className="py-1.5 px-2">Share Capital Issue</td><td className="text-right px-3 tabular-nums">{fmt(eqChg)}</td></tr>
          <tr className="border-t font-bold"><td className="py-1.5 px-2">Net cash flow from financing activities</td><td className="text-right px-3 tabular-nums">{fmt(netFin)}</td></tr>

          <tr className="border-t-2 border-foreground/60 font-bold"><td className="py-1.5 px-2">D. Net (decrease)/increase in cash and cash equivalents (A+B+C)</td><td className="text-right px-3 tabular-nums">{fmt(netChange)}</td></tr>
          <tr><td className="py-1.5 px-2">E. Cash and cash equivalents at the beginning of the period</td><td className="text-right px-3 tabular-nums">{fmt(cashStart)}</td></tr>
          <tr className="border-t-2 border-foreground/60 font-bold"><td className="py-1.5 px-2">F. Cash and cash equivalents at the end of the period (D+E)</td><td className="text-right px-3 tabular-nums">{fmt(cashStart + netChange)}</td></tr>
          <tr className="text-xs text-muted-foreground"><td className="py-1.5 px-2">Reconciliation — Cash & Bank balance per Balance Sheet</td><td className="text-right px-3 tabular-nums">{fmt(cashEnd)}</td></tr>
        </tbody>
      </table>
    );
  };

  const renderNotes = () => {
    if (!data) return null;
    const { bs, pl } = data;
    const allLines: IFRSLine[] = [
      ...BS_SECTIONS.non_current_assets, ...BS_SECTIONS.current_assets,
      ...BS_SECTIONS.equity, ...BS_SECTIONS.non_current_liabilities, ...BS_SECTIONS.current_liabilities,
      "revenue","cogs","admin_expense","selling_expense","financial_expense","other_income","tax_provision","deferred_tax",
    ];
    let noteNum = 4;
    return (
      <div className="space-y-6">
        {allLines.filter(l => (bs.curMap[l] || bs.prvMap[l] || pl.curMap[l] || pl.prvMap[l])).map(l => {
          const cur = bs.curMap[l] || pl.curMap[l];
          const prv = bs.prvMap[l] || pl.prvMap[l];
          if (!cur && !prv) return null;
          const n = noteNum++;
          // Merge account lists from both periods
          const names = new Set<string>();
          (cur?.accounts || []).forEach(a => names.add(a.name));
          (prv?.accounts || []).forEach(a => names.add(a.name));
          const rows = Array.from(names).map(name => ({
            name,
            cur: cur?.accounts.find(a => a.name === name)?.amount || 0,
            prv: prv?.accounts.find(a => a.name === name)?.amount || 0,
          }));
          return (
            <div key={l} className="border border-border rounded">
              <div className="bg-muted px-3 py-2 font-semibold text-sm">
                {n}.00 &nbsp; {IFRS_LINE_LABEL[l]}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left py-1.5 px-3">Particulars</th>
                    <th className="text-right py-1.5 px-3 w-40">Current</th>
                    <th className="text-right py-1.5 px-3 w-40">Previous</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="py-1 px-3">{r.name}</td>
                      <td className="py-1 px-3 text-right tabular-nums">{fmt(r.cur)}</td>
                      <td className="py-1 px-3 text-right tabular-nums">{fmt(r.prv)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-foreground/40 font-bold">
                    <td className="py-1.5 px-3">Total</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmt(cur?.total || 0)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{fmt(prv?.total || 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-2">
        <FileText className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">IFRS Financial Statements</h1>
      </div>

      <Card><CardContent className="p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-2">
          <Label className="text-xs">Period Preset</Label>
          <Select value={preset} onValueChange={applyPreset}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">Custom Range</SelectItem>
              {financialYears.length >= 2 && (
                <SelectItem value="fy_compare">
                  {financialYears[0].name} vs {financialYears[1].name}
                </SelectItem>
              )}
              <SelectItem value="last_12m">Last 12 Months vs Prior 12 Months</SelectItem>
              <SelectItem value="ytd">YTD vs Same Period Last Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Current From</Label><Input type="date" value={curFrom} onChange={e => { setCurFrom(e.target.value); setPreset("custom"); }} /></div>
        <div><Label className="text-xs">Current To</Label><Input type="date" value={curTo} onChange={e => { setCurTo(e.target.value); setPreset("custom"); }} /></div>
        <div><Label className="text-xs">Previous From</Label><Input type="date" value={prvFrom} onChange={e => { setPrvFrom(e.target.value); setPreset("custom"); }} /></div>
        <div><Label className="text-xs">Previous To</Label><Input type="date" value={prvTo} onChange={e => { setPrvTo(e.target.value); setPreset("custom"); }} /></div>
        <Button onClick={generate} disabled={loading} className="md:col-span-6 md:w-auto md:justify-self-end">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Generate Report
        </Button>
      </CardContent></Card>

      {!generated ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          Click "Generate Report" to view Profit & Loss, Balance Sheet, Equity Changes, Cash Flow and Notes in IFRS comparative format.
        </CardContent></Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TabsList>
              <TabsTrigger value="pl">Profit & Loss</TabsTrigger>
              <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
              <TabsTrigger value="equity">Changes in Equity</TabsTrigger>
              <TabsTrigger value="cf">Cash Flow</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportExcel}>
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => handlePrint(`IFRS — ${activeTab.toUpperCase()}`)}>
                <Printer className="w-4 h-4 mr-1" /> Print / PDF
              </Button>
            </div>
          </div>

          <div ref={el => { (printRef as any).current = el; }} className="mt-3">
            <ReportHeader
              reportTitle={
                activeTab === "pl" ? "Statement of Profit or Loss and Other Comprehensive Income"
                : activeTab === "bs" ? "Statement of Financial Position"
                : activeTab === "equity" ? "Statement of Changes in Equity"
                : activeTab === "cf" ? "Statement of Cash Flows"
                : "Notes to the Financial Statements"
              }
              subtitle={`For the period ${curFrom} to ${curTo}`}
            />
            <Card><CardContent className="p-4">
              <TabsContent value="pl">{renderPL()}</TabsContent>
              <TabsContent value="bs">{renderBS()}</TabsContent>
              <TabsContent value="equity">{renderEquity()}</TabsContent>
              <TabsContent value="cf">{renderCashFlow()}</TabsContent>
              <TabsContent value="notes">{renderNotes()}</TabsContent>
            </CardContent></Card>
          </div>
        </Tabs>
      )}
    </div>
  );
};

export default IFRSFinancialStatements;
