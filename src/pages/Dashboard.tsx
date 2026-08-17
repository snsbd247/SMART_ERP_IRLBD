import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { signedOpeningBalance } from "@/lib/balance-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, Wallet, Landmark, PiggyBank, ShoppingCart,
  ArrowUpRight, ArrowDownRight, Minus, Clock, Users, Truck, Package,
  AlertTriangle, Receipt, CreditCard,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCurrency } from "@/contexts/CurrencyContext";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from "recharts";

interface MonthPoint {
  month: string;
  sales: number;
  purchases: number;
  income: number;
  expense: number;
  cashIn: number;
  cashOut: number;
}

interface Stats {
  totalSales: number;
  totalPurchases: number;
  totalIncome: number;
  totalExpenses: number;
  cashBalance: number;
  bankBalance: number;
  totalReceivable: number;
  totalPayable: number;
}

interface Counts {
  customers: number;
  suppliers: number;
  products: number;
  lowStock: number;
}

const COLORS = {
  sales: "hsl(142, 76%, 36%)",
  purchases: "hsl(38, 92%, 50%)",
  income: "hsl(221, 83%, 53%)",
  expense: "hsl(0, 84%, 60%)",
  cashIn: "hsl(142, 76%, 36%)",
  cashOut: "hsl(0, 84%, 60%)",
};

/** Compact, axis-free trend line for a stat card. Decorative — summarizes the
 *  metric's recent monthly shape, not a precise time series. */
