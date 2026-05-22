import { useEffect, useState } from "react";
import { swReports, exportCsv } from "@/lib/sales-workflow-reports";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell, FilterBar, useCustomers } from "./_shared";

export default function InvoicePendingReport() {
  const customers = useCustomers();
  const [filters, setFilters] = useState({ from: "", to: "", customer_id: "", status: "" });
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { swReports.invoicePending(filters).then(({ data }) => setRows(data || [])); }, [filters]);

  const flat = rows.map((r) => ({
    invoice_number: r.invoice_number, invoice_date: r.invoice_date, customer: r.customer?.name,
    grand_total: r.grand_total, paid: r.paid_amount, tds: r.tds_amount, due: r.due_amount,
  }));
  const totalDue = flat.reduce((s, r) => s + Number(r.due), 0);

  return (
    <ReportShell title="Pending Invoices (Outstanding)" filters={filters} onExport={() => exportCsv("invoice-pending.csv", flat, ["invoice_number","invoice_date","customer","grand_total","paid","tds","due"])}>
      <FilterBar filters={filters} setFilters={setFilters} customers={customers} />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">TDS</TableHead><TableHead className="text-right">Due</TableHead></TableRow></TableHeader>
          <TableBody>
            {flat.map((r, i) => (
              <TableRow key={i}><TableCell>{r.invoice_number}</TableCell><TableCell>{r.invoice_date}</TableCell><TableCell>{r.customer}</TableCell><TableCell className="text-right">{(+r.grand_total).toFixed(2)}</TableCell><TableCell className="text-right">{(+r.paid).toFixed(2)}</TableCell><TableCell className="text-right">{(+r.tds).toFixed(2)}</TableCell><TableCell className="text-right font-semibold text-primary">{(+r.due).toFixed(2)}</TableCell></TableRow>
            ))}
            {flat.length > 0 && <TableRow className="font-bold bg-muted/50"><TableCell colSpan={6}>Total Outstanding</TableCell><TableCell className="text-right">{totalDue.toFixed(2)}</TableCell></TableRow>}
            {flat.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No outstanding invoices</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
