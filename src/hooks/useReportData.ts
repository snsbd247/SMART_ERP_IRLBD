import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { exportToExcel, printReport, type ReportColumn } from "@/lib/report-utils";

interface Account {
  id: string;
  account_name: string;
  account_code: string;
  account_type: string;
  opening_balance: number;
  opening_balance_type: string;
  parent_id: string | null;
}

interface Branch {
  id: string;
  name: string;
}

interface FinancialYear {
  start_date: string;
  end_date: string;
}

export function useReportData() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const { fc } = useCurrency();
  const { settings } = useCompanySettings();
  const printRef = useRef<HTMLDivElement>(null);

  // Default date range: current financial year or current month
  const now = new Date();
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-01-01`);
  const [dateTo, setDateTo] = useState(now.toISOString().slice(0, 10));
  const [branch, setBranch] = useState("all");

  useEffect(() => {
    const init = async () => {
      const [aRes, bRes, fyRes] = await Promise.all([
        supabase.from("chart_of_accounts").select("*").order("account_code"),
        supabase.from("branches").select("id, name"),
        // Fetch ALL active FYs — multiple can coexist (e.g. after auto-provisioning
        // a new year). Pick the one containing today so the default range shows
        // the period the user is actually operating in.
        supabase.from("financial_years").select("start_date, end_date").eq("is_active", true),
      ]);
      setAccounts((aRes.data || []) as Account[]);
      setBranches((bRes.data || []) as Branch[]);
      const activeYears = (fyRes.data || []) as FinancialYear[];
      const today = new Date().toISOString().slice(0, 10);
      const sortedByStart = [...activeYears].sort((a, b) =>
        (a.start_date || "").localeCompare(b.start_date || ""),
      );
      const containsToday = sortedByStart.find(
        (fy) => fy.start_date && fy.end_date && fy.start_date <= today && fy.end_date >= today,
      );
      // Default range: from the earliest active FY start to the end of the FY
      // that contains today (or the latest active FY). Covers users who keep
      // last year still active while the new year is running so the report
      // isn't empty on first open.
      const from = sortedByStart[0]?.start_date;
      const latestEnd = (containsToday ?? sortedByStart[sortedByStart.length - 1])?.end_date;
      if (from && latestEnd) {
        setDateFrom(from);
        setDateTo(latestEnd);
      }
    };
    init();
  }, []);

  const handlePrint = useCallback(
    (title: string) => {
      printReport(printRef, title, settings?.company_name, {
        address: settings?.address || undefined,
        phone: settings?.phone || undefined,
        email: settings?.email || undefined,
      });
    },
    [settings]
  );

  const handleExportExcel = useCallback(
    (data: Record<string, unknown>[], columns: ReportColumn[], filename: string) => {
      exportToExcel(data, columns, filename);
    },
    []
  );

  const handleExportPDF = useCallback(
    (title: string) => {
      handlePrint(title);
    },
    [handlePrint]
  );

  return {
    accounts,
    branches,
    loading,
    setLoading,
    fc,
    settings,
    printRef,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    branch,
    setBranch,
    handlePrint,
    handleExportExcel,
    handleExportPDF,
  };
}
