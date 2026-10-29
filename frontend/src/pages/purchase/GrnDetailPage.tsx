import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { postGrn } from "@/lib/purchase-posting";
import { logAudit } from "@/lib/purchase-numbering";
import { ArrowLeft, CheckCircle, XCircle, Printer, Pencil } from "lucide-react";

const GrnDetailPage = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth() as any;
  const [h, setH] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [supplier, setSupplier] = useState<any>(null);
  const [po, setPo] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: hd }, { data: ls }] = await Promise.all([
      dataClient.from("grns_v2" as any).select("*").eq("id", id).single(),
      dataClient.from("grn_items_v2" as any).select("*").eq("grn_id", id).order("line_no"),
    ]);
    setH(hd); setLines((ls || []) as any);
    if (hd) {
      const [s, p] = await Promise.all([
        dataClient.from("suppliers" as any).select("*").eq("id", (hd as any).supplier_id).maybeSingle(),
        (hd as any).po_id ? dataClient.from("purchase_orders_v2" as any).select("*").eq("id", (hd as any).po_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setSupplier(s.data); setPo((p as any).data);
    }
  };
  useEffect(() => { load(); }, [id]);

  const approve = async () => {
    if (!confirm("Approve this GRN? Inventory will be posted and a journal voucher created.")) return;
    setBusy(true);
    try {
      const vid = await postGrn(h, lines, po, user?.id);
      await dataClient.from("grns_v2" as any).update({ status: "Approved", approved_by: user?.id, approved_at: new Date().toISOString(), voucher_id: vid }).eq("id", id);
      toast({ title: "Approved", description: vid ? "Stock & journal voucher posted" : "Stock posted (no COA mapping → no JV)" });
      load();
    } catch (e: any) {
      toast({ title: "Approval failed", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!confirm("Cancel this GRN?")) return;
    await dataClient.from("grns_v2" as any).update({ status: "Cancelled" }).eq("id", id);
    await logAudit({ document_type: "GRN", document_id: id!, document_no: h.grn_no, action: "cancelled", performed_by: user?.id });
    load();
  };

  if (!h) return <div className="p-6 text-muted-foreground">Loading…</div>;
  const isDraft = h.status === "Draft";

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-semibold">GRN {h.grn_no}</h1>
          <Badge variant={h.status === "Approved" ? "default" : h.status === "Cancelled" ? "destructive" : "outline"}>{h.status}</Badge>
        </div>
        <div className="flex gap-2">
          {isDraft && <Button variant="outline" asChild><Link to={`/purchase/grns/${id}/edit`}><Pencil className="w-4 h-4 mr-1" />Edit</Link></Button>}
          <Button className="print:hidden" variant="outline" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
          {isDraft && <Button onClick={approve} disabled={busy}><CheckCircle className="w-4 h-4 mr-1" />Approve & Post</Button>}
          {isDraft && <Button variant="destructive" onClick={cancel}><XCircle className="w-4 h-4 mr-1" />Cancel</Button>}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Receipt Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><span className="text-muted-foreground">Date:</span> {h.grn_date}</div>
          <div><span className="text-muted-foreground">Supplier:</span> {supplier?.name || "—"}</div>
          <div><span className="text-muted-foreground">PO:</span> {po ? <Link className="text-primary hover:underline" to={`/purchase/orders/${po.id}`}>{po.po_no}</Link> : "—"}</div>
          <div><span className="text-muted-foreground">Challan:</span> {h.challan_no || "—"}</div>
          <div><span className="text-muted-foreground">Challan Date:</span> {h.challan_date || "—"}</div>
          <div><span className="text-muted-foreground">Vehicle:</span> {h.vehicle_no || "—"}</div>
          <div><span className="text-muted-foreground">Received By:</span> {h.received_by_name || "—"}</div>
          <div><span className="text-muted-foreground">Inspected By:</span> {h.inspected_by_name || "—"}</div>
          {h.remarks && <div className="col-span-full"><span className="text-muted-foreground">Remarks:</span> {h.remarks}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Rejected</TableHead>
              <TableHead className="text-right">Accepted</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Batch</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{l.item_description}</TableCell>
                  <TableCell className="text-right font-mono">{Number(l.ordered_qty).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{Number(l.received_qty).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{Number(l.rejected_qty).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{Number(l.accepted_qty).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{Number(l.unit_cost).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{Number(l.line_value).toLocaleString()}</TableCell>
                  <TableCell>{l.batch_no || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 flex justify-end">
          <div className="text-right space-y-1">
            <div className="text-sm">Subtotal: <span className="font-mono">{Number(h.subtotal).toLocaleString()}</span></div>
            <div className="text-sm">Freight: <span className="font-mono">{Number(h.freight_amount).toLocaleString()}</span></div>
            <div className="text-sm">Other Charges: <span className="font-mono">{Number(h.other_charges).toLocaleString()}</span></div>
            <div className="text-lg font-semibold border-t pt-1">Grand Total: <span className="font-mono">{Number(h.grand_total).toLocaleString()}</span></div>
            {h.voucher_id && <div className="text-xs text-muted-foreground">Posted JV: <span className="font-mono">{h.voucher_id.slice(0, 8)}</span></div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GrnDetailPage;
