import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Edit, Printer, Globe } from "lucide-react";

import { DateInput } from "@/components/ui/date-input";
const CHARGE_TYPES = ["LC Opening", "Margin", "Freight", "Insurance", "Customs Duty", "VAT", "AIT", "C&F", "Other"];

const LcDetailPage = () => {
  const { id } = useParams();
  const [lc, setLc] = useState<any>(null);
  const [supplier, setSupplier] = useState<any>(null);
  const [charges, setCharges] = useState<any[]>([]);
  const [newCharge, setNewCharge] = useState<any>({ charge_type: "Freight", amount: 0, description: "", charge_date: new Date().toISOString().slice(0, 10) });

  const load = async () => {
    const { data: h } = await dataClient.from("lc_documents" as any).select("*").eq("id", id).maybeSingle();
    const { data: c } = await dataClient.from("lc_charges" as any).select("*").eq("lc_id", id).order("created_at");
    setLc(h); setCharges((c || []) as any);
    if ((h as any)?.supplier_id) {
      const { data: s } = await dataClient.from("suppliers" as any).select("name").eq("id", (h as any).supplier_id).maybeSingle();
      setSupplier(s);
    }
  };
  useEffect(() => { if (id) load(); }, [id]);

  const addCharge = async () => {
    if (!newCharge.amount) return toast.error("Amount required");
    await dataClient.from("lc_charges" as any).insert({ ...newCharge, lc_id: id });
    await recalcLanded();
    setNewCharge({ charge_type: "Freight", amount: 0, description: "", charge_date: new Date().toISOString().slice(0, 10) });
    load();
  };
  const removeCharge = async (cid: string) => {
    await dataClient.from("lc_charges" as any).delete().eq("id", cid);
    await recalcLanded();
    load();
  };
  const recalcLanded = async () => {
    const { data: c } = await dataClient.from("lc_charges" as any).select("amount").eq("lc_id", id);
    const total = ((c || []) as any[]).reduce((s: number, x: any) => s + Number(x.amount || 0), 0);
    const lcBdt = Number(lc?.lc_amount || 0) * Number(lc?.exchange_rate || 1);
    await dataClient.from("lc_documents" as any).update({ total_charges: total, landed_cost: lcBdt + total }).eq("id", id);
  };

  if (!lc) return <div className="p-6">Loading…</div>;
  const lcBdt = Number(lc.lc_amount) * Number(lc.exchange_rate);
  const totalCharges = charges.reduce((s, c) => s + Number(c.amount || 0), 0);

  return (
    <div className="p-6 space-y-4 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold">LC {lc.lc_no}</h1>
          <Badge>{lc.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to={`/purchase/lc/${lc.id}/edit`}><Edit className="w-4 h-4 mr-1" />Edit</Link></Button>
          <Button className="print:hidden" variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" />Print</Button>
        </div>
      </div>
      <Card><CardContent className="p-4 grid md:grid-cols-4 gap-3 text-sm">
        <div><div className="text-muted-foreground">Supplier</div><div className="font-medium">{supplier?.name || "—"}</div></div>
        <div><div className="text-muted-foreground">Bank</div><div>{lc.bank_name || "—"}</div></div>
        <div><div className="text-muted-foreground">Type</div><div>{lc.lc_type}</div></div>
        <div><div className="text-muted-foreground">Expiry</div><div>{lc.expiry_date || "—"}</div></div>
        <div><div className="text-muted-foreground">LC Amount</div><div className="font-semibold">{Number(lc.lc_amount).toLocaleString()} {lc.currency}</div></div>
        <div><div className="text-muted-foreground">Ex. Rate</div><div>{lc.exchange_rate}</div></div>
        <div><div className="text-muted-foreground">LC (BDT)</div><div className="font-mono">{lcBdt.toLocaleString()}</div></div>
        <div><div className="text-muted-foreground">Margin</div><div>{lc.margin_pct}% = {Number(lc.margin_amount).toLocaleString()}</div></div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="p-3 text-sm font-medium border-b flex justify-between">
          <span>Charges (Landed Cost Components)</span>
          <span>Total Charges: <strong className="font-mono">{totalCharges.toLocaleString()}</strong></span>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
          <TableBody>
            {charges.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell>{c.charge_date}</TableCell>
                <TableCell>{c.charge_type}</TableCell>
                <TableCell>{c.description || "—"}</TableCell>
                <TableCell className="text-right font-mono">{Number(c.amount).toLocaleString()} {c.currency}</TableCell>
                <TableCell><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeCharge(c.id)}><Trash2 className="w-3.5 h-3.5" /></Button></TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell><DateInput value={newCharge.charge_date} onChange={(v) => setNewCharge({ ...newCharge, charge_date: v })} /></TableCell>
              <TableCell>
                <Select value={newCharge.charge_type} onValueChange={v => setNewCharge({ ...newCharge, charge_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CHARGE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </TableCell>
              <TableCell><Input value={newCharge.description} onChange={e => setNewCharge({ ...newCharge, description: e.target.value })} placeholder="Description" /></TableCell>
              <TableCell><Input type="number" value={newCharge.amount} onChange={e => setNewCharge({ ...newCharge, amount: +e.target.value })} /></TableCell>
              <TableCell><Button size="icon" className="h-7 w-7" onClick={addCharge}><Plus className="w-3.5 h-3.5" /></Button></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent></Card>

      <Card><CardContent className="p-4 grid md:grid-cols-3 gap-3 text-sm">
        <div><Label>LC Value (BDT)</Label><div className="font-mono text-lg">{lcBdt.toLocaleString()}</div></div>
        <div><Label>Total Charges</Label><div className="font-mono text-lg">{totalCharges.toLocaleString()}</div></div>
        <div><Label>Landed Cost</Label><div className="font-mono text-lg font-semibold text-primary">{(lcBdt + totalCharges).toLocaleString()}</div></div>
      </CardContent></Card>
    </div>
  );
};

export default LcDetailPage;
