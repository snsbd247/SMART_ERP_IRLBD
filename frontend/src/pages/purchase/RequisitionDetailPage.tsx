import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/purchase-numbering";
import { ArrowLeft, Check, X, Pencil, ShoppingCart, Lock } from "lucide-react";

const RequisitionDetailPage = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast } = useToast();
  const { user, profile } = useAuth() as any;
  const [pr, setPr] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);

  const load = async () => {
    const [{ data: h }, { data: ls }, { data: au }] = await Promise.all([
      dataClient.from("purchase_requisitions" as any).select("*").eq("id", id).single(),
      dataClient.from("purchase_requisition_items" as any).select("*").eq("pr_id", id).order("line_no"),
      dataClient.from("purchase_audit_log" as any).select("*").eq("document_type", "PR").eq("document_id", id).order("created_at", { ascending: false }),
    ]);
    setPr(h as any); setLines((ls || []) as any); setAudit((au || []) as any);
  };
  useEffect(() => { load(); }, [id]);

  const setStatus = async (status: string, reason?: string) => {
    const payload: any = { status };
    if (status === "rejected") payload.rejected_reason = reason;
    if (status === "closed") payload.closed_reason = reason;
    const { error } = await dataClient.from("purchase_requisitions" as any).update(payload).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await logAudit({ document_type: "PR", document_id: id!, document_no: pr?.pr_no,
      action: status.toUpperCase(), notes: reason, performed_by: user?.id, performed_by_name: profile?.name || user?.email });
    toast({ title: `Status: ${status}` }); load();
  };

  if (!pr) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const locked = ["approved", "rejected", "closed", "cancelled"].includes(pr.status);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => nav("/purchase/requisitions")}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-semibold">{pr.pr_no}</h1>
          <Badge variant={pr.status === "approved" ? "default" : pr.status === "rejected" ? "destructive" : "outline"} className="capitalize">{pr.status?.replace("_", " ")}</Badge>
          {locked && <Lock className="w-4 h-4 text-muted-foreground" />}
        </div>
        <div className="flex gap-2">
          {!locked && <Button variant="outline" size="sm" asChild><Link to={`/purchase/requisitions/${id}/edit`}><Pencil className="w-4 h-4 mr-1" />Edit</Link></Button>}
          {pr.status === "submitted" && (
            <>
              <Button size="sm" onClick={() => setStatus("approved")}><Check className="w-4 h-4 mr-1" />Approve</Button>
              <Button size="sm" variant="destructive" onClick={() => { const r = prompt("Rejection reason?"); if (r) setStatus("rejected", r); }}><X className="w-4 h-4 mr-1" />Reject</Button>
            </>
          )}
          {pr.status === "approved" && (
            <>
              <Button size="sm" asChild><Link to={`/purchase/orders/new?pr=${id}`}><ShoppingCart className="w-4 h-4 mr-1" />Create PO</Link></Button>
              <Button size="sm" variant="outline" onClick={() => { const r = prompt("Close reason?"); if (r) setStatus("closed", r); }}>Close</Button>
            </>
          )}
        </div>
      </div>

      <Card><CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm">
          <div><div className="text-muted-foreground">PR Date</div><div>{pr.pr_date}</div></div>
          <div><div className="text-muted-foreground">Required Date</div><div>{pr.required_date || "—"}</div></div>
          <div><div className="text-muted-foreground">Priority</div><div className="capitalize">{pr.priority}</div></div>
          <div><div className="text-muted-foreground">Requested By</div><div>{pr.requested_by_name || "—"}</div></div>
          <div className="col-span-2 md:col-span-4"><div className="text-muted-foreground">Remarks</div><div>{pr.remarks || "—"}</div></div>
          {pr.rejected_reason && <div className="col-span-2 md:col-span-4"><div className="text-muted-foreground">Rejected Reason</div><div className="text-destructive">{pr.rejected_reason}</div></div>}
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10">#</TableHead><TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Est. Price</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{l.item_description}</TableCell>
                  <TableCell className="text-right">{Number(l.quantity).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{Number(l.ordered_qty).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{Number(l.estimated_price).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{Number(l.estimated_amount).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{l.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end p-3 border-t font-medium">Total: <span className="ml-3 font-mono">{Number(pr.total_estimated).toLocaleString()}</span></div>
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>By</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
            <TableBody>
              {audit.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-xs">No entries</TableCell></TableRow>
              : audit.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</TableCell>
                  <TableCell><Badge>{a.action}</Badge></TableCell>
                  <TableCell>{a.performed_by_name || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.notes || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default RequisitionDetailPage;
