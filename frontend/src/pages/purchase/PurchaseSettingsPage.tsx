import { useEffect, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Settings2, Save } from "lucide-react";

const PurchaseSettingsPage = () => {
  const [s, setS] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    const { data } = await dataClient.from("purchase_settings" as any).select("*").limit(1).maybeSingle();
    if (data) setS(data);
    else {
      const ins = await dataClient.from("purchase_settings" as any).insert({}).select().single();
      setS(ins.data);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    const { id, created_at, updated_at, ...rest } = s;
    const { error } = await dataClient.from("purchase_settings" as any).update(rest).eq("id", id);
    setSaving(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Settings saved" });
  };

  if (!s) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const set = (k: string, v: any) => setS({ ...s, [k]: v });

  const Toggle = (k: string, l: string) => (
    <div key={k} className="flex items-center justify-between py-2 border-b last:border-0">
      <Label>{l}</Label>
      <Switch checked={!!s[k]} onCheckedChange={(v) => set(k, v)} />
    </div>
  );
  const Field = (k: string, l: string, type: string = "text") => (
    <div key={k} className="space-y-1"><Label>{l}</Label>
      <Input
        type={type}
        value={s[k] ?? ""}
        onChange={(e) => set(k, type === "number" ? (parseFloat(e.target.value) || 0) : e.target.value)}
      />
    </div>
  );

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Settings2 className="w-5 h-5 text-primary" /><h1 className="text-xl font-semibold">Purchase Settings</h1></div>
        <Button size="sm" onClick={save} disabled={saving}><Save className="w-4 h-4 mr-1" />{saving ? "Saving…" : "Save"}</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Workflow Rules</CardTitle></CardHeader>
        <CardContent className="space-y-0">
          {Toggle("enforce_grn_for_bill", "Enforce GRN before Supplier Bill")}
          {Toggle("allow_over_receive", "Allow Over-Receive (GRN > PO qty)")}
          {Toggle("allow_over_bill", "Allow Over-Bill (Bill > GRN qty)")}
          {Toggle("auto_post_grn", "Auto-post GRN to Journal")}
          {Toggle("auto_post_bill", "Auto-post Bill to Journal")}
          {Toggle("auto_post_payment", "Auto-post Payment to Journal")}
          {Toggle("enable_multi_currency", "Enable Multi-Currency")}
          {Toggle("enable_landed_cost", "Enable Landed Cost Engine")}
          {Toggle("enable_lc_module", "Enable LC / Import Module")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Defaults</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Field("default_currency", "Default Currency")}
          {Field("default_vat_percent", "Default VAT %", "number")}
          {Field("default_ait_percent", "Default AIT %", "number")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Document Number Prefixes</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Field("pr_prefix", "PR Prefix")}
          {Field("po_prefix", "PO Prefix")}
          {Field("grn_prefix", "GRN Prefix")}
          {Field("bill_prefix", "Bill Prefix")}
          {Field("pay_prefix", "Payment Prefix")}
          {Field("lc_prefix", "LC Prefix")}
        </CardContent>
      </Card>
    </div>
  );
};

export default PurchaseSettingsPage;
