import { useEffect, useState } from "react";
import { swReports, exportCsv } from "@/lib/sales-workflow-reports";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ReportShell, FilterBar, useCustomers } from "./_shared";

const STATUSES = ["issued", "delivered", "customer_received", "sent_to_ho", "ho_received", "invoiced"];

export default function ChallanStatusReport() {
  const customers = useCustomers();
  const [filters, setFilters] = useState({ from: "", to: "", customer_id: "", status: "" });
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { swReports.challanStatus(filters).then(({ data }) => setRows(data || [])); }, [filters]);

  const flat = rows.map((r) => ({
    dc_number: r.dc_number, dc_date: r.dc_date, vat_challan: r.vat_challan?.challan_number,
    customer: r.customer?.name, product: r.product?.name, qty: r.qty, status: r.status,
  }));

  return (
    <ReportShell title="Challan Status Tracker" filters={filters} onExport={() => exportCsv("challan-status.csv", flat, ["dc_number","dc_date","vat_challan","customer","product","qty","status"])}>
      <FilterBar filters={filters} setFilters={setFilters} customers={customers} showStatus statusOptions={STATUSES} />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>DC</TableHead><TableHead>Date</TableHead><TableHead>VAT Ch.</TableHead><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {flat.map((r, i) => (
              <TableRow key={i}><TableCell>{r.dc_number}</TableCell><TableCell>{r.dc_date}</TableCell><TableCell>{r.vat_challan}</TableCell><TableCell>{r.customer}</TableCell><TableCell>{r.product}</TableCell><TableCell>{r.qty}</TableCell><TableCell><Badge variant="secondary">{r.status}</Badge></TableCell></TableRow>
            ))}
            {flat.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No data</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
