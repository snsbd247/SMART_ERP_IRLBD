import { useEffect, useState } from "react";
import { swReports, exportCsv } from "@/lib/sales-workflow-reports";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell, FilterBar, useCustomers } from "./_shared";

export default function PoVsVatChallanReport() {
  const customers = useCustomers();
  const [filters, setFilters] = useState({ from: "", to: "", customer_id: "", status: "" });
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { swReports.poVsVatChallan(filters).then(({ data }) => setRows(data || [])); }, [filters]);

  const flat = rows.map((r) => ({
    po_number: r.po?.po_number, po_date: r.po?.po_date, customer: r.po?.customer?.name,
    product: r.product?.name, ordered: r.qty_ordered, delivered: r.qty_delivered, remaining: r.qty_remaining,
  }));

  return (
    <ReportShell title="PO vs VAT Challan" filters={filters} onExport={() => exportCsv("po-vs-vat-challan.csv", flat, ["po_number","po_date","customer","product","ordered","delivered","remaining"])}>
      <FilterBar filters={filters} setFilters={setFilters} customers={customers} />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Remaining</TableHead></TableRow></TableHeader>
          <TableBody>
            {flat.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{r.po_number}</TableCell><TableCell>{r.po_date}</TableCell><TableCell>{r.customer}</TableCell><TableCell>{r.product}</TableCell>
                <TableCell className="text-right">{r.ordered}</TableCell><TableCell className="text-right">{r.delivered}</TableCell><TableCell className="text-right">{r.remaining}</TableCell>
              </TableRow>
            ))}
            {flat.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No data</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
