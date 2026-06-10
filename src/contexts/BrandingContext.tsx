import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isLaravelMode, getApiBaseUrl, getLaravelAuthHeaders } from "@/lib/laravel-auth";

export interface BrandingSettings {
  software_name: string;
  software_version: string;
  footer_text: string;
  developer_name: string;
  white_label_mode: boolean;
  primary_color: string;
  secondary_color: string;
  company_logo_url: string;
  login_logo_url: string;
  favicon_url: string;
}

const DEFAULTS: BrandingSettings = {
  software_name: "SmartERP",
  software_version: "1.0",
  footer_text: "© 2026 SmartERP. All Rights Reserved.",
  developer_name: "Ismail Software Solutions",
  white_label_mode: false,
  // Brand: deep green primary + warm gold secondary/accent
  primary_color: "161 100% 12%",
  secondary_color: "43 55% 54%",
  company_logo_url: "",
  login_logo_url: "",
  favicon_url: "",
};

const BRANDING_KEYS = Object.keys(DEFAULTS) as (keyof BrandingSettings)[];

interface BrandingContextType {
  branding: BrandingSettings;
  loading: boolean;
  refetch: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType>({
  branding: DEFAULTS,
  loading: true,
  refetch: async () => {},
});

export const useBranding = () => useContext(BrandingContext);

export const BrandingProvider = ({ children }: { children: ReactNode }) => {
  const [branding, setBranding] = useState<BrandingSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const fetchBranding = useCallback(async () => {
    let rows: { setting_key: string; setting_value: string | null }[] = [];

    try {
      if (isLaravelMode()) {
        const base = getApiBaseUrl() || "";
        // Public endpoint — works before login (no auth header required)
        const res = await fetch(`${base}/v1/public/branding`, {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const payload = await res.json().catch(() => ({}));
          rows = payload?.data || [];
        }
      } else {
        const { data } = await supabase
          .from("system_settings")
          .select("setting_key, setting_value")
          .in("setting_key", BRANDING_KEYS);
        rows = (data as any) || [];
      }
    } catch {
      // ignore — fall back to defaults
    }

    if (rows.length > 0) {
      const merged = { ...DEFAULTS };
      rows.forEach((row) => {
        const key = row.setting_key as keyof BrandingSettings;
        if (!(key in DEFAULTS)) return;
        if (key === "white_label_mode") {
          (merged as any)[key] = row.setting_value === "true";
        } else {
          (merged as any)[key] = row.setting_value || DEFAULTS[key];
        }
      });
      setBranding(merged);
      applyThemeColors(merged.primary_color, merged.secondary_color);
      applyFavicon(merged.favicon_url);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  // Re-apply derived tokens whenever the html `dark` class flips
  // so the same two brand colors drive both light & dark palettes.
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      applyThemeColors(branding.primary_color, branding.secondary_color);
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [branding.primary_color, branding.secondary_color]);

  return (
    <BrandingContext.Provider value={{ branding, loading, refetch: fetchBranding }}>
      {children}
    </BrandingContext.Provider>
  );
};

/** Parse "H S% L%" → [h, s, l]. Returns null if unparseable. */
function parseHsl(value: string): [number, number, number] | null {
  if (!value) return null;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%?\s+(-?\d+(?:\.\d+)?)%?$/);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
}

const fmt = (h: number, s: number, l: number) =>
  `${Math.round(h)} ${Math.round(Math.max(0, Math.min(100, s)))}% ${Math.round(Math.max(0, Math.min(100, l)))}%`;

/**
 * Apply branding colors across the entire design-system token set.
 * Derives foreground, accent, ring, sidebar, gradients & shadows from the
 * two brand colors so every Tailwind class (bg-primary, text-accent, ring,
 * border, sidebar-*) follows the user's choice — for light AND dark mode.
 */
function applyThemeColors(primary: string, secondary: string) {
  const p = parseHsl(primary);
  if (!p) return;
  const [ph, ps, pl] = p;
  const s = parseHsl(secondary) || [ph, Math.min(100, ps + 10), 92];
  const [sh, ss, sl] = s;

  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(name, value);

  // Foreground that contrasts with the primary fill.
  const primaryFg = pl < 50 ? fmt(sh, Math.max(20, ss - 10), 95) : fmt(ph, 100, 10);
  const accentFg = sl < 50 ? fmt(ph, 30, 95) : fmt(ph, 100, 12);

  // ---------- shared tokens ----------
  set("--primary", fmt(ph, ps, pl));
  set("--primary-foreground", primaryFg);
  set("--primary-glow", fmt(ph, Math.max(40, ps - 20), Math.min(85, pl + 12)));

  set("--secondary", fmt(sh, ss, sl));
  set("--secondary-foreground", accentFg);

  set("--accent", fmt(sh, ss, sl));
  set("--accent-foreground", accentFg);

  set("--ring", fmt(sh, ss, sl));

  set("--sidebar-primary", fmt(sh, ss, sl));
  set("--sidebar-primary-foreground", fmt(ph, 100, Math.max(8, pl)));
  set("--sidebar-ring", fmt(sh, ss, sl));

  set(
    "--gradient-primary",
    `linear-gradient(135deg, hsl(${fmt(ph, ps, pl)}), hsl(${fmt(ph, Math.max(40, ps - 20), Math.min(80, pl + 10))}))`,
  );
  set(
    "--gradient-accent",
    `linear-gradient(135deg, hsl(${fmt(sh, ss, sl)}), hsl(${fmt(sh, Math.min(100, ss + 10), Math.min(85, sl + 10))}))`,
  );
  set("--shadow-glow", `0 0 24px hsl(${fmt(ph, ps, pl)} / 0.25)`);

  // ---------- light vs dark adjustments ----------
  const isDark = root.classList.contains("dark");
  if (isDark) {
    // Dark mode: gold/secondary becomes the prominent action color,
    // deep brand color tints surfaces.
    set("--background", fmt(ph, 35, 6));
    set("--card", fmt(ph, 35, 8));
    set("--popover", fmt(ph, 35, 8));
    set("--muted", fmt(ph, 25, 12));
    set("--border", fmt(ph, 30, 16));
    set("--input", fmt(ph, 30, 16));
    set("--sidebar-background", fmt(ph, 50, 5));
    set("--sidebar-foreground", fmt(sh, 30, 85));
    set("--sidebar-accent", fmt(ph, 40, 12));
    set("--sidebar-accent-foreground", fmt(sh, ss, 70));
    set("--sidebar-border", fmt(ph, 30, 14));
  } else {
    set("--background", "0 0% 100%");
    set("--card", "0 0% 100%");
    set("--popover", "0 0% 100%");
    set("--muted", fmt(ph, 15, 96));
    set("--border", fmt(ph, 15, 88));
    set("--input", fmt(ph, 15, 88));
    set("--sidebar-background", fmt(ph, ps, pl));
    set("--sidebar-foreground", fmt(sh, 35, 88));
    set("--sidebar-accent", fmt(ph, Math.max(40, ps - 20), Math.min(30, pl + 6)));
    set("--sidebar-accent-foreground", fmt(sh, ss, 88));
    set("--sidebar-border", fmt(ph, Math.max(40, ps - 40), Math.min(30, pl + 6)));
  }
}

function applyFavicon(url: string) {
  if (!url) return;
  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}
