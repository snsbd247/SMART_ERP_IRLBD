import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Save } from "lucide-react";
import { genDocNumber, BILL_PREFIX } from "@/lib/purchase-workflow-utils";
import { autoPostAccounting, findAccountByName } from "@/lib/accounting-utils";

export default function BillFormPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const initialSupplier = params.get("supplier") || "";
  const initialGrn = params.get("grn") || "";

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState(initialSupplier);
  const [supplierBillNo, setSupplierBillNo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState(30);
  const [notes, setNotes] = useState("");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [grns, setGrns] = useState<any[]>([]);
  const [selectedGrns, setSelectedGrns] = useState<Set<string>>(new Set(initialGrn ? [initialGrn] : []));
  const [vatPct, setVatPct] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("suppliers").select("id, name").eq("status", "approved").then(({ data }) => setSuppliers(data || []));
  }, []);
  useEffect(() => { if (supplierId) loadGrns(); else setGrns([]); }, [supplierId]);
  useEffect(() => { const d = new Date(date); d.setDate(d.getDate() + paymentTerms); setDueDate(d.toISOString().slice(0, 10)); }, [date, paymentTerms]);

  const loadGrns = async () => {
    // GRNs for this supplier not yet fully billed
    const { data } = await supabase.from("grns").select("*").eq("supplier_id", supplierId).order("grn_date");
    // Filter out fully billed: check purchase_bill_grns links
    const { data: linked } = await supabase.from("purchase_bill_grns").select("grn_id");
    const linkedIds = new Set((linked || []).map((x: any) => x.grn_id));
    setGrns((data || []).filter((g: any) => !linkedIds.has(g.id)));
  };

  const toggle = (id: string) => {
    const s = new Set(selectedGrns);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelectedGrns(s);
  };

  const selectedRows = grns.filter(g => selectedGrns.has(g.id));
  const subtotal = selectedRows.reduce((s, g) => s + Number(g.total_amount), 0);
  const vatAmt = subtotal * vatPct / 100;
  const grand = subtotal + vatAmt;

  const save = async () => {
    if (!supplierId) return toast({ title: "Select supplier", variant: "destructive" });
    if (!selectedGrns.size) return toast({ title: "Select at least one GRN", variant: "destructive" });
    setSaving(true);
    try {
      const bill_number = await genDocNumber(BILL_PREFIX, "purchase_bills");
      const { data: bill, error } = await supabase.from("purchase_bills").insert({
        bill_number, bill_date: date, supplier_id: supplierId, supplier_bill_no: supplierBillNo || null, due_date: dueDate,
        subtotal, vat_amount: vatAmt, grand_total: grand, paid_amount: 0, status: "unpaid", notes, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      const billId = (bill as any).id;
      await supabase.from("purchase_bill_grns").insert(selectedRows.map(g => ({ bill_id: billId, grn_id: g.id, amount: Number(g.total_amount) })));

      // Auto-post: DR Purchase, CR Accounts Payable
      try {
        const purchaseAcc = await findAccountByName("Purchase");
        const apAcc = await findAccountByName("Accounts Payable");
        if (purchaseAcc && apAcc) {
          const entries: any[] = [{ account_id: purchaseAcc, debit: subtotal, credit: 0, narration: `Bill ${bill_number}` }];
          if (vatAmt > 0) {
            const vatAcc = await findAccountByName("VAT Receivable") || await findAccountByName("VAT Input");
            if (vatAcc) entries.push({ account_id: vatAcc, debit: vatAmt, credit: 0, narration: `VAT on ${bill_number}` });
            else entries[0].debit += vatAmt;
          }
          entries.push({ account_id: apAcc, debit: 0, credit: grand, narration: `Bill ${bill_number}` });
          const { voucherId } = await autoPostAccounting({
            voucher_type: "journal", voucher_date: date, description: `Purchase Bill ${bill_number}`, entries, created_by: user?.id,
          });
          await supabase.from("purchase_bills").update({ voucher_id: voucherId } as any).eq("id", billId);
        } else {
          toast({ title: "Bill saved but accounting not posted", description: "Create 'Purchase' and 'Accounts Payable' ledgers in Chart of Accounts." });
        }
      } catch (e: any) { console.warn("Accounting post failed:", e.message); }

      toast({ title: "Bill saved", description: bill_number });
      navigate(`/purchase-workflow/bills/${billId}`);
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1100px] mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <h1 className="text-xl font-bold">New Purchase Bill</h1>
      </div>
      <Card><CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><Label>Bill Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><Label>Supplier</Label>
          <select className="w-full h-9 border rounded px-2 bg-background text-sm" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><Label>Supplier Bill #</Label><Input value={supplierBillNo} onChange={e => setSupplierBillNo(e.target.value)} /></div>
        <div><Label>Payment Terms (days)</Label><Input type="number" value={paymentTerms} onChange={e => setPaymentTerms(Number(e.target.value))} /></div>
        <div><Label>Due Date</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
        <div><Label>VAT %</Label><Input type="number" min={0} step={0.01} value={vatPct} onChange={e => setVatPct(Number(e.target.value))} /></div>
        <div className="col-span-2"><Label>Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </CardContent></Card>
      {supplierId && (
        <Card><CardContent className="p-4 space-y-3">
          <h3 className="font-medium">Unbilled GRNs for this supplier</h3>
          <Table>
            <TableHeader><TableRow><TableHead className="w-8"></TableHead><TableHead>GRN #</TableHead><TableHead>Date</TableHead><TableHead>Inv #</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {grns.map(g => (
                <TableRow key={g.id}>
                  <TableCell><Checkbox checked={selectedGrns.has(g.id)} onCheckedChange={() => toggle(g.id)} /></TableCell>
                  <TableCell>{g.grn_number}</TableCell>
                  <TableCell>{g.grn_date}</TableCell>
                  <TableCell>{g.supplier_invoice_no || "—"}</TableCell>
                  <TableCell className="text-right">{Number(g.total_amount).toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {grns.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No unbilled GRNs</TableCell></TableRow>}
            </TableBody>
          </Table>
          <div className="flex justify-end text-sm">
            <div className="w-64 space-y-1">
              <div className="flex justify-between"><span>Subtotal</span><span>{subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>VAT</span><span>{vatAmt.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold border-t pt-1"><span>Grand Total</span><span>{grand.toFixed(2)}</span></div>
            </div>
          </div>
        </CardContent></Card>
      )}
      <div className="flex justify-end"><Button onClick={save} disabled={saving}><Save className="w-4 h-4 mr-1" />{saving ? "Saving…" : "Save Bill"}</Button></div>
    </div>
  );
}
