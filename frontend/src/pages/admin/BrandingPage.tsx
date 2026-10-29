import { useState, useEffect, useMemo, useRef } from "react";
import { dataClient } from "@/integrations/data/client";
import { useBranding, contrastRatio, parseHsl } from "@/contexts/BrandingContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import {
  getApiBaseUrl,
  getLaravelAuthHeaders,
  isLaravelMode,
  isDataClientDisabledError,
  markDataClientUnavailable,
} from "@/lib/laravel-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Palette, Upload, Eye, Save, Building2, Globe, Type, Image as ImageIcon,
  Download, FileUp, AlertTriangle, CheckCircle2, Loader2, XCircle,
} from "lucide-react";

// Compute on each call so the auto-fallback flag (set after a 503) is honored.
const useLaravel = () => isLaravelMode();
const apiBase = () => getApiBaseUrl() || "";

/** Format a validation-error object into a single readable line. */
function formatErrors(payload: any): string {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  if (payload.errors && typeof payload.errors === "object") {
    return Object.values(payload.errors).flat().join(" • ");
  }
  return payload.message || payload.error || "";
}

const BRANDING_FIELDS = [
  { key: "software_name", label: "Software Name", icon: Type, placeholder: "SmartERP" },
  { key: "software_version", label: "Software Version", icon: Globe, placeholder: "1.0" },
  { key: "footer_text", label: "Footer Text", icon: Type, placeholder: "© 2026 SmartERP. All Rights Reserved." },
  { key: "developer_name", label: "Developer Name", icon: Building2, placeholder: "Ismail Software Solutions" },
] as const;

