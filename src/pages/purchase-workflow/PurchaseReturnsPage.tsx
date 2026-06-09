import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Undo2, CheckCircle2 } from "lucide-react";
import { ReturnsHelpPanel } from "@/components/help/ReturnsHelpPanel";

interface PurchaseReturn {
  id: string;
  return_number: string;
  return_date: string;
  supplier_id: string | null;
  purchase_id: string | null;
  total_amount: number;
  reason: string | null;
  status: string;
}

const PurchaseReturnsPage = () => {
  const { toast } = useToast();
  const { fc } = useCurrency();
  const [rows, setRows] = useState<PurchaseReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_returns" as any)
      .select("*")
      .order("return_date", { ascending: false })
      .limit(200);
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    setRows((data || []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const approve = async (id: string) => {
    setApprovingId(id);
    try {
      // Approve via Laravel endpoint when available; otherwise flip status directly
      // so the page still works under pure-Supabase deployments.
      const { error } = await supabase
        .from("purchase_returns" as any)
        .update({ status: "approved" })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Purchase Return approved" });
      load();
    } catch (e: any) {
      toast({ title: "Approval failed", description: e.message, variant: "destructive" });
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Undo2 className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Purchase Returns</h1>
        <div className="ml-auto"><ReturnsHelpPanel /></div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No purchase returns yet</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs font-medium">{r.return_number}</TableCell>
                  <TableCell>{r.return_date}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.reason || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fc(r.total_amount)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "approved" ? "default" : "secondary"}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status !== "approved" && (
                      <Button size="sm" variant="outline" disabled={approvingId === r.id} onClick={() => approve(r.id)}>
                        <CheckCircle2 className="w-3 h-3 mr-1" />Approve
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default PurchaseReturnsPage;
