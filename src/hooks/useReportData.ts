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
      const containsToday = activeYears.find(
        (fy) => fy.start_date && fy.end_date && fy.start_date <= today && fy.end_date >= today,
      );
      // Prefer FY containing today, else the latest active FY by start_date.
      const chosen = containsToday
        ?? [...activeYears].sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""))[0];
      if (chosen?.start_date && chosen?.end_date) {
        setDateFrom(chosen.start_date);
        setDateTo(chosen.end_date);
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
