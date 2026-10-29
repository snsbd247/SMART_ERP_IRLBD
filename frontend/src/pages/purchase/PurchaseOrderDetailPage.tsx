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
import { ArrowLeft, Check, X, Pencil, Printer, Lock, RefreshCw } from "lucide-react";

const PurchaseOrderDetailPage = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast } = useToast();
  const { user, profile } = useAuth() as any;
  const [po, setPo] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [supplier, setSupplier] = useState<any>(null);
  const [amendments, setAmendments] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);

  const load = async () => {
    const [{ data: h }, { data: ls }, { data: am }, { data: au }] = await Promise.all([
      dataClient.from("purchase_orders_v2" as any).select("*").eq("id", id).single(),
      dataClient.from("purchase_order_items_v2" as any).select("*").eq("po_id", id).order("line_no"),
      dataClient.from("po_amendments_v2" as any).select("*").eq("po_id", id).order("revision_no", { ascending: false }),
      dataClient.from("purchase_audit_log" as any).select("*").eq("document_type", "PO").eq("document_id", id).order("created_at", { ascending: false }),
    ]);
    setPo(h as any); setLines((ls || []) as any); setAmendments((am || []) as any); setAudit((au || []) as any);
    if ((h as any)?.supplier_id) {
      const { data: s } = await dataClient.from("suppliers" as any).select("*").eq("id", (h as any).supplier_id).single();
      setSupplier(s);
    }
  };
  useEffect(() => { load(); }, [id]);

  const setStatus = async (status: string, reason?: string) => {
    const payload: any = { status };
    if (status === "cancelled") payload.cancelled_reason = reason;
    if (status === "closed") payload.closed_reason = reason;
    if (status === "approved") { payload.approved_by = user?.id; payload.approved_at = new Date().toISOString(); }
    const { error } = await dataClient.from("purchase_orders_v2" as any).update(payload).eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await logAudit({ document_type: "PO", document_id: id!, document_no: po?.po_no,
      action: status.toUpperCase(), notes: reason, performed_by: user?.id, performed_by_name: profile?.name || user?.email });
    toast({ title: `Status: ${status}` }); load();
  };

  const amend = async () => {
    const reason = prompt("Amendment reason?");
    if (!reason) return;
    await dataClient.from("po_amendments_v2" as any).insert({
      po_id: id, revision_no: (po?.revision_no || 0) + 1, reason,
      amended_by: user?.id, amended_by_name: profile?.name || user?.email,
      snapshot: { header: po, lines } as any,
    });
    await dataClient.from("purchase_orders_v2" as any).update({ revision_no: (po?.revision_no || 0) + 1, status: "draft" }).eq("id", id);
    await logAudit({ document_type: "PO", document_id: id!, document_no: po?.po_no, action: "AMENDED", notes: reason, performed_by: user?.id, performed_by_name: profile?.name || user?.email });
    toast({ title: "Amendment created — PO is now in Draft for re-approval" }); load();
  };

  if (!po) return <div className="p-6 text-muted-foreground">Loading…</div>;
  const locked = ["cancelled", "closed"].includes(po.status);

  return (
    <div className="p-6 space-y-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => nav("/purchase/orders")}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-semibold">{po.po_no} {po.revision_no > 0 && <span className="text-xs text-muted-foreground">Rev {po.revision_no}</span>}</h1>
          <Badge variant={po.status === "approved" ? "default" : po.status === "cancelled" ? "destructive" : "outline"} className="capitalize">{po.status?.replace("_", " ")}</Badge>
          {locked && <Lock className="w-4 h-4 text-muted-foreground" />}
        </div>
        <div className="flex gap-2">
          <Button className="print:hidden" variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
          {po.status === "draft" && <Button variant="outline" size="sm" asChild><Link to={`/purchase/orders/${id}/edit`}><Pencil className="w-4 h-4 mr-1" />Edit</Link></Button>}
          {po.status === "pending_approval" && (
            <>
              <Button size="sm" onClick={() => setStatus("approved")}><Check className="w-4 h-4 mr-1" />Approve</Button>
              <Button size="sm" variant="destructive" onClick={() => { const r = prompt("Cancel reason?"); if (r) setStatus("cancelled", r); }}><X className="w-4 h-4 mr-1" />Cancel</Button>
            </>
          )}
          {po.status === "approved" && (
            <>
              <Button size="sm" variant="outline" onClick={amend}><RefreshCw className="w-4 h-4 mr-1" />Amend</Button>
              <Button size="sm" variant="outline" onClick={() => { const r = prompt("Close reason?"); if (r) setStatus("closed", r); }}>Close</Button>
            </>
          )}
        </div>
      </div>

      {/* Printable area */}
      <div className="bg-card border rounded p-6 space-y-4 print:border-0 print:p-0">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold">PURCHASE ORDER</h2>
            <div className="text-sm text-muted-foreground">{po.po_no} • Rev {po.revision_no}</div>
          </div>
          <div className="text-right text-sm">
            <div><span className="text-muted-foreground">Date:</span> {po.po_date}</div>
            <div><span className="text-muted-foreground">Expected:</span> {po.expected_date || "—"}</div>
            <div><span className="text-muted-foreground">Currency:</span> {po.currency}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="border rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">SUPPLIER</div>
            <div className="font-semibold">{supplier?.name || "—"}</div>
            <div className="text-sm">{supplier?.address || ""}</div>
            <div className="text-sm">{supplier?.phone || ""} {supplier?.email && `• ${supplier.email}`}</div>
            {supplier?.vat_reg_no && <div className="text-xs">VAT Reg: {supplier.vat_reg_no}</div>}
          </div>
          <div className="border rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">SHIP TO</div>
            <div className="text-sm">{po.shipping_address || "—"}</div>
            <div className="text-xs mt-2"><span className="text-muted-foreground">Payment Terms:</span> {po.payment_terms || "—"}</div>
            <div className="text-xs"><span className="text-muted-foreground">Delivery Terms:</span> {po.delivery_terms || "—"}</div>
          </div>
        </div>

        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10">#</TableHead><TableHead>Description</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Disc%</TableHead><TableHead className="text-right">VAT%</TableHead><TableHead className="text-right">Total</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={l.id}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>{l.item_description}</TableCell>
                <TableCell className="text-right">{Number(l.quantity).toLocaleString()}</TableCell>
                <TableCell className="text-right">{Number(l.unit_price).toLocaleString()}</TableCell>
                <TableCell className="text-right">{l.discount_percent}</TableCell>
                <TableCell className="text-right">{l.vat_percent}</TableCell>
                <TableCell className="text-right font-mono">{Number(l.line_total).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex justify-end">
          <div className="w-72 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">{Number(po.subtotal).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="font-mono">−{Number(po.discount_amount).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Freight</span><span className="font-mono">{Number(po.freight_amount).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">VAT</span><span className="font-mono">{Number(po.vat_amount).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">AIT</span><span className="font-mono">−{Number(po.ait_amount).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Other</span><span className="font-mono">{Number(po.other_charges).toLocaleString()}</span></div>
            <div className="flex justify-between border-t pt-1 font-semibold text-base"><span>Grand Total</span><span className="font-mono">{Number(po.grand_total).toLocaleString()}</span></div>
          </div>
        </div>

        {po.remarks && <div className="text-xs"><span className="text-muted-foreground">Remarks:</span> {po.remarks}</div>}
      </div>

      <div className="grid md:grid-cols-2 gap-4 print:hidden">
        <Card><CardHeader><CardTitle className="text-base">Amendment History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Rev</TableHead><TableHead>When</TableHead><TableHead>By</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
              <TableBody>
                {amendments.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-xs">No amendments</TableCell></TableRow>
                : amendments.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.revision_no}</TableCell>
                    <TableCell className="text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell>{a.amended_by_name || "—"}</TableCell>
                    <TableCell className="text-xs">{a.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
              <TableBody>
                {audit.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-xs">No entries</TableCell></TableRow>
                : audit.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell><Badge>{a.action}</Badge></TableCell>
                    <TableCell>{a.performed_by_name || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PurchaseOrderDetailPage;