function Sparkline({ data, dataKey, color }: { data: any[]; dataKey: string; color: string }) {
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.75} fill={`url(#spark-${dataKey})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"><Minus className="w-3 h-3" />No change</span>;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(pct).toFixed(1)}% from last month
    </span>
  );
}

const Dashboard = () => {
  const { profile, isSuperAdmin, hasPermission, user } = useAuth();
  const navigate = useNavigate();
  const { fc } = useCurrency();

  const [stats, setStats] = useState<Stats>({
    totalSales: 0, totalPurchases: 0, totalIncome: 0, totalExpenses: 0,
    cashBalance: 0, bankBalance: 0, totalReceivable: 0, totalPayable: 0,
  });
  const [counts, setCounts] = useState<Counts>({ customers: 0, suppliers: 0, products: 0, lowStock: 0 });
  const [monthly, setMonthly] = useState<MonthPoint[]>([]);
  const [recentVouchers, setRecentVouchers] = useState<any[]>([]);
  const [topExpenses, setTopExpenses] = useState<{ name: string; amount: number }[]>([]);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [checkedRedirect, setCheckedRedirect] = useState(false);

  useEffect(() => {
    if (!user || checkedRedirect) return;
    const isEmployeeOnly = !isSuperAdmin && !hasPermission("accounts.view") && !hasPermission("sales.view") && !hasPermission("settings.view");
    if (isEmployeeOnly) {
      (async () => {
        const { data } = await supabase.from("employees").select("id").eq("user_id", user.id).maybeSingle();
        if (data) navigate("/portal/dashboard", { replace: true });
        setCheckedRedirect(true);
      })();
    } else {
      setCheckedRedirect(true);
    }
  }, [user, isSuperAdmin, hasPermission, checkedRedirect, navigate]);

  useEffect(() => { loadDashboardData(); }, []);

  const loadDashboardData = async () => {
    // Fired as a handful of small, staged batches rather than one big burst —
    // the shared host's PHP-FPM pool intermittently drops/empties responses
    // when 10+ requests land at once. Each promise is settled independently
    // so one slow/failed query degrades gracefully instead of blanking the
    // whole dashboard.
    const settle = async <T,>(p: PromiseLike<T>, label: string): Promise<T | null> => {
      try {
        return await p;
      } catch (err) {
        console.error(`[dashboard] ${label} failed`, err);
        return null;
      }
    };

    const [salesV1Res, salesV2Res, billsV2Res, voucherRes, coaRes] = await Promise.all([
      settle(supabase.from("sales_invoices").select("total_amount, net_amount, invoice_date"), "sales_invoices"),
      settle(supabase.from("sales_invoices_v2").select("grand_total, invoice_date"), "sales_invoices_v2"),
      settle(supabase.from("supplier_bills_v2").select("grand_total, bill_date"), "supplier_bills_v2"),
      settle(supabase.from("acc_vouchers").select("id, voucher_type, voucher_date, total_amount, status").neq("status", "cancelled"), "acc_vouchers"),
      settle(supabase.from("chart_of_accounts").select("id, account_name, account_type, opening_balance, opening_balance_type"), "chart_of_accounts"),
    ]);

    const salesV1 = ((salesV1Res as any)?.data || []).map((s: any) => ({ amount: Number(s.net_amount ?? s.total_amount ?? 0), date: s.invoice_date }));
    const salesV2 = ((salesV2Res as any)?.data || []).map((s: any) => ({ amount: Number(s.grand_total ?? 0), date: s.invoice_date }));
    const sales = [...salesV1, ...salesV2];
    const purchases = ((billsV2Res as any)?.data || []).map((b: any) => ({ amount: Number(b.grand_total) || 0, date: b.bill_date }));
    const vouchers = (voucherRes as any)?.data || [];
    const coa = (coaRes as any)?.data || [];

    const totalSales = sales.reduce((s, r) => s + r.amount, 0);
    const totalPurchases = purchases.reduce((s, r) => s + r.amount, 0);
    const receiptVouchers = vouchers.filter((v: any) => v.voucher_type === "receipt");
    const paymentVouchers = vouchers.filter((v: any) => v.voucher_type === "payment");
    const totalReceiptAmt = receiptVouchers.reduce((s, v: any) => s + Number(v.total_amount || 0), 0);
    const totalPaymentAmt = paymentVouchers.reduce((s, v: any) => s + Number(v.total_amount || 0), 0);
    const totalIncome = totalSales + totalReceiptAmt;
    const totalExpenses = totalPurchases + totalPaymentAmt;

    // Cash & Bank balances from CoA + voucher_entries
    const cashAccountIds = coa.filter((a: any) => /cash/i.test(a.account_name || "")).map((a: any) => a.id);
    const bankAccountIds = coa.filter((a: any) => /bank/i.test(a.account_name || "")).map((a: any) => a.id);
    const accountIds = [...new Set([...cashAccountIds, ...bankAccountIds])];

    let cashBalance = 0;
    let bankBalance = 0;
    let entries: any[] = [];
    if (accountIds.length > 0) {
      const validVoucherIds = new Set(vouchers.map((v: any) => v.id));
      const entryRes = await settle(supabase.from("voucher_entries").select("account_id, debit, credit, voucher_id").in("account_id", accountIds), "voucher_entries (cash/bank)");
      entries = ((entryRes as any)?.data || []).filter((e: any) => validVoucherIds.has(e.voucher_id));
      const sumFor = (ids: string[]) => entries.filter((e: any) => ids.includes(e.account_id)).reduce((s: number, e: any) => s + (Number(e.debit || 0) - Number(e.credit || 0)), 0);
      const openingFor = (ids: string[]) => coa.filter((a: any) => ids.includes(a.id)).reduce((s: number, a: any) => s + signedOpeningBalance(a.opening_balance, a.opening_balance_type), 0);
      cashBalance = openingFor(cashAccountIds) + sumFor(cashAccountIds);
      bankBalance = openingFor(bankAccountIds) + sumFor(bankAccountIds);
    } else {
      cashBalance = totalIncome - totalExpenses;
    }

    // Top expense categories this month — debit side of this month's payment vouchers, excluding cash/bank.
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();
    // Parse the "YYYY-MM-DD" string's own components rather than new Date(d),
    // which reads it as UTC midnight — comparing that against a local-time
    // "now" can shift the date to the wrong day/month near month boundaries.
    const inMonth = (d: string) => { const [y, m] = d.split("-").map(Number); return m - 1 === curMonth && y === curYear; };
    const monthPaymentIds = new Set<string>(paymentVouchers.filter((v: any) => v.voucher_date && inMonth(v.voucher_date)).map((v: any) => v.id));
    let paymentEntries: any[] = [];
    if (monthPaymentIds.size > 0) {
      const peRes = await settle(supabase.from("voucher_entries").select("account_id, debit, credit, voucher_id").in("voucher_id", Array.from(monthPaymentIds)), "voucher_entries (top expenses)");
      paymentEntries = (peRes as any)?.data || [];
    }
    const coaNameMap = new Map<string, string>(coa.map((a: any) => [a.id, a.account_name]));
    const cashBankSet = new Set(accountIds);
    const expenseTotals = new Map<string, number>();
    paymentEntries.forEach((e: any) => {
      if (cashBankSet.has(e.account_id)) return;
      // This system posts payment vouchers as Dr Cash/Bank, Cr the expense
      // account — so the expense side is the credit leg, not the debit leg.
      const amt = Number(e.credit || 0) || Number(e.debit || 0);
      if (amt <= 0) return;
      expenseTotals.set(e.account_id, (expenseTotals.get(e.account_id) || 0) + amt);
    });
    const topExp = Array.from(expenseTotals.entries())
      .map(([id, amount]) => ({ name: coaNameMap.get(id) || "Other", amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    setTopExpenses(topExp);

    // Monthly series for the current calendar year (sales, purchases, income, expense, cash in/out).
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyData: MonthPoint[] = months.map((m, i) => {
      const inM = (d: string) => { const [y, m] = d.split("-").map(Number); return m - 1 === i && y === curYear; };
      const mSales = sales.filter((s) => s.date && inM(s.date)).reduce((a, b) => a + b.amount, 0);
      const mPurchases = purchases.filter((p) => p.date && inM(p.date)).reduce((a, b) => a + b.amount, 0);
      const mReceipts = receiptVouchers.filter((v: any) => v.voucher_date && inM(v.voucher_date)).reduce((a, v: any) => a + Number(v.total_amount || 0), 0);
      const mPayments = paymentVouchers.filter((v: any) => v.voucher_date && inM(v.voucher_date)).reduce((a, v: any) => a + Number(v.total_amount || 0), 0);
      return { month: m, sales: mSales, purchases: mPurchases, income: mSales + mReceipts, expense: mPurchases + mPayments, cashIn: mReceipts, cashOut: mPayments };
    });
    setMonthly(monthlyData);

    setStats({
      totalSales, totalPurchases, totalIncome, totalExpenses,
      cashBalance, bankBalance,
      totalReceivable: 0, totalPayable: 0,
    });

    // Second batch: recent lists, shown below the fold, staged after the
    // first batch finishes so we never hold 10+ requests open at once.
    const [auditRes, recentVoucherRes, paymentRowsRes] = await Promise.all([
      settle(supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(6), "audit_log"),
      settle(supabase.from("acc_vouchers").select("id, voucher_number, voucher_type, voucher_date, description, total_amount, status").order("created_at", { ascending: false }).limit(5), "recent acc_vouchers"),
      settle(supabase.from("party_payments").select("amount, party_type"), "party_payments"),
    ]);
    setRecentActivities((auditRes as any)?.data || []);
    setRecentVouchers((recentVoucherRes as any)?.data || []);

    // Receivable/payable: sales/purchases not yet covered by customer/supplier payments.
    const paymentRows = (paymentRowsRes as any)?.data || [];
    const customerPayments = paymentRows.filter((p: any) => p.party_type === "customer").reduce((s: number, p: any) => s + Number(p.amount), 0);
    const supplierPayments = paymentRows.filter((p: any) => p.party_type === "supplier").reduce((s: number, p: any) => s + Number(p.amount), 0);
    setStats((prev) => ({
      ...prev,
      totalReceivable: Math.max(0, totalSales - customerPayments),
      totalPayable: Math.max(0, totalPurchases - supplierPayments),
    }));

    // Third batch: bottom stat strip (customers/suppliers/products/low-stock).
    const [customersRes, suppliersRes, itemsRes, movementsRes] = await Promise.all([
      settle(supabase.from("customers").select("id"), "customers count"),
      settle(supabase.from("suppliers").select("id"), "suppliers count"),
      settle(supabase.from("item_master").select("id, min_stock_level").eq("status", "active"), "item_master"),
      settle(supabase.from("stock_movements").select("product_id, quantity"), "stock_movements"),
    ]);

    // Low-stock count mirrors LowStockPage's logic (current qty <= min_stock_level).
    const stockMap: Record<string, number> = {};
    ((movementsRes as any)?.data || []).forEach((m: any) => { stockMap[m.product_id] = (stockMap[m.product_id] || 0) + Number(m.quantity); });
    const items = (itemsRes as any)?.data || [];
    const lowStock = items.filter((p: any) => (stockMap[p.id] || 0) <= Number(p.min_stock_level || 0)).length;

    setCounts({
      customers: ((customersRes as any)?.data || []).length,
      suppliers: ((suppliersRes as any)?.data || []).length,
      products: items.length,
      lowStock,
    });
  };

  const now = new Date();
  const curMonthIdx = now.getMonth();
  const prevMonthIdx = (curMonthIdx + 11) % 12;
  const pctChange = (key: keyof MonthPoint): number | null => {
    const cur = monthly[curMonthIdx]?.[key] as number | undefined;
    const prev = monthly[prevMonthIdx]?.[key] as number | undefined;
    if (cur === undefined || prev === undefined || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  };
  const spark6 = monthly.length ? [...monthly.slice(curMonthIdx - 5 < 0 ? 0 : curMonthIdx - 5, curMonthIdx + 1)] : [];

  const statCards = [
    { label: "Total Sales", value: stats.totalSales, icon: TrendingUp, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", spark: "sales", pct: pctChange("sales") },
    { label: "Total Purchases", value: stats.totalPurchases, icon: ShoppingCart, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", spark: "purchases", pct: pctChange("purchases") },
    { label: "Total Income", value: stats.totalIncome, icon: Wallet, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10", spark: "income", pct: pctChange("income") },
    { label: "Total Expenses", value: stats.totalExpenses, icon: TrendingDown, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10", spark: "expense", pct: pctChange("expense") },
    { label: "Cash Balance", value: stats.cashBalance, icon: PiggyBank, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/10", spark: null, pct: null },
    { label: "Bank Balance", value: stats.bankBalance, icon: Landmark, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", spark: null, pct: null },
  ];

  const bottomStats = [
    { label: "Customers", value: counts.customers, icon: Users, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10" },
    { label: "Suppliers", value: counts.suppliers, icon: Truck, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10" },
    { label: "Products", value: counts.products, icon: Package, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Low Stock Items", value: counts.lowStock, icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
    { label: "Due Receivable", value: stats.totalReceivable, icon: ArrowDownRight, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", money: true },
    { label: "Due Payable", value: stats.totalPayable, icon: ArrowUpRight, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10", money: true },
  ];

  const incomeExpensePie = [
    { name: "Income", value: stats.totalIncome },
    { name: "Expenses", value: stats.totalExpenses },
  ];
  const pieColors = [COLORS.income, COLORS.expense];
  const totalIE = stats.totalIncome + stats.totalExpenses;

  const totalCashIn = monthly.reduce((s, m) => s + m.cashIn, 0);
  const totalCashOut = monthly.reduce((s, m) => s + m.cashOut, 0);

  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  const typeBadgeStyle: Record<string, string> = {
    journal: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    payment: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
    receipt: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    contra: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  };
  const typeBadgePrefix: Record<string, string> = { journal: "JV", payment: "PV", receipt: "RV", contra: "CV" };
  const statusStyle: Record<string, string> = {
    approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    draft: "bg-muted text-muted-foreground",
    rejected: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  };

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[1700px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">{greeting}, {profile?.name || "there"}! 👋</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Here's what's happening with your business today.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((card) => (
          <Card key={card.label} className="rounded-xl border-border/60 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
            <CardContent className="p-4">
              <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${card.bg} mb-3`}>
                <card.icon className={`w-4.5 h-4.5 ${card.color}`} />
              </div>
              <p className="text-base sm:text-lg font-bold text-foreground tabular-nums leading-tight break-words" title={fc(card.value)}>{fc(card.value)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.label}</p>
              <div className="mt-1.5"><ChangeBadge pct={card.pct} /></div>
              {card.spark && spark6.length > 1 && (
                <div className="mt-2 -mx-1">
                  <Sparkline data={spark6} dataKey={card.spark} color={(COLORS as any)[card.spark] || COLORS.income} />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="rounded-xl border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Sales vs Purchases</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={monthly} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={50} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fc(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sales" name="Sales" fill={COLORS.sales} radius={[3, 3, 0, 0]} />
                <Bar dataKey="purchases" name="Purchases" fill={COLORS.purchases} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Income vs Expenses</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {totalIE === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">No data yet</p>
            ) : (
              <div className="relative">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={incomeExpensePie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={82} paddingAngle={2}>
                      {incomeExpensePie.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fc(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 top-0 flex flex-col items-center justify-center pointer-events-none" style={{ height: 200 }}>
                  <p className="text-lg font-bold text-foreground tabular-nums">{fc(totalIE)}</p>
                  <p className="text-[10px] text-muted-foreground">Total</p>
                </div>
                <div className="flex justify-center gap-6 mt-2">
                  {incomeExpensePie.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full" style={{ background: pieColors[i] }} />
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="font-medium tabular-nums">{totalIE ? Math.round((d.value / totalIE) * 100) : 0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Cash Flow Overview</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={monthly}>
                <defs>
                  <linearGradient id="cashInGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.cashIn} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.cashIn} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cashOutGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.cashOut} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.cashOut} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={50} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => fc(v)} />
                <Area type="monotone" dataKey="cashIn" name="Cash In" stroke={COLORS.cashIn} fill="url(#cashInGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="cashOut" name="Cash Out" stroke={COLORS.cashOut} fill="url(#cashOutGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">Total Cash In</p>
                <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fc(totalCashIn)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Total Cash Out</p>
                <p className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">{fc(totalCashOut)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Net Cash Flow</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">{fc(totalCashIn - totalCashOut)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lists row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="rounded-xl border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Recent Vouchers</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate("/accounts/vouchers")}>View All</Button>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {recentVouchers.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No vouchers yet</p>
            ) : (
              <div className="space-y-1">
                {recentVouchers.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 py-2 border-b border-border/50 last:border-0 cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1" onClick={() => navigate("/accounts/vouchers")}>
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0 ${typeBadgeStyle[v.voucher_type] || "bg-muted text-muted-foreground"}`}>
                        {typeBadgePrefix[v.voucher_type] || "V"}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate font-mono">{v.voucher_number}</p>
                        <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{v.description || "—"}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold tabular-nums text-foreground">{fc(Number(v.total_amount || 0))}</p>
                      <span className={`inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full capitalize ${statusStyle[v.status] || statusStyle.draft}`}>{v.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Top Expenses This Month</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate("/reports/financial")}>View All</Button>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {topExpenses.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No expenses recorded this month</p>
            ) : (
              <div className="space-y-3">
                {topExpenses.map((e, i) => {
                  const max = topExpenses[0].amount || 1;
                  const pct = Math.round((e.amount / (topExpenses.reduce((s, x) => s + x.amount, 0) || 1)) * 100);
                  const barColors = ["#7c3aed", "#2563eb", "#f59e0b", "#059669", "#e11d48"];
                  return (
                    <div key={e.name} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center" style={{ background: `${barColors[i % barColors.length]}1a` }}>
                        <Receipt className="w-4 h-4" style={{ color: barColors[i % barColors.length] }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-foreground truncate">{e.name}</p>
                          <p className="text-xs font-semibold tabular-nums shrink-0">{fc(e.amount)}</p>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(4, (e.amount / max) * 100)}%`, background: barColors[i % barColors.length] }} />
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground w-9 text-right shrink-0">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-muted-foreground" /> Recent Activities</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate("/accounts/audit-log")}>View All</Button>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {recentActivities.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No recent activities</p>
            ) : (
              <div className="space-y-3">
                {recentActivities.map((a) => (
                  <div key={a.id} className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <CreditCard className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground leading-snug">
                        <span className="font-medium">{a.user_name || "System"}</span>{" "}{a.action}{" "}
                        <span className="text-muted-foreground">in {a.module}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(a.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {bottomStats.map((s) => (
          <Card key={s.label} className="rounded-xl border-border/60 shadow-sm">
            <CardContent className="p-3.5 flex items-center gap-3">
              <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${s.bg} shrink-0`}>
                <s.icon className={`w-4.5 h-4.5 ${s.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground tabular-nums break-words leading-tight" title={s.money ? fc(s.value) : String(s.value)}>{s.money ? fc(s.value) : s.value.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground truncate">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isSuperAdmin && (
        <Card className="border-primary/20 bg-primary/5 rounded-xl">
          <CardContent className="p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-foreground font-medium">Super Admin</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">You have global access to all branches, reports, and transactions.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;
