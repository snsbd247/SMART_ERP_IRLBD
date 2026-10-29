import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { RowActions } from "@/components/sales-workflow/RowActions";
import { PrintTaxInvoice } from "@/components/sales-workflow/SalesWorkflowPrints";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { ListPagination } from "@/components/sales-workflow/ListPagination";

export default function InvoicesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { paged, page, setPage, pageSize, setPageSize, totalPages, total } = usePagedRows(rows);

  const load = async () => {
    // listInvoicesFull() hydrates items/payments/tds (needed by the row
    // Print button) with a handful of bulk IN-list queries, instead of the
    // old N+1 pattern of calling getInvoice() once per row.
    const { data } = await swApi.listInvoicesFull({ q });
    setRows(data || []);
    setSelected(new Set());
  };
  useEffect(() => { load(); }, [q]);

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

  const remove = async (id: string) => {
    const { error } = await swApi.deleteInvoice(id);
    if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
    toast({ title: "Invoice deleted" });
    load();
  };

  const removeSelected = async () => {
    if (!confirm(`Delete ${selected.size} selected invoice(s)? Linked VAT challans will be unlocked.`)) return;
    for (const id of selected) await swApi.deleteInvoice(id);
    toast({ title: `${selected.size} invoice(s) deleted` });
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between"><h1 className="text-2xl font-bold">Invoices (V2)</h1>
        <Link to="/sales-workflow/invoice-queue"><Button><Plus className="w-4 h-4 mr-2" />New from Queue</Button></Link>
      </div>
      <Card className="p-4 flex items-center justify-between gap-2 flex-wrap">
        <Input placeholder="Search invoice no..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
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
            <TableHead>No</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Mode</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Due</TableHead><TableHead>Bill Submitted</TableHead><TableHead>Payment Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {paged.map((r) => {
              const overdue = r.bill_due_date && Number(r.due_amount) > 0.01 && new Date(r.bill_due_date) < new Date();
              return (
              <TableRow key={r.id} className={selected.has(r.id) ? "bg-muted/50" : ""}>
                <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                <TableCell className="font-medium">{r.invoice_number}</TableCell>
                <TableCell>{r.invoice_date}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell>{r.mode}</TableCell>
                <TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.paid_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.due_amount).toFixed(2)}</TableCell>
                <TableCell className="text-sm">{r.bill_submitted_at || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-sm">{r.bill_due_date ? <span className={overdue ? "text-destructive font-medium" : ""}>{r.bill_due_date}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><Badge variant={overdue ? "destructive" : "secondary"}>{overdue ? "overdue" : r.status}</Badge></TableCell>
                <TableCell>
                  <RowActions
                    printSlot={<PrintTaxInvoice inv={r} />}
                    viewTo={`/sales-workflow/invoice/${r.id}`}
                    editTo={`/sales-workflow/invoice/${r.id}`}
                    onDelete={() => remove(r.id)}
                    deleteLabel={`Delete invoice ${r.invoice_number}? Linked VAT challans will be unlocked.`}
                  />
                </TableCell>
              </TableRow>
            );})}
            {rows.length === 0 && <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">No invoices</TableCell></TableRow>}
          </TableBody>
        </Table>
        <ListPagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </Card>
    </div>
  );
}
