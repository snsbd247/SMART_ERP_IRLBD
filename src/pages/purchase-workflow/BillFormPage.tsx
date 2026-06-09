import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft } from "lucide-react";
import { newBillNumber, getActiveFinancialYearId } from "@/lib/purchase-workflow-utils";
import { autoPostAccounting, findAccountByName } from "@/lib/accounting-utils";
import { validatePurchaseAccounts } from "@/lib/purchase-validation";
import { CoAWarning } from "@/components/purchase-workflow/CoAWarning";
import { PurchaseStatusTracker } from "@/components/purchase-workflow/PurchaseStatusTracker";
import { logCreate } from "@/lib/audit-utils";
import { usePermission } from "@/hooks/usePermission";

export default function BillFormPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const initialGrn = sp.get("grn") || "";
  const { user, profile } = useAuth();
  const { userBranchId } = useBranch();
  const { toast } = useToast();
  const { can, isSuperAdmin } = usePermission();
  const canCreate = isSuperAdmin || can("purchase.bill.create") || can("purchase.create");

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [grns, setGrns] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [supBillNo, setSupBillNo] = useState("");
  const [vatPct, setVatPct] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [coaMissing, setCoaMissing] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("suppliers").select("id,name").order("name").then(({ data }) => setSuppliers((data as any) || []));
    validatePurchaseAccounts({ needVat: true }).then(r => setCoaMissing(r.missing));
  }, []);

  // Initialize from GRN
  useEffect(() => {
    if (!initialGrn) return;
    supabase.from("grns" as any).select("supplier_id").eq("id", initialGrn).single().then(({ data }) => {
      if (data) { setSupplierId((data as any).supplier_id); setSelected({ [initialGrn]: true }); }
    });
  }, [initialGrn]);

  // Load eligible GRNs for supplier
  useEffect(() => {
    if (!supplierId) { setGrns([]); return; }
    supabase.from("grns" as any).select("*, purchase_orders_v2(po_number)").eq("supplier_id", supplierId).order("grn_date", { ascending: false })
      .then(({ data }) => setGrns((data as any) || []));
  }, [supplierId]);

  const selectedGrns = grns.filter(g => selected[g.id]);
  const subtotal = selectedGrns.reduce((s, g) => s + Number(g.total_amount), 0);
  const vatAmt = subtotal * (vatPct / 100);
  const grand = subtotal + vatAmt;

  const save = async () => {
    if (!canCreate) return toast({ title: "Permission denied", description: "Requires purchase.bill.create", variant: "destructive" });
    if (!supplierId || !selectedGrns.length) return toast({ title: "Select supplier & GRNs", variant: "destructive" });
    setSaving(true);
    try {
      const bill_number = await newBillNumber();
      const { data: bill, error } = await supabase.from("purchase_bills" as any).insert({
        bill_number, bill_date: date, supplier_id: supplierId, supplier_bill_no: supBillNo || null,
        due_date: dueDate || null, branch_id: userBranchId || null,
        subtotal, vat_amount: vatAmt, grand_total: grand, paid_amount: 0, tds_amount: 0,
        status: "unpaid", notes: notes || null, created_by: user?.id || null,
      } as any).select().single();
      if (error) throw error;

      const links = selectedGrns.map(g => ({ bill_id: (bill as any).id, grn_id: g.id, amount: Number(g.total_amount) }));
      const { error: e2 } = await supabase.from("purchase_bill_grns" as any).insert(links);
      if (e2) throw e2;

      // Auto-post accounting: DR Purchase/Inventory + VAT, CR Accounts Payable
      try {
        const purchaseAcc = await findAccountByName("Purchase");
        const apAcc = await findAccountByName("Accounts Payable");
        const vatAcc = vatAmt > 0 ? await findAccountByName("VAT Receivable") : null;
        if (purchaseAcc && apAcc) {
          const entries = [
            { account_id: purchaseAcc, debit: subtotal, credit: 0, narration: `Bill ${bill_number}` },
          ];
          if (vatAcc && vatAmt > 0) entries.push({ account_id: vatAcc, debit: vatAmt, credit: 0, narration: "VAT" });
          else if (vatAmt > 0) entries[0].debit += vatAmt;
          entries.push({ account_id: apAcc, debit: 0, credit: grand, narration: `Bill ${bill_number}` });
          const fy = await getActiveFinancialYearId();
          const v = await autoPostAccounting({
            voucher_type: "journal", voucher_date: date, description: `Purchase Bill ${bill_number}`,
            branch_id: userBranchId, financial_year_id: fy, entries, created_by: user?.id,
            reference_type: "purchase_bill", reference_id: (bill as any).id,
          });
          await supabase.from("purchase_bills" as any).update({ voucher_id: v.voucherId }).eq("id", (bill as any).id);
        } else {
          toast({ title: "Bill created — accounting skipped", description: "Set up 'Purchase' & 'Accounts Payable' accounts in CoA" });
        }
      } catch (e: any) {
        console.warn("Auto-post failed:", e.message);
        toast({ title: "Bill created — accounting skipped", description: e.message });
      }

      await logCreate({
        userId: user?.id, userName: profile?.name,
        module: "purchase_bill", recordId: (bill as any).id,
        newData: { bill_number, supplier_id: supplierId, grand_total: grand, grns: selectedGrns.length },
        details: `Bill ${bill_number} created against ${selectedGrns.length} GRN(s) (grand ${grand.toFixed(2)})`,
      });
      toast({ title: "Bill created", description: bill_number });
      nav(`/purchase-workflow/bills/${(bill as any).id}`);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-4">
      <Button variant="ghost" onClick={() => nav(-1)}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
      <PurchaseStatusTracker current="bill" />
      <Card>
        <CardHeader><CardTitle>New Purchase Bill</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <CoAWarning missing={coaMissing} />
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Bill Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><Label>Due Date</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
            <div><Label>Supplier Bill #</Label><Input value={supBillNo} onChange={e => setSupBillNo(e.target.value)} /></div>
          </div>
          {grns.length > 0 && (
            <div>
              <Label>Select GRNs to bill</Label>
              <Table>
                <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>GRN #</TableHead><TableHead>Date</TableHead><TableHead>PO</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {grns.map(g => (
                    <TableRow key={g.id}>
                      <TableCell><Checkbox checked={!!selected[g.id]} onCheckedChange={c => setSelected({ ...selected, [g.id]: !!c })} /></TableCell>
                      <TableCell className="font-mono">{g.grn_number}</TableCell>
                      <TableCell>{g.grn_date}</TableCell>
                      <TableCell className="font-mono">{g.purchase_orders_v2?.po_number}</TableCell>
                      <TableCell className="text-right">{Number(g.total_amount).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div><Label>VAT %</Label><Input type="number" value={vatPct || ""} onChange={e => setVatPct(Number(e.target.value))} /></div>
            <div className="col-span-2"><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
          </div>
          <div className="flex justify-end flex-col items-end text-sm space-y-1">
            <div>Subtotal: <b>{subtotal.toFixed(2)}</b></div>
            <div>VAT: <b>{vatAmt.toFixed(2)}</b></div>
            <div className="text-lg">Grand Total: <b>{grand.toFixed(2)}</b></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => nav(-1)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Create Bill"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