export default function BrandingPage() {
  const { branding, refetch, previewTheme, saveUserTheme } = useBranding();
  const { toast } = useToast();
  const [form, setForm] = useState({ ...branding });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string>("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm({ ...branding });
  }, [branding]);

  const updateField = (key: string, value: string | boolean) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Live preview — colors apply across the whole app instantly.
      if (key === "primary_color" || key === "secondary_color") {
        previewTheme(next.primary_color, next.secondary_color);
      }
      return next;
    });
  };

  const handleSave = async (attempt = 1) => {
    setSaving(true);
    setSaveStatus("saving");
    setSaveError("");
    try {
      const rows = Object.entries(form).map(([key, value]) => ({
        setting_key: key,
        setting_value: String(value ?? ""),
        updated_at: new Date().toISOString(),
      }));

      if (useLaravel()) {
        const res = await fetch(`${apiBase()}/v1/admin/branding`, {
          method: "PUT",
          headers: { ...getLaravelAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            settings: rows.map(({ setting_key, setting_value }) => ({ setting_key, setting_value })),
          }),
        });
        const payload = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        if (!res.ok) {
          const detail = formatErrors(payload) || `HTTP ${res.status}`;
          throw new Error(`Laravel API: ${detail}`);
        }
      } else {
        const { error } = await dataClient
          .from("system_settings")
          .upsert(rows, { onConflict: "setting_key" });
        if (error) {
          // Auto-fallback: legacy path returned 503 / LARAVEL_ONLY_MODE.
          if (isDataClientDisabledError(error) && getApiBaseUrl() && attempt === 1) {
            markDataClientUnavailable(error.message);
            toast({
              title: "Switching to Laravel API",
              description: "Retrying via Laravel API…",
            });
            setSaving(false);
            return handleSave(2);
          }
          throw error;
        }
      }

      // Persist per-user color override so this user's theme survives logout/refresh
      // even when the system-wide branding is set by an admin to something different.
      await saveUserTheme(form.primary_color, form.secondary_color);

      await refetch();
      setSaveStatus("saved");
      toast({ title: "Branding Updated", description: "Saved system-wide + your personal theme." });
      // Reset the inline indicator after a short delay so it doesn't linger forever.
      setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 3000);
    } catch (err: any) {
      const msg = err?.message || "Unknown error";
      setSaveStatus("error");
      setSaveError(msg);
      toast({
        title: "Save failed",
        description: `${msg} — Check your network and try again.`,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    settingKey: string,
    attempt = 1,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation mirrors the controller (2 MB, image only).
    const ALLOWED = /^image\/(png|jpe?g|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;
    if (!ALLOWED.test(file.type)) {
      toast({ title: "Unsupported file", description: `${file.type || "unknown"} — use PNG / JPG / SVG / ICO.`, variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Logo must be 2 MB or smaller.", variant: "destructive" });
      return;
    }

    setUploading(settingKey);
    try {
      let publicUrl = "";

      if (useLaravel()) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("setting_key", settingKey);
        const res = await fetch(`${apiBase()}/v1/admin/branding/logo`, {
          method: "POST",
          headers: { ...getLaravelAuthHeaders() }, // browser sets multipart boundary
          body: fd,
        });
        const payload = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        if (!res.ok) {
          const detail = formatErrors(payload) || `HTTP ${res.status}`;
          throw new Error(`Laravel API: ${detail}`);
        }
        publicUrl = payload?.data?.url || payload?.url || "";
        if (!publicUrl) throw new Error("Upload succeeded but no URL returned");
      } else {
        const ext = file.name.split(".").pop();
        const fileName = `${settingKey}_${Date.now()}.${ext}`;
        const filePath = `logos/${fileName}`;

        const { error: uploadError } = await dataClient.storage
          .from("branding")
          .upload(filePath, file, { upsert: true });
        if (uploadError) {
          if (isDataClientDisabledError(uploadError) && getApiBaseUrl() && attempt === 1) {
            markDataClientUnavailable(uploadError.message);
            toast({ title: "Switching to Laravel API", description: "Retrying upload via Laravel…" });
            setUploading(null);
            return handleLogoUpload(e, settingKey, 2);
          }
          throw uploadError;
        }

        const { data: urlData } = dataClient.storage.from("branding").getPublicUrl(filePath);
        publicUrl = urlData.publicUrl;
      }

      updateField(settingKey, publicUrl);
      toast({ title: "Logo Uploaded", description: `${settingKey.replace(/_/g, " ")} uploaded successfully.` });
    } catch (err: any) {
      toast({
        title: "Upload Failed",
        description: `${err?.message || "Unknown error"} — Try a smaller PNG/SVG, or re-upload after checking your connection.`,
        variant: "destructive",
      });
    } finally {
      setUploading(null);
    }
  };

  const hslToHex = (hsl: string): string => {
    try {
      const parts = hsl.trim().split(/\s+/);
      if (parts.length < 3) return "#3b82f6";
      const h = parseFloat(parts[0]);
      const s = parseFloat(parts[1]) / 100;
      const l = parseFloat(parts[2]) / 100;
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, "0");
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    } catch {
      return "#3b82f6";
    }
  };

  const hexToHsl = (hex: string): string => {
    try {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0;
      const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
          case g: h = ((b - r) / d + 2) * 60; break;
          case b: h = ((r - g) / d + 4) * 60; break;
        }
      }
      return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
    } catch {
      return "221 83% 53%";
    }
  };

  // ---------- Contrast validation (WCAG) ----------
  const contrast = useMemo(() => {
    const p = form.primary_color;
    const a = form.secondary_color;
    // Light-mode foreground sample (near-white) vs primary fill
    const onPrimary = contrastRatio(p, "0 0% 100%");
    const onAccent = contrastRatio(a, "161 100% 12%");
    const sidebarText = contrastRatio(p, "43 35% 88%");
    return {
      onPrimary,
      onAccent,
      sidebarText,
      pOk: onPrimary >= 4.5,
      aOk: onAccent >= 4.5,
      sOk: sidebarText >= 4.5,
    };
  }, [form.primary_color, form.secondary_color]);

  // ---------- Derived tokens (live from :root) ----------
  const [tokenTick, setTokenTick] = useState(0);
  useEffect(() => {
    // Re-read after each color change
    const id = setTimeout(() => setTokenTick((t) => t + 1), 50);
    return () => clearTimeout(id);
  }, [form.primary_color, form.secondary_color]);

  const derivedTokens = useMemo(() => {
    if (typeof window === "undefined") return [];
    const cs = getComputedStyle(document.documentElement);
    const names = [
      "--primary", "--primary-foreground", "--primary-glow",
      "--secondary", "--accent", "--accent-foreground", "--ring",
      "--background", "--foreground", "--card", "--popover",
      "--muted", "--muted-foreground", "--border", "--input",
      "--sidebar-background", "--sidebar-foreground",
      "--sidebar-primary", "--sidebar-primary-foreground",
      "--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-border",
    ];
    return names.map((n) => ({ name: n, value: cs.getPropertyValue(n).trim() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenTick]);

  // ---------- Export / Import ----------
  const handleExport = () => {
    const payload = {
      _type: "smarterp-branding-theme",
      _version: 1,
      exported_at: new Date().toISOString(),
      branding: form,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `branding-theme-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Theme exported", description: "JSON file downloaded — share it with other environments." });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const b = data?.branding || data;
      if (!b || typeof b !== "object" || !b.primary_color) {
        throw new Error("Invalid theme file");
      }
      const next = { ...form, ...b };
      setForm(next);
      previewTheme(next.primary_color, next.secondary_color);
      toast({ title: "Theme imported", description: "Click Save Changes to persist across users." });
    } catch (err: any) {
      toast({ title: "Import failed", description: err?.message || "Invalid JSON", variant: "destructive" });
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };


  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Palette className="w-6 h-6 text-primary" />
            Branding & White-Label
          </h1>
          <p className="text-muted-foreground text-sm">Configure your ERP visual identity and branding</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImport}
          />
          <Button variant="outline" onClick={() => importRef.current?.click()}>
            <FileUp className="w-4 h-4 mr-2" /> Import
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" /> Export
          </Button>
          <Button variant="outline" onClick={() => setPreviewMode(!previewMode)}>
            <Eye className="w-4 h-4 mr-2" />{previewMode ? "Close Preview" : "Preview"}
          </Button>
          <div className="flex items-center gap-2" data-testid="save-status" data-status={saveStatus}>
            {saveStatus === "saving" && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Saving…
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="text-xs text-success flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Saved
              </span>
            )}
            {saveStatus === "error" && (
              <span className="text-xs text-destructive flex items-center gap-1" title={saveError}>
                <XCircle className="w-3 h-3" /> Failed
              </span>
            )}
            <Button onClick={() => handleSave()} disabled={saving} data-testid="branding-save">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Text Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Type className="w-4 h-4" /> Identity Settings</CardTitle>
            <CardDescription>Configure software name, version, and footer</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {BRANDING_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-xs font-medium">{field.label}</Label>
                <Input
                  value={(form as any)[field.key] || ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Theme Colors */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Palette className="w-4 h-4" /> Theme Colors</CardTitle>
            <CardDescription>Customize the ERP color scheme (HSL format)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Primary Color</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={hslToHex(form.primary_color)}
                  onChange={(e) => updateField("primary_color", hexToHsl(e.target.value))}
                  className="w-10 h-10 rounded border border-input cursor-pointer"
                />
                <Input
                  value={form.primary_color}
                  onChange={(e) => updateField("primary_color", e.target.value)}
                  placeholder="221 83% 53%"
                  className="flex-1"
                />
                <div className="w-8 h-8 rounded" style={{ background: `hsl(${form.primary_color})` }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Secondary Color</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={hslToHex(form.secondary_color)}
                  onChange={(e) => updateField("secondary_color", hexToHsl(e.target.value))}
                  className="w-10 h-10 rounded border border-input cursor-pointer"
                />
                <Input
                  value={form.secondary_color}
                  onChange={(e) => updateField("secondary_color", e.target.value)}
                  placeholder="220 14% 96%"
                  className="flex-1"
                />
                <div className="w-8 h-8 rounded" style={{ background: `hsl(${form.secondary_color})` }} />
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">White-Label Mode</Label>
                <p className="text-xs text-muted-foreground">Hide developer branding and default ERP name</p>
              </div>
              <Switch
                checked={form.white_label_mode}
                onCheckedChange={(v) => updateField("white_label_mode", v)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Logo Management intentionally hidden — no logos used in this build. */}
      </div>

      {/* Live Preview */}
      {previewMode && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Sidebar Preview */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Sidebar Header</Label>
                <div className="rounded-lg p-4 max-w-[240px]" style={{ background: `hsl(${form.primary_color} / 0.05)`, border: "1px solid hsl(var(--border))" }}>
                  <span className="font-bold text-sm text-foreground">{form.software_name || "SmartERP"}</span>
                </div>
              </div>

              {/* Login Preview */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Login Page Header</Label>
                <div className="rounded-lg p-6 text-center max-w-xs" style={{ background: `hsl(${form.primary_color})` }}>
                  <h3 className="text-white font-bold text-lg">{form.software_name || "SmartERP"}</h3>
                  <p className="text-white/70 text-xs">v{form.software_version || "1.0"}</p>
                </div>
              </div>

              {/* Footer Preview */}
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Footer</Label>
                <div className="rounded-lg p-3 bg-muted text-center text-xs text-muted-foreground">
                  {form.footer_text || "© 2026 SmartERP. All Rights Reserved."}
                  {!form.white_label_mode && form.developer_name && (
                    <span> | Developed by {form.developer_name}</span>
                  )}
                  {form.software_version && <span> | Version {form.software_version}</span>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- Contrast Validation ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Contrast Validation (WCAG AA ≥ 4.5)
          </CardTitle>
          <CardDescription>
            Ensures text and icons stay readable on your brand surfaces — checked live in both light & dark mode.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "White text on Primary", ratio: contrast.onPrimary, ok: contrast.pOk },
            { label: "Dark text on Accent", ratio: contrast.onAccent, ok: contrast.aOk },
            { label: "Sidebar text on Primary", ratio: contrast.sidebarText, ok: contrast.sOk },
          ].map((c) => (
            <div key={c.label} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className="font-semibold tabular-nums">{c.ratio.toFixed(2)} : 1</div>
              </div>
              {c.ok ? (
                <Badge className="gap-1"><CheckCircle2 className="w-3 h-3" /> Pass</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> Low</Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ---------- Derived Theme Tokens ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="w-4 h-4" /> Derived Theme Tokens
          </CardTitle>
          <CardDescription>
            Live values applied to <code>:root</code>. Every component (button, card, table, sidebar) reads these.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {derivedTokens.map((t) => (
              <div key={t.name} className="flex items-center gap-3 rounded-md border p-2">
                <div
                  className="w-8 h-8 rounded border shrink-0"
                  style={{ background: `hsl(${t.value})` }}
                />
                <div className="min-w-0">
                  <div className="text-xs font-mono truncate">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate">{t.value || "—"}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
