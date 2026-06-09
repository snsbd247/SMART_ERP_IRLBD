import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
    const { data } = await supabase.from("purchase_settings" as any).select("*").limit(1).maybeSingle();
    if (data) setS(data);
    else {
      const ins = await supabase.from("purchase_settings" as any).insert({}).select().single();
      setS(ins.data);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    const { id, created_at, updated_at, ...rest } = s;
    const { error } = await supabase.from("purchase_settings" as any).update(rest).eq("id", id);
    setSaving(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Settings saved" });
  };

  if (!s) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const T = ({ k, l }: any) => (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <Label>{l}</Label>
      <Switch checked={!!s[k]} onCheckedChange={(v) => set(k, v)} />
    </div>
  );
  const F = ({ k, l, type = "text" }: any) => (
    <div className="space-y-1"><Label>{l}</Label>
      <Input type={type} value={s[k] ?? ""} onChange={(e) => set(k, type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)} />
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
          <T k="enforce_grn_for_bill" l="Enforce GRN before Supplier Bill" />
          <T k="allow_over_receive" l="Allow Over-Receive (GRN > PO qty)" />
          <T k="allow_over_bill" l="Allow Over-Bill (Bill > GRN qty)" />
          <T k="auto_post_grn" l="Auto-post GRN to Journal" />
          <T k="auto_post_bill" l="Auto-post Bill to Journal" />
          <T k="auto_post_payment" l="Auto-post Payment to Journal" />
          <T k="enable_multi_currency" l="Enable Multi-Currency" />
          <T k="enable_landed_cost" l="Enable Landed Cost Engine" />
          <T k="enable_lc_module" l="Enable LC / Import Module" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Defaults</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <F k="default_currency" l="Default Currency" />
          <F k="default_vat_percent" l="Default VAT %" type="number" />
          <F k="default_ait_percent" l="Default AIT %" type="number" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Document Number Prefixes</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <F k="pr_prefix" l="PR Prefix" />
          <F k="po_prefix" l="PO Prefix" />
          <F k="grn_prefix" l="GRN Prefix" />
          <F k="bill_prefix" l="Bill Prefix" />
          <F k="pay_prefix" l="Payment Prefix" />
          <F k="lc_prefix" l="LC Prefix" />
        </CardContent>
      </Card>
    </div>
  );
};

export default PurchaseSettingsPage;
