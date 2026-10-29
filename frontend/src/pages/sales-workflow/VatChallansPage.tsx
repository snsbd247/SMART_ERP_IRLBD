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
import { PrintVatChallan } from "@/components/sales-workflow/SalesWorkflowPrints";
import { usePagedRows } from "@/hooks/use-paged-rows";
import { ListPagination } from "@/components/sales-workflow/ListPagination";

export default function VatChallansPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { paged, page, setPage, pageSize, setPageSize, totalPages, total } = usePagedRows(rows);

  const load = async () => {
    // listVatChallansFull() hydrates items (needed by the row Print button)
    // with a couple of bulk IN-list queries, instead of the old N+1 pattern
    // of calling getVatChallan() once per row.
    const { data } = await swApi.listVatChallansFull({ q });
    setRows(data || []);
    setSelected(new Set());
  };
  useEffect(() => { load(); }, [q]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
    const { error } = await swApi.deleteVatChallan(id);
    if (error) return toast({ title: "Failed", description: (error as any).message, variant: "destructive" });
    toast({ title: "VAT Challan deleted" });
    load();
  };

  const removeSelected = async () => {
    if (!confirm(`Delete ${selected.size} selected VAT Challan(s)? Linked DCs will also be removed.`)) return;
    for (const id of selected) await swApi.deleteVatChallan(id);
    toast({ title: `${selected.size} VAT Challan(s) deleted` });
    load();
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-bold">VAT Challans (Mushak 6.3)</h1>
        <Link to="/sales-workflow/vat-challan/new"><Button><Plus className="w-4 h-4 mr-2" />New Challan</Button></Link>
      </div>
      <Card className="p-4 flex items-center justify-between gap-2 flex-wrap">
        <Input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
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
            <TableHead>No</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Subtotal</TableHead><TableHead className="text-right">VAT</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {paged.map((r) => (
              <TableRow key={r.id} className={selected.has(r.id) ? "bg-muted/50" : ""}>
                <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                <TableCell className="font-medium">{r.challan_number}</TableCell>
                <TableCell>{r.challan_date}</TableCell>
                <TableCell>{r.customer?.name}</TableCell>
                <TableCell className="text-right">{Number(r.subtotal).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.vat_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">{Number(r.grand_total).toFixed(2)}</TableCell>
                <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                <TableCell>
                  <RowActions
                    printSlot={<PrintVatChallan v={r} />}
                    viewTo={`/sales-workflow/vat-challan/${r.id}`}
                    onDelete={() => remove(r.id)}
                    deleteLabel={`Delete ${r.challan_number}? Linked DCs will also be removed.`}
                  />
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No VAT challans</TableCell></TableRow>}
          </TableBody>
        </Table>
        <ListPagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </Card>
    </div>
  );
}
