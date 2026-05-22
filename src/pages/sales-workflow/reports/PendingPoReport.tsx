import { useEffect, useState } from "react";
import { swReports, exportCsv } from "@/lib/sales-workflow-reports";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ReportShell, FilterBar, useCustomers } from "./_shared";

export default function PendingPoReport() {
  const customers = useCustomers();
  const [filters, setFilters] = useState({ from: "", to: "", customer_id: "", status: "" });
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { swReports.pendingPO(filters).then(({ data }) => setRows(data || [])); }, [filters]);

  const flat = rows.map((r) => {
    const ordered = (r.items || []).reduce((s: number, i: any) => s + Number(i.qty_ordered), 0);
    const remaining = (r.items || []).reduce((s: number, i: any) => s + Number(i.qty_remaining), 0);
    return { po_number: r.po_number, po_date: r.po_date, customer: r.customer?.name, status: r.status, ordered, remaining, grand_total: r.grand_total };
  });

  return (
    <ReportShell title="Pending Purchase Orders" filters={filters} onExport={() => exportCsv("pending-po.csv", flat, ["po_number","po_date","customer","status","ordered","remaining","grand_total"])}>
      <FilterBar filters={filters} setFilters={setFilters} customers={customers} />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {flat.map((r, i) => (
              <TableRow key={i}><TableCell>{r.po_number}</TableCell><TableCell>{r.po_date}</TableCell><TableCell>{r.customer}</TableCell><TableCell><Badge variant="secondary">{r.status}</Badge></TableCell><TableCell className="text-right">{r.ordered}</TableCell><TableCell className="text-right">{r.remaining}</TableCell><TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell></TableRow>
            ))}
            {flat.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No pending POs</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
