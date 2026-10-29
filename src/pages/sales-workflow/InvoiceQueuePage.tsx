import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { swApi } from "@/lib/sales-workflow-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";

import { DateInput } from "@/components/ui/date-input";
export default function InvoiceQueuePage() {
  const nav = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState("");
  const [eligible, setEligible] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"single" | "same_day" | "custom">("custom");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => { dataClient.from("customers").select("id,name").order("name").then(({ data }) => setCustomers(data || [])); }, []);
  useEffect(() => { swApi.eligibleVatChallans(customer || undefined, date || undefined).then((r) => setEligible(r.data || [])); }, [customer, date]);

  const submit = async () => {
    if (selected.size === 0) return toast({ title: "Select at least one VAT challan", variant: "destructive" });
    const cust = eligible.find((e) => selected.has(e.id))?.customer_id;
    const allSame = [...selected].every((id) => eligible.find((e) => e.id === id)?.customer_id === cust);
    if (!allSame) return toast({ title: "All challans must be from same customer", variant: "destructive" });
    if (mode === "single" && selected.size !== 1) return toast({ title: "Single mode requires exactly 1 challan", variant: "destructive" });
    const { data, error } = await swApi.createInvoice({ invoice_date: invoiceDate, customer_id: cust!, mode }, [...selected]);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: `Invoice ${data?.invoice_number} created` });
    nav(`/sales-workflow/invoice/${data?.id}`);
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Invoice Processing Queue</h1>
      <Card className="p-4 grid md:grid-cols-4 gap-3 items-end">
        <div><label className="text-sm">Customer</label>
          <select className="w-full border rounded px-2 h-10 bg-background" value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label className="text-sm">Challan Date</label><DateInput value={date} onChange={(v) => setDate(v)} /></div>
        <div><label className="text-sm">Invoice Mode</label>
          <select className="w-full border rounded px-2 h-10 bg-background" value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="single">Single Challan</option><option value="same_day">Same-day Consolidation</option><option value="custom">Custom (multi-pick)</option>
          </select>
        </div>
        <div><label className="text-sm">Invoice Date</label><DateInput value={invoiceDate} onChange={(v) => setInvoiceDate(v)} /></div>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead></TableHead><TableHead>VAT Challan</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">View</TableHead></TableRow></TableHeader>
          <TableBody>
            {eligible.map((v) => (
              <TableRow key={v.id}>
                <TableCell><Checkbox checked={selected.has(v.id)} onCheckedChange={() => { const s = new Set(selected); s.has(v.id) ? s.delete(v.id) : s.add(v.id); setSelected(s); }} /></TableCell>
                <TableCell>{v.challan_number}</TableCell><TableCell>{v.challan_date}</TableCell><TableCell>{v.customer?.name}</TableCell>
                <TableCell className="text-right">{Number(v.grand_total).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <a href={`/sales-workflow/vat-challan/${v.id}`} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="ghost">View</Button>
                  </a>
                </TableCell>
              </TableRow>
            ))}
            {eligible.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No eligible VAT challans (all DCs must be HO-received)</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <div className="flex justify-end"><Button onClick={submit} disabled={selected.size === 0}>Generate Invoice</Button></div>
    </div>
  );
}
