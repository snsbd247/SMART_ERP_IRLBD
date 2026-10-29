import { useEffect, useState, useRef, useCallback } from "react";
import { dataClient } from "@/integrations/data/client";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useAuth } from "@/contexts/AuthContext";
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

export function useReportData() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const { fc } = useCurrency();
  const { settings } = useCompanySettings();
  const { profile } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);

  // Default date range: the current running month, so a report opens already
  // scoped to "this month" instead of an empty or all-time range.
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const monthEnd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`;
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(monthEnd);
  const [branch, setBranch] = useState("all");

  useEffect(() => {
    const init = async () => {
      const [aRes, bRes] = await Promise.all([
        dataClient.from("chart_of_accounts").select("*").order("account_code"),
        dataClient.from("branches").select("id, name"),
      ]);
      setAccounts((aRes.data || []) as Account[]);
      setBranches((bRes.data || []) as Branch[]);
    };
    init();
  }, []);

  const handlePrint = useCallback(
    (title: string) => {
      printReport(printRef, title, settings?.company_name, {
        address: settings?.address || undefined,
        phone: settings?.phone || undefined,
        email: settings?.email || undefined,
      }, {
        dateFrom, dateTo, printedUser: profile?.name || undefined,
      });
    },
    [settings, dateFrom, dateTo, profile]
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
