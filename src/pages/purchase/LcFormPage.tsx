import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { nextDocNo, logAudit } from "@/lib/purchase-numbering";

import { DateInput } from "@/components/ui/date-input";
const LcFormPage = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [header, setHeader] = useState<any>({
    lc_no: "", lc_date: new Date().toISOString().slice(0, 10), expiry_date: "",
    supplier_id: "", branch_id: "", bank_name: "", lc_type: "sight",
    currency: "USD", exchange_rate: 110, lc_amount: 0, margin_pct: 10, margin_amount: 0, notes: "",
  });

  useEffect(() => {
    (async () => {
      const [s, b] = await Promise.all([
        supabase.from("suppliers" as any).select("id,name").eq("is_active", true),
        supabase.from("branches").select("id,name"),
      ]);
      setSuppliers((s.data || []) as any); setBranches((b.data || []) as any);
      if (id) {
        const { data } = await supabase.from("lc_documents" as any).select("*").eq("id", id).maybeSingle();
        if (data) setHeader(data as any);
      } else {
        const no = await nextDocNo("LC", "lc_documents", "lc_no");
        setHeader((h: any) => ({ ...h, lc_no: no }));
      }
    })();
  }, [id]);

  const margin = +(Number(header.lc_amount || 0) * Number(header.margin_pct || 0) / 100).toFixed(2);

  const save = async () => {
    if (!header.supplier_id || !header.lc_amount) { toast.error("Supplier and amount required"); return; }
    const payload = { ...header, margin_amount: margin };
    const op = id
      ? supabase.from("lc_documents" as any).update(payload).eq("id", id).select("id").single()
      : supabase.from("lc_documents" as any).insert(payload).select("id").single();
    const { data, error } = await op;
    if (error) return toast.error(error.message);
    const lcId = (data as any).id as string;
    await logAudit({ document_type: "LC", document_id: lcId, document_no: header.lc_no, action: id ? "updated" : "created" });
    toast.success("LC saved");
    nav(`/purchase/lc/${lcId}`);
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">{id ? "Edit LC" : "New Letter of Credit"}</h1>
      <Card><CardContent className="p-4 grid md:grid-cols-3 gap-3">
        <div><Label>LC #</Label><Input value={header.lc_no} onChange={e => setHeader({ ...header, lc_no: e.target.value })} /></div>
        <div><Label>LC Date</Label><DateInput value={header.lc_date} onChange={(v) => setHeader({ ...header, lc_date: v })} /></div>
        <div><Label>Expiry</Label><DateInput value={header.expiry_date || ""} onChange={(v) => setHeader({ ...header, expiry_date: v })} /></div>
        <div><Label>Supplier</Label>
          <Select value={header.supplier_id} onValueChange={v => setHeader({ ...header, supplier_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Branch</Label>
          <Select value={header.branch_id || ""} onValueChange={v => setHeader({ ...header, branch_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Bank Name</Label><Input value={header.bank_name || ""} onChange={e => setHeader({ ...header, bank_name: e.target.value })} /></div>
        <div><Label>LC Type</Label>
          <Select value={header.lc_type} onValueChange={v => setHeader({ ...header, lc_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sight">Sight</SelectItem><SelectItem value="usance">Usance</SelectItem><SelectItem value="back_to_back">Back-to-Back</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Currency</Label><Input value={header.currency} onChange={e => setHeader({ ...header, currency: e.target.value })} /></div>
        <div><Label>Exchange Rate</Label><Input type="number" value={header.exchange_rate} onChange={e => setHeader({ ...header, exchange_rate: +e.target.value })} /></div>
        <div><Label>LC Amount ({header.currency})</Label><Input type="number" value={header.lc_amount} onChange={e => setHeader({ ...header, lc_amount: +e.target.value })} /></div>
        <div><Label>Margin %</Label><Input type="number" value={header.margin_pct} onChange={e => setHeader({ ...header, margin_pct: +e.target.value })} /></div>
        <div><Label>Margin Amount</Label><Input value={margin} disabled /></div>
        <div className="md:col-span-3"><Label>Notes</Label><Textarea value={header.notes || ""} onChange={e => setHeader({ ...header, notes: e.target.value })} /></div>
      </CardContent></Card>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => nav(-1)}>Cancel</Button>
        <Button onClick={save}><Save className="w-4 h-4 mr-1" />Save</Button>
      </div>
    </div>
  );
};

export default LcFormPage;
