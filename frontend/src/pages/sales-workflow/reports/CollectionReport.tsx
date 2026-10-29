import { useEffect, useState } from "react";
import { swReports, exportCsv } from "@/lib/sales-workflow-reports";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell, FilterBar, useCustomers } from "./_shared";

export default function CollectionReport() {
  const customers = useCustomers();
  const [filters, setFilters] = useState({ from: "", to: "", customer_id: "", status: "" });
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { swReports.collection(filters).then(({ data }) => setRows(data || [])); }, [filters]);

  const flat = rows.map((r) => ({
    payment_number: r.payment_number, payment_date: r.payment_date, mode: r.mode,
    invoice: r.invoice?.invoice_number, customer: r.invoice?.customer?.name,
    amount_received: r.amount_received, tds_amount: r.tds_amount, total_settled: r.total_settled,
  }));
  const totals = flat.reduce((a, r) => ({ amt: a.amt + +r.amount_received, tds: a.tds + +r.tds_amount, set: a.set + +r.total_settled }), { amt: 0, tds: 0, set: 0 });

  return (
    <ReportShell title="Collection Report" filters={filters} onExport={() => exportCsv("collection.csv", flat, ["payment_number","payment_date","mode","invoice","customer","amount_received","tds_amount","total_settled"])}>
      <FilterBar filters={filters} setFilters={setFilters} customers={customers} />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date</TableHead><TableHead>Mode</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">TDS</TableHead><TableHead className="text-right">Settled</TableHead></TableRow></TableHeader>
          <TableBody>
            {flat.map((r, i) => (
              <TableRow key={i}><TableCell>{r.payment_number}</TableCell><TableCell>{r.payment_date}</TableCell><TableCell>{r.mode}</TableCell><TableCell>{r.invoice}</TableCell><TableCell>{r.customer}</TableCell><TableCell className="text-right">{(+r.amount_received).toFixed(2)}</TableCell><TableCell className="text-right">{(+r.tds_amount).toFixed(2)}</TableCell><TableCell className="text-right">{(+r.total_settled).toFixed(2)}</TableCell></TableRow>
            ))}
            {flat.length > 0 && <TableRow className="font-bold bg-muted/50"><TableCell colSpan={5}>Totals</TableCell><TableCell className="text-right">{totals.amt.toFixed(2)}</TableCell><TableCell className="text-right">{totals.tds.toFixed(2)}</TableCell><TableCell className="text-right">{totals.set.toFixed(2)}</TableCell></TableRow>}
            {flat.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No collections</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
