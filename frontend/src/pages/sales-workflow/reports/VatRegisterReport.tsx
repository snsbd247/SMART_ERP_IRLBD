import { useEffect, useState } from "react";
import { swReports, exportCsv } from "@/lib/sales-workflow-reports";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell, FilterBar, useCustomers } from "./_shared";

export default function VatRegisterReport() {
  const customers = useCustomers();
  const [filters, setFilters] = useState({ from: "", to: "", customer_id: "", status: "" });
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { swReports.vatRegister(filters).then(({ data }) => setRows(data || [])); }, [filters]);

  const flat = rows.map((r) => ({
    challan_number: r.challan_number, challan_date: r.challan_date, customer: r.customer?.name,
    subtotal: r.subtotal, vat_amount: r.vat_amount, grand_total: r.grand_total, status: r.status,
  }));
  const totals = flat.reduce((a, r) => ({ subtotal: a.subtotal + Number(r.subtotal), vat: a.vat + Number(r.vat_amount), total: a.total + Number(r.grand_total) }), { subtotal: 0, vat: 0, total: 0 });

  return (
    <ReportShell title="VAT Register (Mushak 6.3)" filters={filters} onExport={() => exportCsv("vat-register.csv", flat, ["challan_number","challan_date","customer","subtotal","vat_amount","grand_total","status"])}>
      <FilterBar filters={filters} setFilters={setFilters} customers={customers} />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Challan No</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Subtotal</TableHead><TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {flat.map((r, i) => (
              <TableRow key={i}><TableCell>{r.challan_number}</TableCell><TableCell>{r.challan_date}</TableCell><TableCell>{r.customer}</TableCell><TableCell className="text-right">{Number(r.subtotal).toFixed(2)}</TableCell><TableCell className="text-right">{Number(r.vat_amount).toFixed(2)}</TableCell><TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell><TableCell>{r.status}</TableCell></TableRow>
            ))}
            {flat.length > 0 && (
              <TableRow className="font-bold bg-muted/50"><TableCell colSpan={3}>Totals</TableCell><TableCell className="text-right">{totals.subtotal.toFixed(2)}</TableCell><TableCell className="text-right">{totals.vat.toFixed(2)}</TableCell><TableCell className="text-right">{totals.total.toFixed(2)}</TableCell><TableCell /></TableRow>
            )}
            {flat.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No data</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
