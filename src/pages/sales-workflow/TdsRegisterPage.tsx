import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { Eye, Trash2 } from "lucide-react";
import { ReportPrintFooter } from "@/components/reports/ReportPrintFooter";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { ListPagination } from "@/components/sales-workflow/ListPagination";

import { DateInput } from "@/components/ui/date-input";
export default function TdsRegisterPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { paged, page, setPage, pageSize, setPageSize, totalPages, total } = usePagedRows(rows);

  const load = () => swApi.listTds({ from, to }).then(({ data }) => { setRows(data || []); setSelected(new Set()); });
  useEffect(() => { load(); }, [from, to]);
  const totalTds = rows.reduce((s, r) => s + Number(r.tds_amount || 0), 0);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    const pageIds = paged.map((r) => r.id);
    const allOnPageSelected = pageIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      pageIds.forEach((id) => (allOnPageSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const remove = async (r: any) => {
    if (!confirm(`Delete TDS entry for ${r.invoice?.invoice_number || "this invoice"}? This does not refund the invoice automatically.`)) return;
    const { error } = await swApi.deleteTds(r.id);
    if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
    toast({ title: "TDS entry deleted" });
    load();
  };

  const removeSelected = async () => {
    if (!confirm(`Delete ${selected.size} selected TDS entr${selected.size === 1 ? "y" : "ies"}? This does not refund the invoice(s) automatically.`)) return;
    for (const id of selected) await swApi.deleteTds(id);
    toast({ title: `${selected.size} TDS entr${selected.size === 1 ? "y" : "ies"} deleted` });
    load();
  };

  const handlePrint = () => window.print();
  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">TDS Register</h1>
        <Button variant="outline" onClick={handlePrint}>Print</Button>
      </div>
      <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-3">
          <div><label className="text-sm">From</label><DateInput value={from} onChange={(v) => setFrom(v)} /></div>
          <div><label className="text-sm">To</label><DateInput value={to} onChange={(v) => setTo(v)} /></div>
        </div>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={removeSelected}>
            <Trash2 className="w-4 h-4 mr-1.5" />Delete Selected ({selected.size})
          </Button>
        )}
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10"><Checkbox checked={paged.length > 0 && paged.every((r) => selected.has(r.id))} onCheckedChange={toggleAll} /></TableHead>
            <TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Cert No</TableHead><TableHead>Cert Date</TableHead><TableHead className="text-right">TDS %</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {paged.map((r) => (
              <TableRow key={r.id} className={selected.has(r.id) ? "bg-muted/50" : ""}>
                <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                <TableCell>{r.invoice?.invoice_number}</TableCell>
                <TableCell>{r.invoice?.customer?.name}</TableCell>
                <TableCell>{r.certificate_no}</TableCell>
                <TableCell>{r.certificate_date}</TableCell>
                <TableCell className="text-right">{r.tds_pct}</TableCell>
                <TableCell className="text-right">{Number(r.tds_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <Link to={`/sales-workflow/invoice/${r.invoice_id}`}>
                    <Button size="icon" variant="ghost" title="View invoice"><Eye className="w-4 h-4" /></Button>
                  </Link>
                  <Button size="icon" variant="ghost" className="text-destructive" title="Delete" onClick={() => remove(r)}><Trash2 className="w-4 h-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No TDS entries</TableCell></TableRow>}
          </TableBody>
        </Table>
        <ListPagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        <div className="p-4 text-right font-bold">Total TDS: {totalTds.toFixed(2)}</div>
      </Card>
      <ReportPrintFooter />
    </div>
  );
}
