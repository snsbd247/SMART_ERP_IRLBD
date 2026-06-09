import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, X, ShoppingBag } from "lucide-react";

export default function RequisitionDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, hasPermission } = useAuth();
  const { toast } = useToast();
  const [pr, setPr] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const canApprove = hasPermission("purchase", "can_edit");

  const load = async () => {
    const [p, it] = await Promise.all([
      supabase.from("purchase_requisitions" as any).select("*").eq("id", id).single(),
      supabase.from("purchase_requisition_items" as any).select("*, products(product_name, product_code)").eq("pr_id", id),
    ]);
    setPr(p.data); setItems((it.data as any) || []);
  };
  useEffect(() => { if (id) load(); }, [id]);

  const setStatus = async (status: string) => {
    const updates: any = { status };
    if (status === "approved") { updates.approved_by = user?.id; updates.approved_at = new Date().toISOString(); }
    const { error } = await supabase.from("purchase_requisitions" as any).update(updates).eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: `Marked ${status}` }); load(); }
  };

  if (!pr) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" onClick={() => nav("/purchase-workflow/requisitions")}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{pr.pr_number} <Badge className="ml-2">{pr.status}</Badge></CardTitle>
          <div className="flex gap-2">
            {pr.status === "draft" && canApprove && (
              <>
                <Button size="sm" onClick={() => setStatus("approved")}><Check className="w-4 h-4 mr-1" />Approve</Button>
                <Button size="sm" variant="destructive" onClick={() => setStatus("rejected")}><X className="w-4 h-4 mr-1" />Reject</Button>
              </>
            )}
            {pr.status === "approved" && (
              <Button size="sm" onClick={() => nav(`/purchase-workflow/po/new?pr=${pr.id}`)}><ShoppingBag className="w-4 h-4 mr-1" />Issue PO</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
            <div><span className="text-muted-foreground">Date:</span> {pr.pr_date}</div>
            <div><span className="text-muted-foreground">Notes:</span> {pr.notes || "-"}</div>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty Required</TableHead><TableHead>Qty Ordered</TableHead><TableHead>Remarks</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map(i => (
                <TableRow key={i.id}>
                  <TableCell>{i.products?.product_code} - {i.products?.product_name}</TableCell>
                  <TableCell>{i.qty_required}</TableCell>
                  <TableCell>{i.qty_ordered}</TableCell>
                  <TableCell>{i.remarks || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
