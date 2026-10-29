import { useEffect, useState } from "react";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Settings, Building2, DollarSign, Sliders, Upload, Loader2, Puzzle } from "lucide-react";
import type { CompanySettings } from "@/hooks/useCompanySettings";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useModules, type ModuleKey } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { getApiBaseUrl, getLaravelAuthHeaders, isLaravelMode, isDataClientDisabledError, markDataClientUnavailable } from "@/lib/laravel-auth";

interface Branch { id: string; name: string; }
interface FinancialYear { id: string; name: string; is_active: boolean; }

const fallbackSettings: CompanySettings = {
  id: "default",
  company_name: "My Company",
  company_logo_url: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  currency_name: "US Dollar",
  currency_code: "USD",
  currency_symbol: "$",
  currency_position: "before",
  default_branch_id: null,
  default_financial_year_id: null,
  bin_number: null,
};

const apiBase = () => getApiBaseUrl() || "";

function unwrapLaravelRow(payload: any): CompanySettings | null {
  return (payload?.data ?? payload ?? null) as CompanySettings | null;
}

const GeneralSettingsPage = () => {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { refetch: refetchCurrency } = useCurrency();
  const { modules, isModuleEnabled, toggleModule } = useModules();
  const { isSuperAdmin } = useAuth();

  const loadLaravelSettings = async () => {
    const res = await fetch(`${apiBase()}/v1/settings/company`, { headers: getLaravelAuthHeaders() });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
    return unwrapLaravelRow(payload) || fallbackSettings;
  };

  const loadDataClientSettings = async () => {
    const { data, error } = await dataClient
      .from("company_settings" as any)
      .select("*")
      .maybeSingle();
    if (error) {
      if (isDataClientDisabledError(error) && getApiBaseUrl()) {
        markDataClientUnavailable(error.message);
        return loadLaravelSettings();
      }
      throw error;
    }
    return ((data as any) || fallbackSettings) as CompanySettings;
  };

  // Prefer Laravel API whenever an API base is configured (VPS deploy). The
  // The legacy path is never used in production. We never silently mix
  // sources: save and load always use the same backend.
  const isLaravelApi = () => !!getApiBaseUrl();

  const loadBranchesAndYears = async (): Promise<[Branch[], FinancialYear[]]> => {
    if (isLaravelApi()) {
      const base = apiBase();
      const headers = getLaravelAuthHeaders();
      const [bRes, yRes] = await Promise.all([
        fetch(`${base}/v1/db/branches?select=id,name&f[status][eq]=active&limit=1000`, { headers }).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
        fetch(`${base}/v1/db/financial_years?select=id,name,is_active&order[start_date]=desc&limit=1000`, { headers }).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
      ]);
      return [(bRes?.data || bRes || []) as Branch[], (yRes?.data || yRes || []) as FinancialYear[]];
    }
    const [bRes, yRes] = await Promise.all([
      dataClient.from("branches").select("id, name").eq("status", "active"),
      dataClient.from("financial_years").select("id, name, is_active").order("start_date", { ascending: false }),
    ]);
    return [(bRes.data || []) as Branch[], (yRes.data || []) as FinancialYear[]];
  };

  useEffect(() => {
    const init = async () => {
      try {
        const settingsRow = isLaravelApi() ? await loadLaravelSettings() : await loadDataClientSettings();
        setSettings(settingsRow);
        try {
          const [b, y] = await loadBranchesAndYears();
          setBranches(b);
          setYears(y);
        } catch (e) {
          console.warn("[GeneralSettings] branches/years load failed", e);
        }
      } catch (e: any) {
        console.error("[GeneralSettings] load failed", e);
        toast.error("Failed to load settings: " + (e?.message || "Unknown error"));
        setSettings(fallbackSettings);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const update = (field: keyof CompanySettings, value: string | null) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  const validateBin = (bin: string | null | undefined): string | null => {
    const raw = (bin || "").trim();
    if (!raw) return "BIN Number is required (used on VAT Challan 6.3).";
    const digits = raw.replace(/[\s-]/g, "");
    if (!/^\d+$/.test(digits)) return "BIN must contain only digits (hyphens/spaces allowed).";
    if (digits.length < 9 || digits.length > 13) return "BIN must be between 9 and 13 digits.";
    return null;
  };

  const handleSave = async (attempt = 1) => {
    if (!settings) return;
    const binError = validateBin(settings.bin_number);
    if (binError) { toast.error(binError); return; }
    setSaving(true);
    const { id, ...rest } = settings;
    try {
      if (isLaravelApi()) {
        const res = await fetch(`${apiBase()}/v1/settings/company`, {
          method: "PUT",
          headers: { ...getLaravelAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(rest),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
        const fresh = unwrapLaravelRow(payload);
        if (fresh) setSettings(fresh);
      } else {
        const { data, error } = await dataClient
          .from("company_settings" as any)
          .upsert({ id: "default", ...rest, updated_at: new Date().toISOString() } as any, { onConflict: "id" })
          .select()
          .maybeSingle();
        if (error) {
          if (isDataClientDisabledError(error) && getApiBaseUrl() && attempt === 1) {
            markDataClientUnavailable(error.message);
            return handleSave(2);
          }
          throw error;
        }
        if (data) setSettings(data as any);
      }
      toast.success("Settings saved successfully");
      refetchCurrency();
    } catch (error: any) {
      toast.error("Failed to save settings: " + (error?.message || "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2MB");
      return;
    }
    setUploading(true);
    try {
      if (isLaravelApi()) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("setting_key", "company_logo_url");
        const res = await fetch(`${getApiBaseUrl()}/v1/admin/branding/logo`, {
          method: "POST",
          headers: getLaravelAuthHeaders(),
          body: fd,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
        const url = payload?.data?.url || payload?.url;
        if (!url) throw new Error("Upload succeeded but no logo URL was returned");
        update("company_logo_url", url);
      } else {
        const ext = file.name.split(".").pop();
        const path = `logo.${ext}`;
        const { error: upErr } = await dataClient.storage.from("branding").upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = dataClient.storage.from("branding").getPublicUrl(path);
        update("company_logo_url", urlData.publicUrl);
      }
      toast.success("Logo uploaded");
    } catch (error: any) {
      toast.error("Logo upload failed: " + (error?.message || "Unknown error"));
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) return <div className="p-6 text-destructive">Failed to load settings</div>;

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">General Settings</h1>
        </div>
        <Button onClick={() => handleSave()} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          Save Settings
        </Button>
      </div>

      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company"><Building2 className="w-3.5 h-3.5 mr-1" />Company</TabsTrigger>
          <TabsTrigger value="currency"><DollarSign className="w-3.5 h-3.5 mr-1" />Currency</TabsTrigger>
          <TabsTrigger value="defaults"><Sliders className="w-3.5 h-3.5 mr-1" />Defaults</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="modules"><Puzzle className="w-3.5 h-3.5 mr-1" />Modules</TabsTrigger>}
        </TabsList>

        <TabsContent value="company">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company Information</CardTitle>
              <CardDescription>This information appears on all reports and invoices.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Logo */}
              <div className="space-y-2">
                <Label>Company Logo</Label>
                <div className="flex items-center gap-4">
                  {settings.company_logo_url ? (
                    <img src={settings.company_logo_url} alt="Logo" className="h-16 w-16 object-contain rounded-md border border-border" />
                  ) : (
                    <div className="h-16 w-16 rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground">
                      <Upload className="w-5 h-5" />
                    </div>
                  )}
                  <div>
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
                      <Button variant="outline" size="sm" asChild disabled={uploading}>
                        <span>{uploading ? "Uploading..." : "Upload Logo"}</span>
                      </Button>
                    </label>
                    {settings.company_logo_url && (
                      <Button variant="ghost" size="sm" className="ml-2 text-destructive" onClick={() => update("company_logo_url", null)}>
                        Remove
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">Max 2MB. JPG, PNG or SVG.</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Company Name *</Label>
                  <Input value={settings.company_name} onChange={e => update("company_name", e.target.value)} placeholder="Your Company Name" />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={settings.email || ""} onChange={e => update("email", e.target.value)} placeholder="info@company.com" />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={settings.phone || ""} onChange={e => update("phone", e.target.value)} placeholder="+1 234 567 890" />
                </div>
                <div className="space-y-2">
                  <Label>Website</Label>
                  <Input value={settings.website || ""} onChange={e => update("website", e.target.value)} placeholder="https://company.com" />
                </div>
                <div className="space-y-2">
                  <Label>BIN Number</Label>
                  <Input
                    value={settings.bin_number || ""}
                    onChange={e => update("bin_number" as any, e.target.value)}
                    placeholder="e.g. 000000000-0000 (required for VAT Challan 6.3)"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input value={settings.address || ""} onChange={e => update("address", e.target.value)} placeholder="Full company address" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="currency">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Currency Setup</CardTitle>
              <CardDescription>Configure the system-wide currency for all transactions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Currency Name</Label>
                  <Input value={settings.currency_name} onChange={e => update("currency_name", e.target.value)} placeholder="US Dollar" />
                </div>
                <div className="space-y-2">
                  <Label>Currency Code</Label>
                  <Input value={settings.currency_code} onChange={e => update("currency_code", e.target.value.toUpperCase())} placeholder="USD" maxLength={5} />
                </div>
                <div className="space-y-2">
                  <Label>Currency Symbol</Label>
                  <Input value={settings.currency_symbol} onChange={e => update("currency_symbol", e.target.value)} placeholder="$" maxLength={5} />
                </div>
                <div className="space-y-2">
                  <Label>Symbol Position</Label>
                  <Select value={settings.currency_position} onValueChange={v => update("currency_position", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="before">Before amount ({settings.currency_symbol}100)</SelectItem>
                      <SelectItem value="after">After amount (100{settings.currency_symbol})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 p-3 rounded-md bg-muted/50 text-sm">
                <span className="text-muted-foreground">Preview: </span>
                <span className="font-medium text-foreground">
                  {settings.currency_position === "before"
                    ? `${settings.currency_symbol}1,250.00`
                    : `1,250.00${settings.currency_symbol}`
                  }
                </span>
                <span className="text-muted-foreground ml-2">({settings.currency_code})</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="defaults">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Default System Settings</CardTitle>
              <CardDescription>Set default values used across the system.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Default Branch</Label>
                  <Select value={settings.default_branch_id || ""} onValueChange={v => update("default_branch_id", v || null)}>
                    <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Default Financial Year</Label>
                  <Select value={settings.default_financial_year_id || ""} onValueChange={v => update("default_financial_year_id", v || null)}>
                    <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                    <SelectContent>
                      {years.map(y => (
                        <SelectItem key={y.id} value={y.id}>
                          {y.name} {y.is_active ? "(Active)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-border space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label className="text-sm font-medium">Public Employee Registration</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      When enabled, a public registration form is available at <code className="text-foreground">/register-employee</code> and a link appears on the login page. Submissions are created as inactive employees pending admin approval.
                    </p>
                  </div>
                  <Switch
                    checked={!!settings.public_employee_registration_enabled}
                    onCheckedChange={(v) => setSettings({ ...settings, public_employee_registration_enabled: v })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="modules">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Module Configuration</CardTitle>
                <CardDescription>Enable or disable ERP modules. Disabling a module hides its menus and features but preserves all existing data.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Sales Mode — mutually exclusive */}
                <div className="p-4 rounded-lg border border-border bg-muted/30 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Sales Mode</p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                      Choose ONE sales system. Switching hides the other system's menu but preserves its data.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {(() => {
                      const basicOn = isModuleEnabled("sales_basic" as ModuleKey);
                      const vatOn = isModuleEnabled("sales_vat" as ModuleKey);
                      // Mutual exclusion: if both on, prefer VAT; if neither, default Basic
                      const selectedKey: ModuleKey = vatOn && basicOn
                        ? ("sales_vat" as ModuleKey)
                        : vatOn
                        ? ("sales_vat" as ModuleKey)
                        : basicOn
                        ? ("sales_basic" as ModuleKey)
                        : ("sales_basic" as ModuleKey);
                      return [
                        { key: "sales_basic" as ModuleKey, name: "Basic Sales", desc: "Direct flow: Invoice → Payment. Best for counter sales, simple B2C." },
                        { key: "sales_vat" as ModuleKey, name: "Bangladesh VAT Sales Workflow", desc: "Full flow: PO → VAT Challan (Mushak 6.3) → Delivery → Invoice → Bill Submit → Payment + TDS → Mushak 9.1. Required for NBR-compliant B2B sales." },
                      ].map((mod) => {
                        const active = selectedKey === mod.key;
                        return (
                          <button
                            key={mod.key}
                            type="button"
                            onClick={async () => {
                              if (active) return;
                              const other = mod.key === "sales_basic" ? "sales_vat" : "sales_basic";
                              await toggleModule(other as ModuleKey, false);
                              await toggleModule(mod.key, true);
                            }}
                            className={`text-left p-3 rounded-md border transition-colors ${
                              active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-accent/50"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${active ? "border-primary" : "border-muted-foreground"}`}>
                                {active && <div className="w-2 h-2 rounded-full bg-primary" />}
                              </div>
                              <p className="text-sm font-medium text-foreground">{mod.name}</p>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed mt-1 ml-6">{mod.desc}</p>
                          </button>
                        );
                      });
                    })()}
                  </div>

                </div>

                {([
                  { key: "accounts" as ModuleKey, name: "Accounting Module", desc: "Chart of Accounts, Journal/Payment/Receipt/Contra Vouchers. Core double-entry accounting system." },
                  { key: "purchase" as ModuleKey, name: "Purchase Module", desc: "Purchase Entry, Purchase Returns, Supplier management, and Purchase Reports." },
                  { key: "inventory" as ModuleKey, name: "Inventory Module", desc: "Items, Categories, Units, Warehouses, Stock Ledger, Stock Transfer, Stock Reports. When OFF, Sales and Purchases work without stock tracking." },
                  { key: "manufacturing" as ModuleKey, name: "Manufacturing Module", desc: "Bill of Materials, Production Entries, Raw Materials tracking, and Manufacturing Reports." },
                  { key: "bank" as ModuleKey, name: "Bank & Cash Module", desc: "Bank Accounts and Cash Book management for tracking banking transactions." },
                  { key: "hrm" as ModuleKey, name: "HRM Module", desc: "Employees, Departments, Attendance, Leave, Payroll, Documents, ID Cards, and Employee Portal." },
                  { key: "reports" as ModuleKey, name: "Reports Module", desc: "Financial Reports, Stock Ledger, Production Reports, and other analytical reports." },
                  { key: "multi_warehouse" as ModuleKey, name: "Multi Warehouse System", desc: "Warehouse selection on stock operations. When OFF, all stock belongs to a single default warehouse." },
                  { key: "multi_branch" as ModuleKey, name: "Multi Branch System", desc: "Branch selector and multi-branch transactions. When OFF, system operates as a single-company ERP using the default branch." },
                ]).map((mod) => (
                  <div key={mod.key} className="flex items-start justify-between gap-4 p-4 rounded-lg border border-border">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{mod.name}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{mod.desc}</p>
                    </div>
                    <Switch
                      checked={isModuleEnabled(mod.key)}
                      onCheckedChange={(checked) => toggleModule(mod.key, checked)}
                    />
                  </div>
                ))}
                <div className="p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
                  <strong>Note:</strong> Disabling a module does NOT delete any data. All records remain stored but inactive. Changes are logged in Activity Logs.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default GeneralSettingsPage;
