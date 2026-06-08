import { useEffect, useState } from "react";
import { swReports, exportCsv } from "@/lib/sales-workflow-reports";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ReportShell, FilterBar, useCustomers } from "./_shared";

export default function InvoiceRegisterReport() {
  const customers = useCustomers();
  const [filters, setFilters] = useState({ from: "", to: "", customer_id: "", status: "" });
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { swReports.invoiceRegister(filters).then(({ data }) => setRows(data || [])); }, [filters]);

  const flat = rows.map((r) => ({
    invoice_number: r.invoice_number, invoice_date: r.invoice_date, customer: r.customer?.name,
    subtotal: r.subtotal, vat_total: r.vat_total, grand_total: r.grand_total,
    paid: r.paid_amount, tds: r.tds_amount, due: r.due_amount, status: r.status,
  }));
  const t = flat.reduce((a, r) => ({ sub: a.sub + +r.subtotal, vat: a.vat + +r.vat_total, g: a.g + +r.grand_total, p: a.p + +r.paid, d: a.d + +r.due }), { sub: 0, vat: 0, g: 0, p: 0, d: 0 });

  return (
    <ReportShell title="Invoice Register" filters={filters} onExport={() => exportCsv("invoice-register.csv", flat, Object.keys(flat[0] || { invoice_number: "" }))}>
      <FilterBar filters={filters} setFilters={setFilters} customers={customers} showStatus statusOptions={["draft","posted","bill_submitted","partial_paid","paid","cancelled"]} />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Subtotal</TableHead><TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Due</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {flat.map((r, i) => (
              <TableRow key={i}><TableCell>{r.invoice_number}</TableCell><TableCell>{r.invoice_date}</TableCell><TableCell>{r.customer}</TableCell><TableCell className="text-right">{(+r.subtotal).toFixed(2)}</TableCell><TableCell className="text-right">{(+r.vat_total).toFixed(2)}</TableCell><TableCell className="text-right">{(+r.grand_total).toFixed(2)}</TableCell><TableCell className="text-right">{(+r.paid).toFixed(2)}</TableCell><TableCell className="text-right">{(+r.due).toFixed(2)}</TableCell><TableCell><Badge variant="secondary">{r.status}</Badge></TableCell></TableRow>
            ))}
            {flat.length > 0 && <TableRow className="font-bold bg-muted/50"><TableCell colSpan={3}>Totals</TableCell><TableCell className="text-right">{t.sub.toFixed(2)}</TableCell><TableCell className="text-right">{t.vat.toFixed(2)}</TableCell><TableCell className="text-right">{t.g.toFixed(2)}</TableCell><TableCell className="text-right">{t.p.toFixed(2)}</TableCell><TableCell className="text-right">{t.d.toFixed(2)}</TableCell><TableCell /></TableRow>}
            {flat.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No data</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
