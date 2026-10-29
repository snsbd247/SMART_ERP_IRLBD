import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { RowActions } from "@/components/sales-workflow/RowActions";
import { PrintPO } from "@/components/sales-workflow/SalesWorkflowPrints";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { ListPagination } from "@/components/sales-workflow/ListPagination";

export default function PurchaseOrdersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { paged, page, setPage, pageSize, setPageSize, totalPages, total } = usePagedRows(rows);

  const load = async () => {
    const { data } = await swApi.listPOsFull({ q, status });
    setRows(data || []);
    setSelected(new Set());
  };
  useEffect(() => { load(); }, [q, status]);

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
    const { error } = await swApi.deletePO(id);
    if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
    toast({ title: "PO deleted" });
    load();
  };

  const removeSelected = async () => {
    if (!confirm(`Delete ${selected.size} selected PO(s)? This cannot be undone.`)) return;
    for (const id of selected) await swApi.deletePO(id);
    toast({ title: `${selected.size} PO(s) deleted` });
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <Link to="/sales-workflow/po/new"><Button><Plus className="w-4 h-4 mr-2" />New PO</Button></Link>
      </div>
      <Card className="p-4 flex gap-2 flex-wrap items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Search PO number..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 bg-background">
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="partial">Partial</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={removeSelected}>
            <Trash2 className="w-4 h-4 mr-1.5" />Delete Selected ({selected.size})
          </Button>
        )}
      </Card>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={paged.length > 0 && paged.every((r) => selected.has(r.id))} onCheckedChange={toggleAll} /></TableHead>
              <TableHead>PO No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((r) => (
              <TableRow key={r.id} className={selected.has(r.id) ? "bg-muted/50" : ""}>
                <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                <TableCell className="font-medium">{r.po_number}</TableCell>
                <TableCell>{r.po_date}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell className="text-right">{Number(r.subtotal).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.vat_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell>
                <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                <TableCell>
                  <RowActions
                    printSlot={<PrintPO po={r} />}
                    viewTo={`/sales-workflow/po/${r.id}`}
                    editTo={`/sales-workflow/po/${r.id}/edit`}
                    onDelete={() => remove(r.id)}
                    deleteLabel={`Delete PO ${r.po_number}? This cannot be undone.`}
                  />
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No purchase orders</TableCell></TableRow>}
          </TableBody>
        </Table>
        <ListPagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </Card>
    </div>
  );
}
