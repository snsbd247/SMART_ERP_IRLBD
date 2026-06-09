import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Eye } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";

export default function BillsPage() {
  const nav = useNavigate();
  const { fc } = useCurrency();
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("purchase_bills" as any).select("*, suppliers(name)").order("created_at", { ascending: false })
      .then(({ data }) => setList((data as any) || []));
  }, []);
  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Purchase Bills</CardTitle>
          <Button onClick={() => nav("/purchase-workflow/bills/new")}><Plus className="w-4 h-4 mr-2" />New Bill</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Bill #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
              <TableHead>Due</TableHead><TableHead>Grand Total</TableHead><TableHead>Paid</TableHead>
              <TableHead>Outstanding</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {list.map(b => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono">{b.bill_number}</TableCell>
                  <TableCell>{b.bill_date}</TableCell>
                  <TableCell>{b.suppliers?.name}</TableCell>
                  <TableCell>{b.due_date || "-"}</TableCell>
                  <TableCell>{fc(b.grand_total)}</TableCell>
                  <TableCell>{fc(b.paid_amount)}</TableCell>
                  <TableCell>{fc(Number(b.grand_total) - Number(b.paid_amount) - Number(b.tds_amount))}</TableCell>
                  <TableCell><Badge>{b.status}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => nav(`/purchase-workflow/bills/${b.id}`)}><Eye className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
              {!list.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No bills yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
