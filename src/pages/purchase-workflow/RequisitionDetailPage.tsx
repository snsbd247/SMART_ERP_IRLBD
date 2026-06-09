import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Check, X, FileText } from "lucide-react";

export default function RequisitionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isSuperAdmin, hasPermission } = useAuth();
  const { toast } = useToast();
  const [pr, setPr] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  const load = async () => {
    const { data } = await supabase.from("purchase_requisitions").select("*").eq("id", id).single();
    setPr(data);
    const { data: its } = await supabase.from("purchase_requisition_items").select("*").eq("pr_id", id);
    setItems(its || []);
    const pids = (its || []).map((x: any) => x.product_id);
    if (pids.length) {
      const { data: prods } = await supabase.from("item_master").select("id, item_name").in("id", pids);
      const map: Record<string, string> = {};
      (prods || []).forEach((p: any) => { map[p.id] = p.item_name; });
      setProductNames(map);
    }
  };
  useEffect(() => { load(); }, [id]);

  const canApprove = isSuperAdmin || hasPermission("purchase", "can_edit");

  const setStatus = async (status: string) => {
    const patch: any = { status };
    if (status === "admin_approved") { patch.approved_by = user?.id; patch.approved_at = new Date().toISOString(); }
    const { error } = await supabase.from("purchase_requisitions").update(patch).eq("id", id);
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    toast({ title: `Status: ${status}` });
    load();
  };

  if (!pr) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
          <h1 className="text-xl font-bold">{pr.pr_number}</h1>
          <Badge>{pr.status}</Badge>
        </div>
        <div className="flex gap-2">
          {pr.status === "pending_admin" && canApprove && (
            <>
              <Button size="sm" variant="outline" onClick={() => setStatus("rejected")}><X className="w-4 h-4 mr-1" />Reject</Button>
              <Button size="sm" onClick={() => setStatus("admin_approved")}><Check className="w-4 h-4 mr-1" />Approve</Button>
            </>
          )}
          {pr.status === "admin_approved" && (
            <Button size="sm" onClick={() => navigate(`/purchase-workflow/po/new?pr=${pr.id}`)}><FileText className="w-4 h-4 mr-1" />Issue PO</Button>
          )}
        </div>
      </div>
      <Card><CardContent className="p-4 space-y-2">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Date:</span> {pr.pr_date}</div>
          <div><span className="text-muted-foreground">Notes:</span> {pr.notes || "—"}</div>
        </div>
      </CardContent></Card>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty Required</TableHead><TableHead className="text-right">Qty Ordered</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead>Remarks</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(it => (
              <TableRow key={it.id}>
                <TableCell>{productNames[it.product_id] || it.product_id.slice(0, 8)}</TableCell>
                <TableCell className="text-right">{it.qty_required}</TableCell>
                <TableCell className="text-right">{it.qty_ordered}</TableCell>
                <TableCell className="text-right font-medium">{Number(it.qty_required) - Number(it.qty_ordered)}</TableCell>
                <TableCell>{it.remarks || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}
