import { useEffect, useState, ReactNode } from "react";
import { dataClient } from "@/integrations/data/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { ReportPrintFooter } from "@/components/reports/ReportPrintFooter";

import { DateInput } from "@/components/ui/date-input";
export function ReportShell({
  title, filters, children, onExport, showCustomer = true, showStatus = false, statusOptions = [],
}: {
  title: string;
  filters: { from: string; to: string; customer_id: string; status: string };
  children: ReactNode;
  onExport?: () => void;
  showCustomer?: boolean;
  showStatus?: boolean;
  statusOptions?: string[];
}) {
  return (
    <div className="p-6 space-y-4 print:p-0">
      <div className="flex justify-between items-center print:hidden">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="flex gap-2">
          {onExport && <Button size="sm" variant="outline" onClick={onExport}><Download className="w-4 h-4 mr-1" />CSV</Button>}
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
        </div>
      </div>
      {children}
      <ReportPrintFooter />
    </div>
  );
}

export function FilterBar({
  filters, setFilters, customers, showCustomer = true, showStatus = false, statusOptions = [],
}: any) {
  return (
    <Card className="p-4 flex gap-2 flex-wrap items-end print:hidden">
      <div><label className="text-xs">From</label><DateInput value={filters.from} onChange={(v) => setFilters({ ...filters, from: v })} /></div>
      <div><label className="text-xs">To</label><DateInput value={filters.to} onChange={(v) => setFilters({ ...filters, to: v })} /></div>
      {showCustomer && <div>
        <label className="text-xs">Customer</label>
        <select className="block border rounded px-2 h-10 bg-background" value={filters.customer_id} onChange={(e) => setFilters({ ...filters, customer_id: e.target.value })}>
          <option value="">All</option>{customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>}
      {showStatus && <div>
        <label className="text-xs">Status</label>
        <select className="block border rounded px-2 h-10 bg-background" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All</option>{statusOptions.map((s: string) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>}
    </Card>
  );
}

export function useCustomers() {
  const [customers, setCustomers] = useState<any[]>([]);
  useEffect(() => { dataClient.from("customers").select("id,name").order("name").then(({ data }) => setCustomers(data || [])); }, []);
  return customers;
}
